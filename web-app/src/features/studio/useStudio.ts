import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_MARGINS, type EditorElement, type EditorPage } from '../../types/pdfEditor';
import { savePdf } from '../../services/pdfSaveService';
import { STUDIO_TEMPLATES } from './templates';
import { PDFLib } from '../../utils/pdfWorker';
import { openDocument, extractPage, stripAndSave, renderPage } from './engine/pdfium';
import { pageToElements } from './engine/textGrouping';
import { ensureWebFont, FONT_SIZE_PRESETS } from './fonts';
import { pickFormat, CLEARED_TEXT_FORMAT } from './textStyle';

export type StudioTool = 'select' | 'hand' | 'text' | 'rect' | 'circle' | 'line' | 'arrow' | 'pen' | 'highlight' | 'whiteout';
export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export interface StudioDoc {
  name: string;
  pages: EditorPage[];
  originalPdfBytes: Uint8Array | ArrayBuffer | null;
}

interface Snapshot {
  pages: EditorPage[];
  pageIndex: number;
}

const DRAFT_KEY = 'optafiles_studio_draft';
const uid = () => crypto.randomUUID();

const clone = <T,>(v: T): T => structuredClone(v);

/** Format of a brand-new text box before the user touches the ribbon. */
const DEFAULT_TEXT_FORMAT: Partial<EditorElement> = { fontFamily: 'Helvetica', fontSize: 16, fontWeight: 400, fontStyle: 'normal', textDecoration: 'none', fill: '#0f172a', align: 'left', lineHeight: 1.25 };

/** Above this many vector objects on a single page, keep the raster background instead of editable paths. */
const MAX_EDITABLE_PATHS = 1200;

const blankPage = (width = 595, height = 842): EditorPage => ({ id: uid(), width, height, backgroundColor: '#ffffff', elements: [], margins: { ...DEFAULT_MARGINS } });

/** Paginas vindas de modelos, rascunhos antigos ou PDFs importados podem nao ter margens: sem elas o regulador e as guias nao tem o que mostrar. */
const withMargins = (pages: EditorPage[]): EditorPage[] => pages.map((p) => (p.margins ? p : { ...p, margins: { ...DEFAULT_MARGINS } }));

