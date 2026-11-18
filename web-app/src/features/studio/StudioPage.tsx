import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, Minimize2, Download, Save, FileUp, FilePlus2, Loader2, ChevronDown, Sparkles, PanelLeft, PanelRight, Scaling, ChevronLeft, ChevronRight, Expand } from 'lucide-react';
import { cn, Button, useToast, Tooltip } from '../../components/ui';
import { saveDocument, downloadBlob } from '../easypdf/history';
import { anyToPdf } from './importAny';
import { useStudio } from './useStudio';
import StudioCanvas, { type StudioCanvasHandle } from './StudioCanvas';
import Ribbon, { type DrawerPanel } from './panels/Ribbon';
import PagesPanel from './panels/PagesPanel';
import AssetDrawer from './panels/AssetDrawer';
import PropertiesPanel from './panels/PropertiesPanel';
import Anchored from './panels/Anchored';

interface Props {
  initialFile?: File | null;
  onConsumedInitialFile?: () => void;
}

const StudioPage = ({ initialFile, onConsumedInitialFile }: Props) => {
  const { t } = useTranslation('studio');
  const api = useStudio();
  const toast = useToast();
  const canvasRef = useRef<StudioCanvasHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showPages, setShowPages] = useState(() => window.innerWidth >= 1024);
  const [showProps, setShowProps] = useState(() => window.innerWidth >= 1024);
  const [drawer, setDrawer] = useState<DrawerPanel>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [openMenu, setOpenMenu] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const [importMode, setImportMode] = useState<'overlay' | 'editable'>('editable');
  const draftAsked = useRef(false);
  const [dropHover, setDropHover] = useState(false);
  const [ribbonCollapsed, setRibbonCollapsed] = useState(false);
  const dragDepth = useRef(0);
  const imageRef = useRef<HTMLInputElement>(null);

  const { doc, setName, undo, redo, canUndo, canRedo, zoom, setZoom, exportPdf, loadPdf, newDocument, saveDraft, loadDraft, hasDraft, dirty, isProcessing, progress, deleteSelected, duplicateSelected, copy, cut, paste, selectAll, clearSelection, nudge, editingTextId, primary, updateSelected, setTool, pageIndex, setPageThumbnail, selectedIds, addElement, page, formatBrush, setFormatBrush, copyFormat, reorder } = api;

  useEffect(() => {
    if (initialFile) {
      void loadPdf(initialFile, 'editable').then((ok) => {
        if (ok) {
          toast.success(t('page.pdfOpened'), initialFile.name);
          setFullscreen(true);
        }
        onConsumedInitialFile?.();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const [draftBanner, setDraftBanner] = useState(false);
  useEffect(() => {
    if (draftAsked.current || initialFile) return;
    draftAsked.current = true;
    if (hasDraft()) {
      const t = setTimeout(() => setDraftBanner(true), 0);
      return () => clearTimeout(t);
    }
  }, [hasDraft, initialFile]);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => saveDraft(), 2500);
    return () => clearTimeout(t);
  }, [dirty, doc, saveDraft]);

  const currentElements = doc.pages[pageIndex]?.elements;
  const currentBg = doc.pages[pageIndex]?.backgroundColor;
  useEffect(() => {
    const t = setTimeout(() => {
      const url = canvasRef.current?.capturePage(pageIndex, 0.3);
      if (url) setPageThumbnail(pageIndex, url);
    }, 700);
    return () => clearTimeout(t);
  }, [currentElements, currentBg, pageIndex, setPageThumbnail, zoom]);

  // O efeito acima so cobre a pagina aberta: sem isto, as paginas nunca visitadas ficam
  // em branco no painel lateral. A lista de indices sem miniatura encolhe a cada captura,
  // entao o efeito para sozinho quando todas estao preenchidas.
  const missingThumbs = doc.pages.map((p, i) => (p.thumbnail ? -1 : i)).filter((i) => i >= 0).join(',');
  useEffect(() => {
    if (!missingThumbs) return;
    const t = setTimeout(() => {
      for (const raw of missingThumbs.split(',')) {
        const i = Number(raw);
        const url = canvasRef.current?.capturePage(i, 0.3);
        if (url) setPageThumbnail(i, url);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [missingThumbs, setPageThumbnail, zoom]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1024) {
        setShowPages(false);
        setShowProps(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => canvasRef.current?.fitWidth(), 80);
    return () => clearTimeout(t);
  }, [fullscreen, showPages, showProps, drawer, ribbonCollapsed]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !editingTextId && selectedIds.length === 0 && setFullscreen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, editingTextId, selectedIds.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (editingTextId || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.shiftKey && k === 'c') {
        e.preventDefault();
        copyFormat(false);
      } else if (mod && e.shiftKey && k === 'v') {
        e.preventDefault();
        if (formatBrush && selectedIds.length) selectedIds.forEach((id) => api.applyFormatTo(id));
      } else if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (mod && k === 'c') copy();
      else if (mod && k === 'x') cut();
      else if (mod && k === 'v') paste();
      else if (mod && k === 'a') {
        e.preventDefault();
        selectAll();
      } else if (mod && k === '0') {
        e.preventDefault();
        canvasRef.current?.fitWidth();
      } else if (mod && (k === '=' || k === '+')) {
        e.preventDefault();
        canvasRef.current?.zoomBy(1.2);
      } else if (mod && k === '-') {
        e.preventDefault();
        canvasRef.current?.zoomBy(1 / 1.2);
      } else if (mod && k === 'b' && primary?.type === 'text') {
        e.preventDefault();
        updateSelected((el) => {
          const w = el.fontWeight ?? (el.fontStyle?.includes('bold') ? 700 : 400);
          const nw = w >= 600 ? 400 : 700;
          const it = el.fontStyle?.includes('italic');
          return { fontWeight: nw, fontStyle: (nw >= 600 && it ? 'bold italic' : nw >= 600 ? 'bold' : it ? 'italic' : 'normal') as 'normal' };
        });
      } else if (mod && k === 'i' && primary?.type === 'text') {
        e.preventDefault();
        updateSelected((el) => {
          const bold = (el.fontWeight ?? (el.fontStyle?.includes('bold') ? 700 : 400)) >= 600;
          const it = !el.fontStyle?.includes('italic');
          return { fontStyle: (bold && it ? 'bold italic' : bold ? 'bold' : it ? 'italic' : 'normal') as 'normal' };
        });
      } else if (mod && k === 'u' && primary?.type === 'text') {
        e.preventDefault();
        updateSelected((el) => ({ textDecoration: el.textDecoration?.includes('underline') ? 'none' : 'underline' }));
      } else if (mod && (k === ']' || k === '[')) {
        // Word/Illustrator z-order shortcuts: ⌘] forward, ⌘⇧] to front (and the mirrored pair for back)
        e.preventDefault();
        if (selectedIds.length) reorder(k === ']' ? (e.shiftKey ? 'front' : 'forward') : e.shiftKey ? 'back' : 'backward');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (e.key === 'Escape') {
        if (formatBrush) return setFormatBrush(null);
        clearSelection();
        setTool('select');
      } else if (e.key.startsWith('Arrow') && selectedIds.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
      } else if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault();
        canvasRef.current?.scrollToPage(Math.max(0, Math.min(doc.pages.length - 1, pageIndex + (e.key === 'PageDown' ? 1 : -1))));
      } else if (!mod && k === 'v') setTool('select');
      else if (!mod && k === 'h') setTool('hand');
      else if (!mod && k === 't') setTool('text');
      else if (!mod && k === 'r') setTool('rect');
      else if (!mod && k === 'o') setTool('circle');
      else if (!mod && k === 'l') setTool('line');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, editingTextId, undo, redo, duplicateSelected, copy, cut, paste, selectAll, clearSelection, nudge, deleteSelected, primary, updateSelected, setTool, doc.pages.length, pageIndex, formatBrush, copyFormat, setFormatBrush]);

  const doExport = useCallback(async () => {
    setExporting(true);
    try {
      const blob = await exportPdf();
      const name = `${doc.name || t('page.documentDefaultName')}.pdf`;
      await saveDocument(blob, { name, contentType: 'application/pdf', kind: 'pdf', source: 'editor', toolName: 'Design Studio' });
      downloadBlob(blob, name);
      toast.success(t('page.exportSuccess'), t('page.exportSuccessDesc'));
    } catch (e) {
      toast.error(t('page.exportFail'), e instanceof Error ? e.message : undefined);
    } finally {
      setExporting(false);
    }
  }, [exportPdf, doc.name, toast, t]);

  const importFiles = async (files: File[], mode: 'overlay' | 'editable' = importMode) => {
    if (!files.length) return;
    try {
      const { pdf, note } = await anyToPdf(files);
      const ok = await loadPdf(pdf, mode);
      if (ok) {
        toast.success(t('page.importSuccess'), note || (mode === 'overlay' ? t('page.importOverlayNote', { name: pdf.name }) : t('page.importEditableNote', { name: pdf.name })));
        setFullscreen(true);
      } else toast.error(t('page.importFail'), pdf.name);
    } catch (e) {
      toast.error(t('page.importFail'), e instanceof Error ? e.message : undefined);
    }
  };

  const onPickImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    files.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result);
        const img = new Image();
        img.onload = () => {
          const maxW = (page?.width || 595) * 0.5;
          const scale = Math.min(1, maxW / img.naturalWidth);
          addElement({ type: 'image', content: src, x: NaN, y: NaN, width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale), name: file.name }, { center: true });
        };
        img.src = src;
      };
      setTimeout(() => reader.readAsDataURL(file), i * 50);
    });
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await importFiles(files);
  };

  const goToPage = (i: number) => canvasRef.current?.scrollToPage(i);

  return (
    <div
      className={cn('flex flex-col bg-slate-100 overflow-clip', fullscreen ? 'fixed inset-0 z-[90]' : 'relative h-full')}
      onClick={() => openMenu && setOpenMenu(false)}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current += 1;
        setDropHover(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDropHover(false);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        dragDepth.current = 0;
        setDropHover(false);
        if (e.defaultPrevented) return;
        e.preventDefault();
        void importFiles(Array.from(e.dataTransfer.files || []));
      }}
    >
      <div className="h-12 bg-slate-900 text-white flex items-center gap-2 px-3 shrink-0">
        <input ref={fileRef} type="file" multiple accept="application/pdf,.pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.html,.md,.csv" className="hidden" onChange={onPickFile} />
        <div ref={fileMenuRef} className="relative">
          <button onClick={(e) => { e.stopPropagation(); setOpenMenu((v) => !v); }} className="h-8 px-3 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-bold flex items-center gap-1.5">
            {t('page.fileMenu')} <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <Anchored anchor={fileMenuRef} open={openMenu} onClose={() => setOpenMenu(false)} width={288} className="py-1">
            <div className="text-slate-800 text-sm">
              <button onClick={() => { if (!dirty || confirm(t('page.newDocumentConfirm'))) newDocument(); setOpenMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50"><FilePlus2 className="w-4 h-4" /> {t('page.newDocument')}</button>
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('page.openPdf')}</div>
              <button onClick={() => { setImportMode('editable'); fileRef.current?.click(); setOpenMenu(false); }} className="w-full flex items-start gap-2 px-3 py-2 hover:bg-slate-50 text-left"><Sparkles className="w-4 h-4 mt-0.5 text-amber-500" /> <span><span className="block font-semibold">{t('page.editableRecommended')}</span><span className="block text-xs text-slate-500">{t('page.editableDesc')}</span></span></button>
              <button onClick={() => { setImportMode('overlay'); fileRef.current?.click(); setOpenMenu(false); }} className="w-full flex items-start gap-2 px-3 py-2 hover:bg-slate-50 text-left"><FileUp className="w-4 h-4 mt-0.5" /> <span><span className="block font-semibold">{t('page.overlay')}</span><span className="block text-xs text-slate-500">{t('page.overlayDesc')}</span></span></button>
              <div className="my-1 h-px bg-slate-100" />
              <button onClick={() => { if (saveDraft()) toast.success(t('page.draftSaved')); else toast.warning(t('page.draftTooLarge')); setOpenMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50"><Save className="w-4 h-4" /> {t('page.saveDraft')}</button>
              <button onClick={() => { void doExport(); setOpenMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50"><Download className="w-4 h-4" /> {t('page.exportPdf')}</button>
            </div>
          </Anchored>
        </div>
        <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white hidden sm:inline-flex" icon={FileUp} onClick={() => { setImportMode('editable'); fileRef.current?.click(); }}>
          {t('page.openPdf')}
        </Button>
        <input value={doc.name} onChange={(e) => setName(e.target.value)} className="h-8 px-2 rounded-lg bg-transparent hover:bg-white/10 focus:bg-white/10 text-sm font-semibold outline-none w-40 md:w-64 truncate" />
        {dirty && <span className="hidden md:inline text-[10px] text-slate-400">{t('page.unsaved')}</span>}
        {isProcessing && <Loader2 className="w-4 h-4 animate-spin text-slate-300" />}

        <div className="ml-auto flex items-center gap-1">
          <Tooltip label={t('page.undo')}><button onClick={undo} disabled={!canUndo} className="w-8 h-8 rounded-lg hover:bg-white/10 disabled:opacity-30 flex items-center justify-center"><Undo2 className="w-4 h-4" /></button></Tooltip>
          <Tooltip label={t('page.redo')}><button onClick={redo} disabled={!canRedo} className="w-8 h-8 rounded-lg hover:bg-white/10 disabled:opacity-30 flex items-center justify-center"><Redo2 className="w-4 h-4" /></button></Tooltip>
          <div className="w-px h-5 bg-white/15 mx-1" />
          <Tooltip label={t('page.pages')}><button onClick={() => setShowPages((v) => !v)} className={cn('w-8 h-8 rounded-lg flex items-center justify-center', showPages ? 'bg-white/15' : 'hover:bg-white/10')}><PanelLeft className="w-4 h-4" /></button></Tooltip>
          <Tooltip label={t('page.properties')}><button onClick={() => setShowProps((v) => !v)} className={cn('w-8 h-8 rounded-lg flex items-center justify-center', showProps ? 'bg-white/15' : 'hover:bg-white/10')}><PanelRight className="w-4 h-4" /></button></Tooltip>
          <Tooltip label={fullscreen ? t('page.exitFullscreen') : t('page.fullscreen')}><button onClick={() => setFullscreen((v) => !v)} className={cn('w-8 h-8 rounded-lg flex items-center justify-center', fullscreen ? 'bg-white/15' : 'hover:bg-white/10')}>{fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</button></Tooltip>
          <Button size="sm" icon={Download} onClick={doExport} loading={exporting} className="bg-rose-600 hover:bg-rose-700 shadow-rose-600/20">
            {t('page.exportPdf')}
          </Button>
        </div>
      </div>

      <input ref={imageRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickImages} />
      <Ribbon
        api={api}
        drawer={drawer}
        setDrawer={setDrawer}
        onInsertImage={() => imageRef.current?.click()}
        onZoom={(factor) => canvasRef.current?.zoomBy(factor)}
        onFitWidth={() => canvasRef.current?.fitWidth()}
        onFitPage={() => canvasRef.current?.fit()}
        showPages={showPages}
        showProps={showProps}
        onTogglePages={() => setShowPages((v) => !v)}
        onToggleProps={() => setShowProps((v) => !v)}
        collapsed={ribbonCollapsed}
        onToggleCollapsed={() => setRibbonCollapsed((v) => !v)}
      />
      {draftBanner && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 flex items-center gap-3 shrink-0">
          <Save className="w-4 h-4 text-amber-600" /> {t('page.draftBanner')}
          <button onClick={() => { loadDraft(); setDraftBanner(false); }} className="h-7 px-3 rounded-lg bg-amber-600 text-white font-bold">{t('page.restore')}</button>
          <button onClick={() => setDraftBanner(false)} className="h-7 px-3 rounded-lg border border-amber-300 font-semibold">{t('page.dismiss')}</button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {showPages && <PagesPanel api={api} onGoTo={goToPage} />}
        <AssetDrawer api={api} panel={drawer} onClose={() => setDrawer(null)} />
        <div className="flex-1 min-w-0 relative">
          <StudioCanvas ref={canvasRef} api={api} onDropFiles={(files) => void importFiles(files, 'editable')} />
          {!doc.pages.length && !isProcessing && (
            <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
              <div className="pointer-events-auto max-w-lg w-full rounded-3xl border-2 border-dashed border-slate-300 bg-white/80 backdrop-blur px-8 py-10 text-center shadow-sm">
                <FileUp className="w-10 h-10 mx-auto text-brand-600 mb-3" />
                <p className="text-lg font-extrabold text-slate-900">{t('page.dropHere')}</p>
                <p className="text-sm text-slate-500 mt-1">{t('page.dropDesc')}</p>
                <div className="mt-5 flex items-center justify-center gap-2">
                  <button onClick={() => { setImportMode('editable'); fileRef.current?.click(); }} className="h-10 px-4 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-700">{t('page.selectFile')}</button>
                  <button onClick={() => newDocument()} className="h-10 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">{t('page.blankDocument')}</button>
                </div>
              </div>
            </div>
          )}
          {dropHover && (
            <div className="absolute inset-0 z-40 bg-brand-600/10 backdrop-blur-[1px] border-4 border-dashed border-brand-400 flex items-center justify-center pointer-events-none">
              <p className="bg-white rounded-2xl px-6 py-4 text-lg font-bold text-brand-700 shadow-float">{t('page.dropOverlay')}</p>
            </div>
          )}
        </div>
        {showProps && <PropertiesPanel api={api} />}
      </div>

      {/* Bottom bar: page navigation + zoom (iLovePDF style) */}
      <div className="h-11 bg-white border-t border-slate-200 flex items-center px-3 gap-2 shrink-0 text-xs">
        <div className="flex items-center gap-1">
          <Tooltip label={t('page.prevPage')}><button onClick={() => canvasRef.current?.scrollToPage(Math.max(0, pageIndex - 1))} disabled={pageIndex === 0} className="w-8 h-8 rounded-lg hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center"><ChevronLeft className="w-4 h-4" /></button></Tooltip>
          <input type="number" min={1} max={doc.pages.length} value={pageIndex + 1} onChange={(e) => canvasRef.current?.scrollToPage(Math.max(0, Math.min(doc.pages.length - 1, Number(e.target.value) - 1)))} className="w-12 h-8 rounded-lg border border-slate-200 text-center font-bold outline-none focus:border-brand-400" />
          <span className="text-slate-500">/ {doc.pages.length}</span>
          <Tooltip label={t('page.nextPage')}><button onClick={() => canvasRef.current?.scrollToPage(Math.min(doc.pages.length - 1, pageIndex + 1))} disabled={pageIndex >= doc.pages.length - 1} className="w-8 h-8 rounded-lg hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center"><ChevronRight className="w-4 h-4" /></button></Tooltip>
        </div>
        <span className="hidden md:inline text-slate-400 ml-2">{doc.pages[pageIndex] ? `${doc.pages[pageIndex].width}×${doc.pages[pageIndex].height} pt` : ''}{selectedIds.length ? ` · ${t('page.selected', { count: selectedIds.length })}` : ''}</span>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip label={t('page.zoomOut')}><button onClick={() => canvasRef.current?.zoomBy(1 / 1.2)} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"><ZoomOut className="w-4 h-4" /></button></Tooltip>
          <select value={String(Math.round(zoom * 100))} onChange={(e) => { const v = e.target.value; if (v === 'fitw') canvasRef.current?.fitWidth(); else if (v === 'fitp') canvasRef.current?.fit(); else setZoom(Number(v) / 100); }} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none w-[92px]">
            {![50, 75, 100, 125, 150, 200, 300].includes(Math.round(zoom * 100)) && <option value={String(Math.round(zoom * 100))}>{Math.round(zoom * 100)}%</option>}
            {[50, 75, 100, 125, 150, 200, 300].map((v) => (
              <option key={v} value={String(v)}>{v}%</option>
            ))}
            <option value="fitw">{t('page.fitWidthOption')}</option>
            <option value="fitp">{t('page.fitPageOption')}</option>
          </select>
          <Tooltip label={t('page.zoomIn')}><button onClick={() => canvasRef.current?.zoomBy(1.2)} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"><ZoomIn className="w-4 h-4" /></button></Tooltip>
          <Tooltip label={t('page.fitWidth')}><button onClick={() => canvasRef.current?.fitWidth()} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"><Scaling className="w-4 h-4" /></button></Tooltip>
          <Tooltip label={t('page.fitPage')}><button onClick={() => canvasRef.current?.fit()} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"><Expand className="w-4 h-4" /></button></Tooltip>
        </div>
      </div>

      {progress && (
        <div className="absolute inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center">
          <div className="surface p-6 w-[380px]">
            <p className="text-sm font-bold text-slate-900 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-brand-600" /> {t('page.importingPdf')}</p>
            <p className="text-xs text-slate-500 mt-1">{progress.label}</p>
            <div className="mt-3 h-2 rounded-full bg-slate-200 overflow-hidden">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.round(progress.pct)}%` }} />
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default StudioPage;