export const useStudio = () => {
  const [doc, setDoc] = useState<StudioDoc>(() => ({ name: 'Documento sem título', pages: [blankPage()], originalPdfBytes: null }));
  const [pageIndex, setPageIndexState] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tool, setTool] = useState<StudioTool>('select');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [showRulers, setShowRulers] = useState(true);
  const [showMargins, setShowMargins] = useState(true);
  /** Word's format painter: style copied from one element, waiting to be dropped on another. */
  const [formatBrush, setFormatBrush] = useState<{ patch: Partial<EditorElement>; type: EditorElement['type']; sticky: boolean } | null>(null);
  /**
   * Word-style "insertion point" formatting: what the ribbon edits while nothing is selected
   * (so it never has to grey out on a blank page) and what every new text box is born with.
   */
  const [textDefaults, setTextDefaultsState] = useState<Partial<EditorElement>>(DEFAULT_TEXT_FORMAT);
  const setTextDefaults = useCallback(
    (patch: Partial<EditorElement> | ((el: EditorElement) => Partial<EditorElement>)) =>
      setTextDefaultsState((cur) => ({ ...cur, ...(typeof patch === 'function' ? patch({ ...cur, type: 'text' } as EditorElement) : patch) })),
    []
  );

  const history = useRef<Snapshot[]>([]);
  const historyStep = useRef(-1);
  const [historyVersion, setHistoryVersion] = useState(0);
  const clipboard = useRef<EditorElement[]>([]);
  const [clipboardCount, setClipboardCount] = useState(0);

  const page = doc.pages[pageIndex];
  const elements = useMemo(() => page?.elements || [], [page]);
  const selected = useMemo(() => elements.filter((e) => selectedIds.includes(e.id)), [elements, selectedIds]);
  const primary = selected[0];

  // ---- history
  const pushHistory = useCallback((pages: EditorPage[], idx: number) => {
    const snap: Snapshot = { pages: clone(pages), pageIndex: idx };
    history.current = history.current.slice(0, historyStep.current + 1);
    history.current.push(snap);
    if (history.current.length > 80) history.current.shift();
    historyStep.current = history.current.length - 1;
    setHistoryVersion((v) => v + 1);
    setDirty(true);
  }, []);

  useEffect(() => {
    if (history.current.length === 0) {
      history.current = [{ pages: clone(doc.pages), pageIndex: 0 }];
      historyStep.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPages = useCallback(
    (pages: EditorPage[], opts?: { history?: boolean; pageIndex?: number }) => {
      const idx = opts?.pageIndex ?? pageIndex;
      setDoc((d) => ({ ...d, pages }));
      if (opts?.pageIndex !== undefined) setPageIndexState(opts.pageIndex);
      if (opts?.history !== false) pushHistory(pages, idx);
      else setDirty(true);
    },
    [pageIndex, pushHistory]
  );

  const canUndo = historyStep.current > 0;
  const canRedo = historyStep.current < history.current.length - 1;
  const undo = useCallback(() => {
    if (historyStep.current <= 0) return;
    historyStep.current -= 1;
    const snap = history.current[historyStep.current];
    setDoc((d) => ({ ...d, pages: clone(snap.pages) }));
    setPageIndexState(Math.min(snap.pageIndex, snap.pages.length - 1));
    setSelectedIds([]);
    setHistoryVersion((v) => v + 1);
  }, []);
  const redo = useCallback(() => {
    if (historyStep.current >= history.current.length - 1) return;
    historyStep.current += 1;
    const snap = history.current[historyStep.current];
    setDoc((d) => ({ ...d, pages: clone(snap.pages) }));
    setPageIndexState(Math.min(snap.pageIndex, snap.pages.length - 1));
    setSelectedIds([]);
    setHistoryVersion((v) => v + 1);
  }, []);

  // ---- helpers
  const mutatePage = useCallback(
    (fn: (p: EditorPage) => EditorPage, opts?: { history?: boolean }) => {
      const pages = doc.pages.map((p, i) => (i === pageIndex ? fn(p) : p));
      applyPages(pages, opts);
    },
    [doc.pages, pageIndex, applyPages]
  );

  // ---- selection
  const select = useCallback((ids: string | string[] | null, opts?: { toggle?: boolean }) => {
    if (ids === null) return setSelectedIds([]);
    const list = Array.isArray(ids) ? ids : [ids];
    if (opts?.toggle) setSelectedIds((prev) => (list.every((id) => prev.includes(id)) ? prev.filter((x) => !list.includes(x)) : Array.from(new Set([...prev, ...list]))));
    else setSelectedIds(list);
  }, []);
  /** Select elements living on another page (continuous canvas) */
  const selectOnPage = useCallback((idx: number, ids: string | string[] | null, opts?: { toggle?: boolean }) => {
    setPageIndexState(idx);
    setEditingTextId(null);
    if (ids === null) return setSelectedIds([]);
    const list = Array.isArray(ids) ? ids : [ids];
    if (opts?.toggle) setSelectedIds((prev) => (list.every((id) => prev.includes(id)) ? prev.filter((x) => !list.includes(x)) : Array.from(new Set([...prev, ...list]))));
    else setSelectedIds(list);
  }, []);
  /** Change the active page without touching the selection (scroll-driven) */
  const setActivePage = useCallback((idx: number) => setPageIndexState((cur) => (cur === idx ? cur : idx)), []);
  const selectAll = useCallback(() => setSelectedIds(elements.filter((e) => !e.locked && !e.hidden).map((e) => e.id)), [elements]);
  const clearSelection = useCallback(() => setSelectedIds([]), []);

  // ---- elements
  const addElement = useCallback(
    (el: Omit<EditorElement, 'id'> & { id?: string }, opts?: { select?: boolean; center?: boolean; page?: number }) => {
      const id = el.id || uid();
      const full: EditorElement = { ...el, id } as EditorElement;
      const targetIdx = opts?.page ?? pageIndex;
      const target = doc.pages[targetIdx] || page;
      if (opts?.center !== false && target) {
        if (el.x === undefined || Number.isNaN(el.x)) full.x = Math.round((target.width - full.width) / 2);
        if (el.y === undefined || Number.isNaN(el.y)) full.y = Math.round((target.height - full.height) / 2);
      }
      const pages = doc.pages.map((p, i) => (i === targetIdx ? { ...p, elements: [...p.elements, full] } : p));
      applyPages(pages, { pageIndex: targetIdx });
      if (opts?.select !== false) setSelectedIds([id]);
      return id;
    },
    [doc.pages, pageIndex, page, applyPages]
  );

  /** New text box carrying the current text defaults. x/y = NaN drops it in the middle of the page. */
  const addTextAt = useCallback(
    (pos: { x: number; y: number; page?: number }, content = '') => {
      const fs = textDefaults.fontSize || 16;
      const height = Math.round(fs * (textDefaults.lineHeight || 1.25) + 8);
      return addElement({ ...textDefaults, type: 'text', x: pos.x, y: pos.y, width: 260, height, content, padding: 4, name: 'Texto' } as Omit<EditorElement, 'id'>, { page: pos.page });
    },
    [addElement, textDefaults]
  );

  const updateElements = useCallback(
    (ids: string[], patch: Partial<EditorElement> | ((el: EditorElement) => Partial<EditorElement>), opts?: { history?: boolean }) => {
      const pages = doc.pages.map((p) => (p.elements.some((el) => ids.includes(el.id)) ? { ...p, elements: p.elements.map((el) => (ids.includes(el.id) ? { ...el, ...(typeof patch === 'function' ? patch(el) : patch) } : el)) } : p));
      applyPages(pages, opts);
    },
    [doc.pages, applyPages]
  );
  const updateSelected = useCallback((patch: Partial<EditorElement> | ((el: EditorElement) => Partial<EditorElement>), opts?: { history?: boolean }) => updateElements(selectedIds, patch, opts), [updateElements, selectedIds]);

  const commit = useCallback(() => pushHistory(doc.pages, pageIndex), [pushHistory, doc.pages, pageIndex]);

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    mutatePage((p) => ({ ...p, elements: p.elements.filter((el) => !selectedIds.includes(el.id) || el.locked) }));
    setSelectedIds([]);
  }, [mutatePage, selectedIds]);

  const duplicateSelected = useCallback(() => {
    if (!selected.length) return;
    const copies = selected.map((el) => ({ ...clone(el), id: uid(), x: el.x + 16, y: el.y + 16, locked: false }));
    mutatePage((p) => ({ ...p, elements: [...p.elements, ...copies] }));
    setSelectedIds(copies.map((c) => c.id));
  }, [selected, mutatePage]);

  const copy = useCallback(() => {
    clipboard.current = clone(selected);
    setClipboardCount(clipboard.current.length);
  }, [selected]);
  const cut = useCallback(() => {
    copy();
    deleteSelected();
  }, [copy, deleteSelected]);
  const paste = useCallback(
    (at?: { x: number; y: number }) => {
      if (!clipboard.current.length) return;
      // pasting from the context menu drops the block under the cursor, keeping the relative layout of a multi-selection
      const minX = Math.min(...clipboard.current.map((el) => el.x));
      const minY = Math.min(...clipboard.current.map((el) => el.y));
      const dx = at ? at.x - minX : 24;
      const dy = at ? at.y - minY : 24;
      const copies = clipboard.current.map((el) => ({ ...clone(el), id: uid(), x: el.x + dx, y: el.y + dy, locked: false }));
      mutatePage((p) => ({ ...p, elements: [...p.elements, ...copies] }));
      setSelectedIds(copies.map((c) => c.id));
    },
    [mutatePage]
  );

  const reorder = useCallback(
    (mode: 'front' | 'back' | 'forward' | 'backward') => {
      if (!selectedIds.length) return;
      mutatePage((p) => {
        const els = [...p.elements];
        const isSel = (e: EditorElement) => selectedIds.includes(e.id);
        if (mode === 'front') return { ...p, elements: [...els.filter((e) => !isSel(e)), ...els.filter(isSel)] };
        if (mode === 'back') return { ...p, elements: [...els.filter(isSel), ...els.filter((e) => !isSel(e))] };
        if (mode === 'forward') {
          for (let i = els.length - 2; i >= 0; i--) if (isSel(els[i]) && !isSel(els[i + 1])) [els[i], els[i + 1]] = [els[i + 1], els[i]];
        } else {
          for (let i = 1; i < els.length; i++) if (isSel(els[i]) && !isSel(els[i - 1])) [els[i], els[i - 1]] = [els[i - 1], els[i]];
        }
        return { ...p, elements: els };
      });
    },
    [mutatePage, selectedIds]
  );

  /** Put the selection immediately above/below another element — "trazer para frente de X" */
  const reorderRelative = useCallback(
    (targetId: string, side: 'above' | 'below') => {
      if (!selectedIds.length || selectedIds.includes(targetId)) return;
      mutatePage((p) => {
        const isSel = (e: EditorElement) => selectedIds.includes(e.id);
        const moving = p.elements.filter(isSel);
        const rest = p.elements.filter((e) => !isSel(e));
        const at = rest.findIndex((e) => e.id === targetId);
        if (at === -1 || !moving.length) return p;
        const insert = side === 'above' ? at + 1 : at;
        return { ...p, elements: [...rest.slice(0, insert), ...moving, ...rest.slice(insert)] };
      });
    },
    [mutatePage, selectedIds]
  );

  /** Flip the stacking of the selected elements among the slots they already occupy */
  const reverseOrder = useCallback(() => {
    if (selectedIds.length < 2) return;
    mutatePage((p) => {
      const slots: number[] = [];
      p.elements.forEach((e, i) => selectedIds.includes(e.id) && slots.push(i));
      const picked = slots.map((i) => p.elements[i]).reverse();
      const els = [...p.elements];
      slots.forEach((slot, i) => (els[slot] = picked[i]));
      return { ...p, elements: els };
    });
  }, [mutatePage, selectedIds]);

  /** Select every element of the same type on the page (all text, all images…) */
  const selectSameType = useCallback(() => {
    const type = selected[0]?.type;
    if (!type) return;
    setSelectedIds(elements.filter((e) => e.type === type && !e.locked && !e.hidden).map((e) => e.id));
  }, [selected, elements]);

  const alignSelected = useCallback(
    (mode: AlignMode) => {
      if (!selected.length || !page) return;
      const useBounds = selected.length > 1;
      const minX = useBounds ? Math.min(...selected.map((e) => e.x)) : 0;
      const maxX = useBounds ? Math.max(...selected.map((e) => e.x + e.width)) : page.width;
      const minY = useBounds ? Math.min(...selected.map((e) => e.y)) : 0;
      const maxY = useBounds ? Math.max(...selected.map((e) => e.y + e.height)) : page.height;
      updateSelected((el) => {
        switch (mode) {
          case 'left': return { x: minX };
          case 'right': return { x: maxX - el.width };
          case 'hcenter': return { x: Math.round((minX + maxX) / 2 - el.width / 2) };
          case 'top': return { y: minY };
          case 'bottom': return { y: maxY - el.height };
          case 'vcenter': return { y: Math.round((minY + maxY) / 2 - el.height / 2) };
        }
      });
    },
    [selected, page, updateSelected]
  );

  const nudge = useCallback((dx: number, dy: number) => updateSelected((el) => ({ x: el.x + dx, y: el.y + dy })), [updateSelected]);

  // ---- Word-like text commands
  /** Grow/shrink font size through the standard Word ladder (A^ / Av). */
  const bumpFontSize = useCallback(
    (dir: 1 | -1) => {
      const step = (el: EditorElement) => {
        if (el.type !== 'text') return {};
        const cur = el.fontSize || 16;
        const ladder = FONT_SIZE_PRESETS;
        const next = dir > 0 ? ladder.find((s) => s > cur + 0.01) ?? Math.min(400, Math.round(cur * 1.15)) : [...ladder].reverse().find((s) => s < cur - 0.01) ?? Math.max(2, Math.round(cur / 1.15));
        return { fontSize: next };
      };
      if (!selectedIds.length) setTextDefaults(step);
      else updateSelected(step);
    },
    [updateSelected, selectedIds.length, setTextDefaults]
  );

  const clearFormat = useCallback(() => updateSelected((el) => (el.type === 'text' ? CLEARED_TEXT_FORMAT : { opacity: 1, strokeWidth: 0, stroke: 'transparent' })), [updateSelected]);

  const copyFormat = useCallback(
    (sticky = false) => {
      if (!primary) return;
      setFormatBrush({ patch: pickFormat(primary), type: primary.type, sticky });
    },
    [primary]
  );

  /** Drop the copied format on an element; releases the brush unless it was picked up with a double click. */
  const applyFormatTo = useCallback(
    (id: string) => {
      if (!formatBrush) return false;
      const target = doc.pages.flatMap((p) => p.elements).find((e) => e.id === id);
      if (!target) return false;
      const textLike = target.type === 'text';
      if (textLike !== (formatBrush.type === 'text')) return false;
      updateElements([id], formatBrush.patch);
      if (!formatBrush.sticky) setFormatBrush(null);
      return true;
    },
    [formatBrush, doc.pages, updateElements]
  );
  const toggleLock = useCallback((id?: string) => updateElements(id ? [id] : selectedIds, (el) => ({ locked: !el.locked })), [updateElements, selectedIds]);
  const toggleHidden = useCallback((id: string) => updateElements([id], (el) => ({ hidden: !el.hidden })), [updateElements]);
  const moveLayer = useCallback(
    (id: string, to: number) => {
      mutatePage((p) => {
        const els = [...p.elements];
        const from = els.findIndex((e) => e.id === id);
        if (from === -1) return p;
        const [it] = els.splice(from, 1);
        els.splice(to, 0, it);
        return { ...p, elements: els };
      });
    },
    [mutatePage]
  );

  // ---- pages
  const setPageIndex = useCallback((i: number) => {
    setPageIndexState(i);
    setSelectedIds([]);
    setEditingTextId(null);
  }, []);
  const addPage = useCallback(
    (templateId?: string, size?: { width: number; height: number }) => {
      const tpl = templateId ? STUDIO_TEMPLATES.find((t) => t.id === templateId) : null;
      const np = withMargins([tpl ? tpl.build() : blankPage(size?.width ?? page?.width, size?.height ?? page?.height)])[0];
      const pages = [...doc.pages.slice(0, pageIndex + 1), np, ...doc.pages.slice(pageIndex + 1)];
      applyPages(pages, { pageIndex: pageIndex + 1 });
      setSelectedIds([]);
    },
    [doc.pages, pageIndex, page, applyPages]
  );
  const duplicatePage = useCallback(() => {
    if (!page) return;
    const copyP = { ...clone(page), id: uid(), elements: page.elements.map((e) => ({ ...e, id: uid() })) };
    const pages = [...doc.pages.slice(0, pageIndex + 1), copyP, ...doc.pages.slice(pageIndex + 1)];
    applyPages(pages, { pageIndex: pageIndex + 1 });
  }, [page, doc.pages, pageIndex, applyPages]);
  const deletePage = useCallback(
    (i = pageIndex) => {
      if (doc.pages.length <= 1) return;
      const pages = doc.pages.filter((_, idx) => idx !== i);
      applyPages(pages, { pageIndex: Math.max(0, Math.min(i, pages.length - 1)) });
      setSelectedIds([]);
    },
    [doc.pages, pageIndex, applyPages]
  );
  const movePage = useCallback(
    (from: number, to: number) => {
      const pages = [...doc.pages];
      const [p] = pages.splice(from, 1);
      pages.splice(to, 0, p);
      applyPages(pages, { pageIndex: to });
    },
    [doc.pages, applyPages]
  );
  const updatePage = useCallback((patch: Partial<EditorPage>, opts?: { history?: boolean }) => mutatePage((p) => ({ ...p, ...patch }), opts), [mutatePage]);
  const setPageThumbnail = useCallback((idx: number, thumbnail: string) => {
    setDoc((d) => (d.pages[idx]?.thumbnail === thumbnail ? d : { ...d, pages: d.pages.map((p, i) => (i === idx ? { ...p, thumbnail } : p)) }));
  }, []);

  // ---- documents
  const resetHistory = useCallback((pages: EditorPage[]) => {
    history.current = [{ pages: clone(pages), pageIndex: 0 }];
    historyStep.current = 0;
    setHistoryVersion((v) => v + 1);
  }, []);

  const newDocument = useCallback(
    (opts?: { templateId?: string; width?: number; height?: number; name?: string }) => {
      const tpl = opts?.templateId ? STUDIO_TEMPLATES.find((t) => t.id === opts.templateId) : null;
      const pages = withMargins([tpl ? tpl.build() : blankPage(opts?.width, opts?.height)]);
      setDoc({ name: opts?.name || tpl?.name || 'Documento sem título', pages, originalPdfBytes: null });
      setPageIndexState(0);
      setSelectedIds([]);
      resetHistory(pages);
      setDirty(false);
    },
    [resetHistory]
  );

  const [progress, setProgress] = useState<{ label: string; pct: number } | null>(null);

  /**
   * Load a PDF.
   * - 'editable' (default): PDFium extracts every text run and image into editable elements; text/images are
   *   stripped from the original and the vector-only remainder becomes the page background (and the export base).
   * - 'overlay': pages become background images; you edit on top; original pages are preserved on export.
   */
  const loadPdf = useCallback(
    async (file: File, mode: 'overlay' | 'editable' = 'editable') => {
      setIsProcessing(true);
      setProgress({ label: 'Lendo arquivo…', pct: 2 });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pages: EditorPage[] = [];
        let base: Uint8Array | null = bytes;
        if (mode === 'editable') {
          setProgress({ label: 'Iniciando motor PDFium…', pct: 5 });
          const handle = await openDocument(bytes);
          const extracted = [];
          try {
            for (let i = 0; i < handle.pageCount; i++) {
              setProgress({ label: `Extraindo textos e imagens · página ${i + 1}/${handle.pageCount}`, pct: 5 + ((i + 1) / handle.pageCount) * 45 });
              extracted.push(await extractPage(handle, i));
            }
          } finally {
            handle.close();
          }
          setProgress({ label: 'Separando camada vetorial…', pct: 55 });
          // Vector artwork becomes editable path elements too, unless a page is so dense that
          // thousands of Konva nodes would stall the canvas — those keep the rasterised background.
          const editablePaths = extracted.every((p) => p.paths.length <= MAX_EDITABLE_PATHS);
          const stripHandle = await openDocument(bytes);
          let stripped: Uint8Array;
          try {
            stripped = await stripAndSave(stripHandle, { text: true, images: true, paths: editablePaths });
          } finally {
            stripHandle.close();
          }
          base = stripped;
          const bgHandle = await openDocument(stripped);
          try {
            for (let i = 0; i < extracted.length; i++) {
              const ex = extracted[i];
              setProgress({ label: `Montando página ${i + 1}/${extracted.length}`, pct: 60 + ((i + 1) / extracted.length) * 35 });
              const elements = await pageToElements(ex, { paths: editablePaths });
              const families = Array.from(new Set(elements.filter((e) => e.type === 'text' && e.fontFamily).map((e) => e.fontFamily as string)));
              await Promise.all(families.map((f) => ensureWebFont(f)));
              let imageUrl: string | undefined;
              if (ex.vectors > 0 || (!editablePaths && ex.paths.length > 0)) {
                const r = await renderPage(bgHandle, i, 2, { jpeg: true });
                imageUrl = r.dataUrl;
              }
              pages.push({ id: uid(), width: Math.round(ex.width), height: Math.round(ex.height), backgroundColor: '#ffffff', originalPageIndex: i, imageUrl, elements, margins: { ...DEFAULT_MARGINS } });
            }
          } finally {
            bgHandle.close();
          }
        } else {
          const pdf = await PDFLib.getDocument({ data: bytes.slice() }).promise;
          for (let i = 1; i <= pdf.numPages; i++) {
            setProgress({ label: `Renderizando página ${i}/${pdf.numPages}`, pct: (i / pdf.numPages) * 95 });
            const pg = await pdf.getPage(i);
            const basevp = pg.getViewport({ scale: 1 });
            const vp = pg.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(vp.width);
            canvas.height = Math.ceil(vp.height);
            const ctx = canvas.getContext('2d');
            if (ctx) await pg.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
            pages.push({ id: uid(), width: Math.round(basevp.width), height: Math.round(basevp.height), backgroundColor: '#ffffff', originalPageIndex: i - 1, imageUrl: canvas.toDataURL('image/jpeg', 0.85), elements: [], margins: { ...DEFAULT_MARGINS } });
          }
        }
        setDoc({ name: file.name.replace(/\.pdf$/i, ''), pages, originalPdfBytes: base });
        setPageIndexState(0);
        setSelectedIds([]);
        resetHistory(pages);
        setDirty(false);
        return true;
      } catch (e) {
        console.error('Failed to load PDF', e);
        return false;
      } finally {
        setIsProcessing(false);
        setProgress(null);
      }
    },
    [resetHistory]
  );

  const exportPdf = useCallback(async (): Promise<Blob> => {
    setIsProcessing(true);
    try {
      const bytes = await savePdf(doc.originalPdfBytes, doc.pages);
      return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    } finally {
      setIsProcessing(false);
    }
  }, [doc]);

  const setName = useCallback((name: string) => setDoc((d) => ({ ...d, name })), []);

  // ---- drafts (localStorage; skipped when too large)
  const saveDraft = useCallback(() => {
    try {
      const payload = JSON.stringify({ name: doc.name, pages: doc.pages.map((p) => ({ ...p, thumbnail: undefined })), savedAt: Date.now() });
      if (payload.length > 4_500_000) return false;
      localStorage.setItem(DRAFT_KEY, payload);
      setDirty(false);
      return true;
    } catch {
      return false;
    }
  }, [doc]);
  const loadDraft = useCallback(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { name: string; pages: EditorPage[] };
      if (!parsed.pages?.length) return false;
      const pages = withMargins(parsed.pages);
      setDoc({ name: parsed.name || 'Rascunho', pages, originalPdfBytes: null });
      setPageIndexState(0);
      setSelectedIds([]);
      resetHistory(pages);
      setDirty(false);
      return true;
    } catch {
      return false;
    }
  }, [resetHistory]);
  const hasDraft = useCallback(() => {
    try {
      return Boolean(localStorage.getItem(DRAFT_KEY));
    } catch {
      return false;
    }
  }, []);

  void historyVersion;

  return {
    doc,
    page,
    pageIndex,
    elements,
    selectedIds,
    selected,
    primary,
    tool,
    setTool,
    zoom,
    setZoom,
    pan,
    setPan,
    isProcessing,
    progress,
    dirty,
    editingTextId,
    setEditingTextId,
    showRulers,
    setShowRulers,
    showMargins,
    setShowMargins,
    canUndo,
    canRedo,
    undo,
    redo,
    select,
    selectOnPage,
    setActivePage,
    selectAll,
    clearSelection,
    addElement,
    updateElements,
    updateSelected,
    commit,
    deleteSelected,
    duplicateSelected,
    copy,
    cut,
    paste,
    clipboardCount,
    reorder,
    reorderRelative,
    reverseOrder,
    selectSameType,
    alignSelected,
    nudge,
    bumpFontSize,
    clearFormat,
    formatBrush,
    setFormatBrush,
    textDefaults,
    setTextDefaults,
    addTextAt,
    copyFormat,
    applyFormatTo,
    toggleLock,
    toggleHidden,
    moveLayer,
    setPageIndex,
    addPage,
    duplicatePage,
    deletePage,
    movePage,
    updatePage,
    setPageThumbnail,
    newDocument,
    loadPdf,
    exportPdf,
    setName,
    saveDraft,
    loadDraft,
    hasDraft
  };
};

export type StudioApi = ReturnType<typeof useStudio>;
