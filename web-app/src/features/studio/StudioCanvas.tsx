import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Stage, Layer, Group, Rect, Text, Ellipse, Line, Arrow, Path, Transformer } from 'react-konva';
import Konva from 'konva';
import URLImage from '../../components/EasyPDF/URLImage';
import { cn } from '../../components/ui';
import { DEFAULT_MARGINS, type EditorElement, type EditorPage } from '../../types/pdfEditor';
import type { StudioApi } from './useStudio';
import { onFontsChanged, ensureWebFont } from './fonts';
import { konvaFontStyle, renderedText, scriptMetrics } from './textStyle';
import FloatingTextToolbar from './panels/FloatingTextToolbar';
import ContextMenu, { type MenuItem } from './panels/ContextMenu';
import {
  Scissors,
  Copy,
  ClipboardPaste,
  CopyPlus,
  Trash2,
  BringToFront,
  SendToBack,
  ArrowUp,
  ArrowDown,
  FlipVertical2,
  Lock,
  Unlock,
  EyeOff,
  Layers,
  MousePointerClick,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  Ruler as RulerIcon,
  Square
} from 'lucide-react';

export interface StudioCanvasHandle {
  capturePage: (index: number, pixelRatio?: number) => string | null;
  fit: () => void;
  fitWidth: () => void;
  zoomBy: (factor: number) => void;
  scrollToPage: (index: number) => void;
}

interface Guide {
  orientation: 'v' | 'h';
  pos: number; // world coords
  kind?: 'margin';
}

const SNAP = 6;
const RULER = 22;
const PAGE_GAP = 28;

/* ------------------------------------------------------------------ Rulers */
const Ruler = ({ orientation, length, zoom, offset, margins, onDragEdge }: { orientation: 'h' | 'v'; length: number; zoom: number; offset: number; margins?: [number, number]; onDragEdge?: (edge: 'start' | 'end') => (e: React.PointerEvent) => void }) => {
  const ticks = useMemo(() => {
    const step = zoom > 1.6 ? 10 : zoom > 0.8 ? 25 : zoom > 0.4 ? 50 : 100;
    const out: { pos: number; label?: string; major: boolean }[] = [];
    const start = Math.floor(-offset / zoom / step) * step;
    const end = (length - offset) / zoom;
    for (let v = start; v <= end; v += step) {
      const major = v % (step * 2) === 0;
      out.push({ pos: offset + v * zoom, label: major ? String(Math.round(v)) : undefined, major });
    }
    return out;
  }, [length, zoom, offset]);
  const isH = orientation === 'h';
  const { t } = useTranslation('studio');
  return (
    <div className={isH ? 'absolute top-0 left-[22px] right-0 h-[22px] bg-white/95 border-b border-slate-200 overflow-hidden select-none' : 'absolute top-[22px] left-0 bottom-0 w-[22px] bg-white/95 border-r border-slate-200 overflow-hidden select-none'}>
      {margins && <div className="absolute bg-brand-100/70" style={isH ? { left: margins[0], width: Math.max(0, margins[1] - margins[0]), top: 0, bottom: 0 } : { top: margins[0], height: Math.max(0, margins[1] - margins[0]), left: 0, right: 0 }} />}
      {margins &&
        onDragEdge &&
        ([0, 1] as const).map((i) => (
          <div
            key={i}
            onPointerDown={onDragEdge(i === 0 ? 'start' : 'end')}
            title={t('canvas.ruler.dragMargin')}
            className={cn('group/mg absolute z-10', isH ? 'top-0 bottom-0 w-[11px] -ml-[5px] cursor-col-resize' : 'left-0 right-0 h-[11px] -mt-[5px] cursor-row-resize')}
            style={isH ? { left: margins[i] } : { top: margins[i] }}
          >
            <span className={cn('absolute rounded-full bg-brand-500 group-hover/mg:bg-brand-700', isH ? 'inset-y-[3px] left-1/2 -translate-x-1/2 w-[3px]' : 'inset-x-[3px] top-1/2 -translate-y-1/2 h-[3px]')} />
          </div>
        ))}
      {ticks.map((t, i) => (
        <div key={i} className="absolute text-[8px] text-slate-500 font-mono" style={isH ? { left: t.pos, top: 0, height: '100%' } : { top: t.pos, left: 0, width: '100%' }}>
          <div className={isH ? 'absolute bottom-0 w-px bg-slate-400' : 'absolute right-0 h-px bg-slate-400'} style={isH ? { height: t.major ? 10 : 5 } : { width: t.major ? 10 : 5 }} />
          {t.label && <span className={isH ? 'absolute left-1 top-0' : 'absolute left-0.5 top-0.5 [writing-mode:vertical-rl] rotate-180'}>{t.label}</span>}
        </div>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ Canvas (continuous pages) */
const StudioCanvas = forwardRef<StudioCanvasHandle, { api: StudioApi; onDropFiles?: (files: File[]) => void }>(({ api, onDropFiles }, ref) => {
  const { doc, page, pageIndex, selectedIds, select, selectOnPage, setActivePage, tool, setTool, zoom, setZoom, pan, setPan, addElement, addTextAt, updateElements, commit, editingTextId, setEditingTextId, showRulers, setShowRulers, showMargins, setShowMargins, formatBrush, applyFormatTo, setFormatBrush, updatePage, cut, copy, paste, duplicateSelected, deleteSelected, reorder, reorderRelative, reverseOrder, alignSelected, selectAll, selectSameType, toggleLock, toggleHidden } = api;
  const pages = doc.pages;
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const pageRefs = useRef<(Konva.Group | null)[]>([]);
  const trRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<{ page: number; x: number; y: number; w: number; h: number } | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; pageIndex: number; world: { x: number; y: number }; stack: EditorElement[] } | null>(null);
  const [, setFontTick] = useState(0);
  const marqueeStart = useRef<{ page: number; x: number; y: number } | null>(null);
  const drawing = useRef<{ id: string; page: number; startX: number; startY: number } | null>(null);
  const spaceDown = useRef(false);
  const rulerOffset = showRulers ? RULER : 0;

  const layout = useMemo(() => {
    const maxW = Math.max(...pages.map((p) => p.width), 1);
    let y = 0;
    const offsets = pages.map((p) => {
      const o = { x: (maxW - p.width) / 2, y };
      y += p.height + PAGE_GAP;
      return o;
    });
    return { maxW, totalH: Math.max(0, y - PAGE_GAP), offsets };
  }, [pages]);

  useEffect(() => {
    const off = onFontsChanged(() => setFontTick((t) => t + 1));
    return () => {
      off();
    };
  }, []);
  useEffect(() => {
    const fams = new Set<string>();
    pages.forEach((p) => p.elements.forEach((e) => e.type === 'text' && e.fontFamily && fams.add(e.fontFamily)));
    fams.forEach((f) => void ensureWebFont(f));
  }, [pages]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth - rulerOffset, height: el.clientHeight - rulerOffset }));
    ro.observe(el);
    setSize({ width: el.clientWidth - rulerOffset, height: el.clientHeight - rulerOffset });
    return () => ro.disconnect();
  }, [rulerOffset]);

  const EDGE = 24;
  /** Keep the document inside the viewport: centre it when smaller, otherwise never scroll past its edges. */
  const clampPan = useCallback(
    (p: { x: number; y: number }, z = zoom, s = size) => {
      const cw = layout.maxW * z;
      const ch = layout.totalH * z;
      const x = cw + EDGE * 2 <= s.width ? (s.width - cw) / 2 : Math.max(s.width - cw - EDGE, Math.min(EDGE, p.x));
      const y = ch + EDGE * 2 <= s.height ? (s.height - ch) / 2 : Math.max(s.height - ch - EDGE, Math.min(EDGE, p.y));
      return { x, y };
    },
    [layout, zoom, size]
  );
  const autoFitZoom = useRef<number | null>(null);

  const fitWidth = useCallback(() => {
    if (!size.width) return;
    const pad = 48;
    const z = Math.min((size.width - pad) / layout.maxW, 3);
    autoFitZoom.current = z;
    setZoom(z);
    const off = layout.offsets[Math.min(pageIndex, layout.offsets.length - 1)] || { x: 0, y: 0 };
    setPan(clampPan({ x: (size.width - layout.maxW * z) / 2, y: -off.y * z + 16 }, z));
  }, [size, layout, pageIndex, setZoom, setPan, clampPan]);

  const fit = useCallback(() => {
    if (!page || !size.width) return;
    const pad = 56;
    const z = Math.min((size.width - pad) / page.width, (size.height - pad) / page.height, 3);
    autoFitZoom.current = null;
    setZoom(z);
    const off = layout.offsets[pageIndex] || { x: 0, y: 0 };
    setPan(clampPan({ x: (size.width - layout.maxW * z) / 2, y: -off.y * z + (size.height - page.height * z) / 2 }, z));
  }, [page, size, layout, pageIndex, setZoom, setPan, clampPan]);

  const zoomBy = useCallback(
    (factor: number, center?: { x: number; y: number }) => {
      const c = center || { x: size.width / 2, y: size.height / 2 };
      const nz = Math.max(0.1, Math.min(6, zoom * factor));
      const wx = (c.x - pan.x) / zoom;
      const wy = (c.y - pan.y) / zoom;
      autoFitZoom.current = null;
      setZoom(nz);
      setPan(clampPan({ x: c.x - wx * nz, y: c.y - wy * nz }, nz));
    },
    [zoom, pan, size, setZoom, setPan, clampPan]
  );

  const scrollToPage = useCallback(
    (i: number) => {
      const off = layout.offsets[i];
      if (!off) return;
      setPan(clampPan({ x: pan.x, y: -off.y * zoom + 16 }));
      setActivePage(i);
    },
    [layout, pan.x, zoom, setPan, setActivePage, clampPan]
  );

  // viewport resized (panels toggled, window resized, fullscreen): keep auto-fit or just re-clamp/centre
  const lastSize = useRef(size);
  useEffect(() => {
    if (!size.width || !size.height) return;
    if (lastSize.current.width === size.width && lastSize.current.height === size.height) return;
    lastSize.current = size;
    if (autoFitZoom.current !== null && Math.abs(autoFitZoom.current - zoom) < 0.001) fitWidth();
    else setPan((p) => clampPan(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  const initialFit = useRef<string | null>(null);
  useEffect(() => {
    const key = `${pages[0]?.id}-${pages.length}-${pages[0]?.width}`;
    if (size.width > 0 && pages.length && initialFit.current !== key) {
      initialFit.current = key;
      fitWidth();
    }
  }, [size, pages, fitWidth]);

  // active page follows the viewport
  useEffect(() => {
    if (!size.height || pages.length < 2) return;
    const centerY = (size.height / 2 - pan.y) / zoom;
    let best = 0;
    let bestD = Infinity;
    layout.offsets.forEach((o, i) => {
      const d = Math.abs(o.y + pages[i].height / 2 - centerY);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best !== pageIndex && selectedIds.length === 0 && !editingTextId) setActivePage(best);
  }, [pan.y, zoom, size.height, layout, pages, pageIndex, selectedIds.length, editingTextId, setActivePage]);

  useImperativeHandle(ref, () => ({
    capturePage: (index, pixelRatio = 0.3) => {
      const g = pageRefs.current[index];
      const p = pages[index];
      if (!g || !p) return null;
      try {
        // A regiao tem de sair do proprio node: refazer a conta com pan/zoom capturados
        // pelo closure desalinha o recorte e a miniatura sai preta (JPEG sobre pixels
        // transparentes). getAbsolutePosition/Scale ja embutem pan, zoom e o offset da pagina.
        const abs = g.getAbsolutePosition();
        const sc = g.getAbsoluteScale();
        if (!sc.x || !sc.y) return null;
        return g.toDataURL({
          x: abs.x,
          y: abs.y,
          width: p.width * sc.x,
          height: p.height * sc.y,
          pixelRatio: pixelRatio / sc.x,
          mimeType: 'image/jpeg',
          quality: 0.7
        });
      } catch {
        return null;
      }
    },
    fit,
    fitWidth,
    zoomBy,
    scrollToPage
  }));

  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const all = pages.flatMap((p) => p.elements);
    // Konva's '#id' selector does not understand CSS escapes, and UUIDs often start with a digit —
    // match by predicate so every element gets its handles.
    const nodes = selectedIds.map((id) => stage.findOne((n: Konva.Node) => n.id() === id)).filter((n): n is Konva.Node => Boolean(n) && !all.find((e) => e.id === (n as Konva.Node).id())?.locked);
    tr.nodes(nodes);
    tr.forceUpdate();
    tr.getLayer()?.batchDraw();
  }, [selectedIds, pages, zoom]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        spaceDown.current = true;
        if (stageRef.current) stageRef.current.container().style.cursor = 'grab';
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false;
        if (stageRef.current) stageRef.current.container().style.cursor = '';
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const toWorld = useCallback(
    (stage: Konva.Stage) => {
      const p = stage.getPointerPosition();
      if (!p) return null;
      return { x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom };
    },
    [pan, zoom]
  );
  const pageAt = useCallback(
    (wx: number, wy: number) => {
      let idx = pages.findIndex((p, i) => wy >= layout.offsets[i].y - PAGE_GAP / 2 && wy <= layout.offsets[i].y + p.height + PAGE_GAP / 2);
      if (idx === -1) idx = wy < 0 ? 0 : pages.length - 1;
      const off = layout.offsets[idx];
      return { idx, x: wx - off.x, y: wy - off.y };
    },
    [pages, layout]
  );
  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: (clientX - rect.left - rulerOffset - pan.x) / zoom, y: (clientY - rect.top - rulerOffset - pan.y) / zoom };
    },
    [pan, zoom, rulerOffset]
  );

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const p = stageRef.current?.getPointerPosition();
      zoomBy(e.evt.deltaY < 0 ? 1.08 : 1 / 1.08, p || undefined);
    } else if (e.evt.shiftKey && !e.evt.deltaX) {
      setPan(clampPan({ x: pan.x - e.evt.deltaY, y: pan.y }));
    } else {
      setPan(clampPan({ x: pan.x - e.evt.deltaX, y: pan.y - e.evt.deltaY }));
    }
  };

  // ---- DOM scrollbars (mouse users): drag thumbs to pan
  const cw = layout.maxW * zoom + EDGE * 2;
  const ch = layout.totalH * zoom + EDGE * 2;
  const vTrack = size.height;
  const hTrack = size.width;
  const showV = ch > size.height + 1;
  const showH = cw > size.width + 1;
  const vThumb = showV ? Math.max(28, (size.height / ch) * vTrack) : 0;
  const hThumb = showH ? Math.max(28, (size.width / cw) * hTrack) : 0;
  const vPos = showV ? ((EDGE - pan.y) / (ch - size.height)) * (vTrack - vThumb) : 0;
  const hPos = showH ? ((EDGE - pan.x) / (cw - size.width)) * (hTrack - hThumb) : 0;
  const dragThumb = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    e.preventDefault();
    const start = axis === 'y' ? e.clientY : e.clientX;
    const startPan = pan;
    const range = axis === 'y' ? ch - size.height : cw - size.width;
    const track = axis === 'y' ? vTrack - vThumb : hTrack - hThumb;
    const move = (ev: PointerEvent) => {
      const delta = ((axis === 'y' ? ev.clientY : ev.clientX) - start) * (range / Math.max(1, track));
      setPan(clampPan(axis === 'y' ? { x: startPan.x, y: startPan.y - delta } : { x: startPan.x - delta, y: startPan.y }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const placeImage = useCallback(
    (src: string, wx: number, wy: number) => {
      const { idx, x, y } = pageAt(wx, wy);
      const img = new Image();
      img.onload = () => {
        const maxW = (pages[idx]?.width || 595) * 0.5;
        const scale = Math.min(1, maxW / img.naturalWidth);
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        addElement({ type: 'image', content: src, x: Math.round(x - w / 2), y: Math.round(y - h / 2), width: w, height: h, name: 'Imagem' }, { center: false, page: idx });
      };
      img.src = src;
    },
    [addElement, pageAt, pages]
  );
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropHover(false);
    const { x, y } = clientToWorld(e.clientX, e.clientY);
    const src = e.dataTransfer.getData('application/x-studio-image');
    if (src) return placeImage(src, x, y);
    const files = Array.from(e.dataTransfer.files || []);
    const images = files.filter((f) => f.type.startsWith('image/'));
    const others = files.filter((f) => !f.type.startsWith('image/'));
    if (others.length && onDropFiles) onDropFiles(others);
    images.forEach((file, i) => {
      const r = new FileReader();
      r.onload = () => placeImage(String(r.result), x + i * 20, y + i * 20);
      r.readAsDataURL(file);
    });
  };

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = stageRef.current;
    if (!stage || !pages.length) return;
    if (editingTextId) return;
    // the right button only opens the context menu: it must not clear the selection, start a marquee or draw
    if ('button' in e.evt && e.evt.button === 2) return;
    if (tool === 'hand' || spaceDown.current) return;
    const w = toWorld(stage);
    if (!w) return;
    const { idx, x, y } = pageAt(w.x, w.y);
    const clickedBackground = e.target === stage || e.target.name() === 'page-bg';
    if (tool === 'select') {
      if (clickedBackground && formatBrush) setFormatBrush(null);
      if (clickedBackground) {
        if (!('shiftKey' in e.evt && e.evt.shiftKey)) selectOnPage(idx, null);
        marqueeStart.current = { page: idx, x, y };
        setMarquee({ page: idx, x, y, w: 0, h: 0 });
      }
      return;
    }
    const id = crypto.randomUUID();
    const base = { id, x, y, width: 1, height: 1, content: '', stroke: '#1b3f8b', strokeWidth: 2 } as EditorElement;
    const o = { select: false, center: false, page: idx };
    if (tool === 'rect') addElement({ ...base, type: 'rect', fill: '#dbe4f6', name: 'Retângulo' }, o);
    else if (tool === 'circle') addElement({ ...base, type: 'circle', fill: '#d3efd6', stroke: '#2e8b3d', name: 'Elipse' }, o);
    else if (tool === 'line') addElement({ ...base, type: 'line', points: [0, 0, 1, 1], name: 'Linha' }, o);
    else if (tool === 'arrow') addElement({ ...base, type: 'arrow', points: [0, 0, 1, 1], fill: '#1b3f8b', name: 'Seta' }, o);
    else if (tool === 'pen') addElement({ ...base, x: 0, y: 0, width: 0, height: 0, type: 'line', points: [x, y], strokeWidth: 3, name: 'Desenho' }, o);
    else if (tool === 'highlight') addElement({ ...base, type: 'rect', fill: '#fde047', stroke: 'transparent', strokeWidth: 0, opacity: 0.45, name: 'Realce' }, o);
    else if (tool === 'whiteout') addElement({ ...base, type: 'rect', fill: '#ffffff', stroke: 'transparent', strokeWidth: 0, name: 'Cobrir' }, o);
    else if (tool === 'text') {
      const nid = addTextAt({ x, y, page: idx });
      setTool('select');
      setTimeout(() => setEditingTextId(nid), 30);
      return;
    }
    drawing.current = { id, page: idx, startX: x, startY: y };
  };

  /** Word/Canva-style click-and-type: double-clicking empty page space drops a text box there and opens it for typing. */
  const onStageDblClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = stageRef.current;
    if (!stage || !pages.length || editingTextId || tool !== 'select') return;
    if (e.target.name() !== 'page-bg') return;
    const w = toWorld(stage);
    if (!w) return;
    const { idx, x, y } = pageAt(w.x, w.y);
    marqueeStart.current = null;
    setMarquee(null);
    const nid = addTextAt({ x, y, page: idx });
    setTimeout(() => setEditingTextId(nid), 30);
  };

  const onMouseMove = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const w = toWorld(stage);
    if (!w) return;
    if (marqueeStart.current) {
      const s = marqueeStart.current;
      const off = layout.offsets[s.page];
      const x = w.x - off.x;
      const y = w.y - off.y;
      setMarquee({ page: s.page, x: Math.min(s.x, x), y: Math.min(s.y, y), w: Math.abs(x - s.x), h: Math.abs(y - s.y) });
      return;
    }
    const d = drawing.current;
    if (!d) return;
    const off = layout.offsets[d.page];
    const x = w.x - off.x;
    const y = w.y - off.y;
    const el = pages[d.page]?.elements.find((e) => e.id === d.id);
    if (!el) return;
    if (tool === 'pen') updateElements([d.id], { points: [...(el.points || []), x, y] }, { history: false });
    else if (tool === 'rect' || tool === 'circle' || tool === 'highlight' || tool === 'whiteout') updateElements([d.id], { x: Math.min(d.startX, x), y: Math.min(d.startY, y), width: Math.max(2, Math.abs(x - d.startX)), height: Math.max(2, Math.abs(y - d.startY)) }, { history: false });
    else updateElements([d.id], { points: [0, 0, x - d.startX, y - d.startY], width: Math.abs(x - d.startX), height: Math.abs(y - d.startY) }, { history: false });
  };

  const onMouseUp = () => {
    if (marqueeStart.current && marquee) {
      const els = pages[marquee.page]?.elements || [];
      const hits = els.filter((el) => !el.locked && !el.hidden && el.x < marquee.x + marquee.w && el.x + el.width > marquee.x && el.y < marquee.y + marquee.h && el.y + el.height > marquee.y).map((e) => e.id);
      if (marquee.w > 3 && marquee.h > 3 && hits.length) selectOnPage(marquee.page, hits);
      marqueeStart.current = null;
      setMarquee(null);
    }
    if (drawing.current) {
      const { id, page: pIdx } = drawing.current;
      drawing.current = null;
      const el = pages[pIdx]?.elements.find((x) => x.id === id);
      if (el && tool === 'pen' && el.points && el.points.length >= 4) {
        const xs = el.points.filter((_, i) => i % 2 === 0);
        const ys = el.points.filter((_, i) => i % 2 === 1);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        updateElements([id], { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY, points: el.points.map((v, i) => (i % 2 === 0 ? v - minX : v - minY)) });
      } else commit();
      selectOnPage(pIdx, id);
      if (tool !== 'pen' && tool !== 'highlight' && tool !== 'whiteout') setTool('select');
    }
  };

  const computeGuides = useCallback(
    (node: Konva.Node, id: string, pIdx: number) => {
      const p = pages[pIdx];
      if (!p) return { dx: 0, dy: 0, guides: [] as Guide[] };
      const off = layout.offsets[pIdx];
      const box = { x: node.x(), y: node.y(), w: node.width() * node.scaleX(), h: node.height() * node.scaleY() };
      const m = p.margins;
      const vT: { v: number; kind?: 'margin' }[] = [{ v: 0 }, { v: p.width / 2 }, { v: p.width }];
      const hT: { v: number; kind?: 'margin' }[] = [{ v: 0 }, { v: p.height / 2 }, { v: p.height }];
      if (m && showMargins) {
        vT.push({ v: m.left, kind: 'margin' }, { v: p.width - m.right, kind: 'margin' });
        hT.push({ v: m.top, kind: 'margin' }, { v: p.height - m.bottom, kind: 'margin' });
      }
      p.elements.forEach((el) => {
        if (el.id === id || el.hidden || selectedIds.includes(el.id)) return;
        vT.push({ v: el.x }, { v: el.x + el.width / 2 }, { v: el.x + el.width });
        hT.push({ v: el.y }, { v: el.y + el.height / 2 }, { v: el.y + el.height });
      });
      const ex = [box.x, box.x + box.w / 2, box.x + box.w];
      const ey = [box.y, box.y + box.h / 2, box.y + box.h];
      let dx = 0;
      let dy = 0;
      let gv = null as Guide | null;
      let gh = null as Guide | null;
      let bx = SNAP / zoom;
      ex.forEach((e) => vT.forEach((t) => {
        const d = Math.abs(t.v - e);
        if (d < bx) {
          bx = d;
          dx = t.v - e;
          gv = { orientation: 'v', pos: off.x + t.v, kind: t.kind };
        }
      }));
      let by = SNAP / zoom;
      ey.forEach((e) => hT.forEach((t) => {
        const d = Math.abs(t.v - e);
        if (d < by) {
          by = d;
          dy = t.v - e;
          gh = { orientation: 'h', pos: off.y + t.v, kind: t.kind };
        }
      }));
      return { dx, dy, guides: [gv, gh].filter((g): g is Guide => Boolean(g)) };
    },
    [pages, layout, selectedIds, zoom, showMargins]
  );

  const onDragMove = (id: string, pIdx: number, e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    if (node.rotation() === 0 && selectedIds.length <= 1) {
      const { dx, dy, guides: gs } = computeGuides(node, id, pIdx);
      node.x(node.x() + dx);
      node.y(node.y() + dy);
      setGuides(gs);
    }
  };
  const onDragEnd = (id: string, pIdx: number, e: Konva.KonvaEventObject<DragEvent>) => {
    setGuides([]);
    const node = e.target;
    const els = pages[pIdx]?.elements || [];
    if (selectedIds.length > 1 && selectedIds.includes(id)) {
      const el = els.find((x) => x.id === id);
      if (!el) return;
      const dx = node.x() - el.x;
      const dy = node.y() - el.y;
      updateElements(selectedIds, (x) => (x.id === id ? { x: node.x(), y: node.y() } : { x: x.x + dx, y: x.y + dy }));
    } else updateElements([id], { x: node.x(), y: node.y() });
  };
  const onTransformEnd = (id: string, pIdx: number, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const el = pages[pIdx]?.elements.find((x) => x.id === id);
    if (!el) return;
    const sx = node.scaleX();
    const sy = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    if (el.type === 'path' || el.type === 'checkmark') {
      const w = Math.max(4, el.width * sx);
      const h = Math.max(4, el.height * sy);
      // icon paths are authored in a 24pt box, imported PDF vectors carry their own scale — grow whatever is there
      const baseX = el.scaleX ?? el.width / 24;
      const baseY = el.scaleY ?? el.height / 24;
      updateElements([id], { x: node.x(), y: node.y(), rotation: node.rotation(), width: w, height: h, scaleX: baseX * sx, scaleY: baseY * sy });
      return;
    }
    if (el.type === 'line' || el.type === 'arrow') {
      updateElements([id], { x: node.x(), y: node.y(), rotation: node.rotation(), points: (el.points || []).map((v, i) => (i % 2 === 0 ? v * sx : v * sy)), width: el.width * sx, height: el.height * sy });
      return;
    }
    if (el.type === 'text') {
      // live reflow already applied the size to the node (see onTextTransform); commit it + the accumulated font scale
      const g = node as Konva.Group;
      const fsScale = (g.getAttr('fsScale') as number | undefined) || 1;
      g.setAttr('fsScale', undefined);
      const anchor = trRef.current?.getActiveAnchor() || '';
      const sideResize = el.wrap === 'none' && !/(top|bottom)-(left|right)/.test(anchor);
      updateElements([id], { x: node.x(), y: node.y(), rotation: node.rotation(), width: Math.max(8, node.width() * sx), height: Math.max(8, node.height() * sy), ...(fsScale !== 1 ? { fontSize: Math.max(2, Math.round((el.fontSize || 16) * fsScale * 100) / 100) } : {}), ...(sideResize ? { wrap: 'word' as const } : {}) });
      return;
    }
    updateElements([id], { x: node.x(), y: node.y(), rotation: node.rotation(), width: Math.max(4, el.width * sx), height: Math.max(4, el.height * sy) });
  };

  /**
   * Text boxes never stretch: like Word/Canva, side handles resize the box and reflow the text, corner handles scale the
   * font proportionally. Konva applies scaleX/scaleY to the node while dragging, so undo that on every step and push the
   * size into the children instead (state is committed once in onTransformEnd).
   */
  const onTextTransform = (el: EditorElement, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target as Konva.Group;
    const sx = node.scaleX();
    const sy = node.scaleY();
    if (sx === 1 && sy === 1) return;
    const anchor = trRef.current?.getActiveAnchor() || '';
    const corner = /(top|bottom)-(left|right)/.test(anchor);
    const w = Math.max(8, node.width() * sx);
    const h = Math.max(8, node.height() * sy);
    node.setAttrs({ width: w, height: h, scaleX: 1, scaleY: 1 });
    const rect = node.findOne<Konva.Rect>('Rect');
    const text = node.findOne<Konva.Text>('Text');
    rect?.size({ width: w, height: h });
    if (text) {
      const pad = el.padding ?? 4;
      text.width(Math.max(4, w - pad * 2 - (el.indent || 0)));
      if (corner) {
        const k = sy; // keepRatio is on for text, so sx === sy
        text.fontSize(text.fontSize() * k);
        node.setAttr('fsScale', ((node.getAttr('fsScale') as number | undefined) || 1) * k);
      }
    }
  };

  /** Screen-space bounding box of the current selection, used to anchor the floating toolbar. */
  const selectionRect = useMemo(() => {
    if (!selectedIds.length || editingTextId) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pages.forEach((p, i) => {
      const off = layout.offsets[i];
      p.elements.forEach((el) => {
        if (!selectedIds.includes(el.id) || el.hidden) return;
        const rad = ((el.rotation || 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        [
          [0, 0],
          [el.width, 0],
          [el.width, el.height],
          [0, el.height]
        ].forEach(([cx, cy]) => {
          const wx = off.x + el.x + cx * cos - cy * sin;
          const wy = off.y + el.y + cx * sin + cy * cos;
          minX = Math.min(minX, wx);
          minY = Math.min(minY, wy);
          maxX = Math.max(maxX, wx);
          maxY = Math.max(maxY, wy);
        });
      });
    });
    if (!Number.isFinite(minX)) return null;
    return {
      x: rulerOffset + pan.x + minX * zoom,
      y: rulerOffset + pan.y + minY * zoom,
      width: (maxX - minX) * zoom,
      height: (maxY - minY) * zoom
    };
  }, [selectedIds, editingTextId, pages, layout, pan, zoom, rulerOffset]);

  const startTextEdit = (el: EditorElement, pIdx: number) => {
    if (el.locked) return;
    selectOnPage(pIdx, el.id);
    setEditingTextId(el.id);
  };
  useEffect(() => {
    if (!editingTextId) return;
    const pIdx = pages.findIndex((p) => p.elements.some((e) => e.id === editingTextId));
    const el = pages[pIdx]?.elements.find((x) => x.id === editingTextId);
    const container = containerRef.current;
    if (!el || !container || pIdx === -1) return;
    const off = layout.offsets[pIdx];
    const ta = document.createElement('textarea');
    container.appendChild(ta);
    ta.value = el.content;
    const rad = ((el.rotation || 0) * Math.PI) / 180;
    const pad = (el.padding ?? 4) * zoom;
    const indent = (el.indent || 0) * zoom;
    const { fontSize: editFontSize } = scriptMetrics(el);
    const weight = el.fontWeight ?? (el.fontStyle?.includes('bold') ? 700 : 400);
    Object.assign(ta.style, {
      position: 'absolute',
      left: `${rulerOffset + pan.x + (off.x + el.x) * zoom}px`,
      top: `${rulerOffset + pan.y + (off.y + el.y) * zoom}px`,
      width: `${el.width * zoom}px`,
      minHeight: `${el.height * zoom}px`,
      fontSize: `${editFontSize * zoom}px`,
      fontFamily: `"${el.fontFamily || 'Helvetica'}", sans-serif`,
      fontWeight: String(weight),
      fontStyle: el.fontStyle?.includes('italic') ? 'italic' : 'normal',
      textDecoration: el.textDecoration || 'none',
      textTransform: el.textTransform || 'none',
      lineHeight: String(el.lineHeight || 1.25),
      letterSpacing: `${(el.letterSpacing || 0) * zoom}px`,
      textAlign: el.align === 'justify' ? 'left' : el.align || 'left',
      color: el.fill || '#000',
      background: el.backgroundColor && el.backgroundColor !== 'transparent' ? el.backgroundColor : 'rgba(255,255,255,0.75)',
      border: 'none',
      outline: 'none',
      resize: 'none',
      padding: `${pad}px ${pad}px ${pad}px ${pad + indent}px`,
      margin: '0',
      overflow: 'hidden',
      transformOrigin: 'left top',
      transform: `rotate(${rad}rad)`,
      zIndex: '20',
      boxSizing: 'border-box',
      whiteSpace: el.wrap === 'none' ? 'pre' : 'pre-wrap'
    } as CSSStyleDeclaration);
    ta.focus();
    if (!el.content) ta.placeholder = 'Digite…';
    else ta.setSelectionRange(ta.value.length, ta.value.length);
    const stage = stageRef.current;
    const node = stage?.findOne((n: Konva.Node) => n.id() === el.id) as Konva.Group | undefined;
    const grow = () => {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
      // The textarea itself is borderless: the box being edited is outlined by the same Transformer border every
      // other selected element gets. Push the grown height into the (hidden) node so that outline keeps hugging it.
      if (!node) return;
      const h = Math.max(el.height, ta.scrollHeight / zoom);
      node.height(h);
      node.findOne<Konva.Rect>('Rect')?.height(h);
      trRef.current?.forceUpdate();
      node.getLayer()?.batchDraw();
    };
    grow();
    const finish = () => {
      const value = ta.value;
      const newHeight = Math.max(el.height, ta.scrollHeight / zoom);
      if (!value.trim() && !el.content) api.deleteSelected();
      else updateElements([el.id], { content: value, height: Math.round(newHeight) });
      setEditingTextId(null);
    };
    ta.addEventListener('input', grow);
    ta.addEventListener('blur', finish);
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') finish();
    });
    return () => ta.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTextId]);

  /* ------------------------------------------------------------------ right-click menu */
  /** Elements whose (rotated) box contains the page-local point, topmost first */
  const stackAt = useCallback((pIdx: number, px: number, py: number): EditorElement[] => {
    const els = pages[pIdx]?.elements || [];
    const hit = els.filter((el) => {
      if (el.hidden) return false;
      const rad = (-(el.rotation || 0) * Math.PI) / 180;
      const dx = px - el.x;
      const dy = py - el.y;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      const w = el.width * (el.type === 'path' ? 1 : el.scaleX || 1);
      const h = el.height * (el.type === 'path' ? 1 : el.scaleY || 1);
      return lx >= -2 && ly >= -2 && lx <= w + 2 && ly <= h + 2;
    });
    return hit.reverse();
  }, [pages]);

  const openContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      if (editingTextId) return;
      const ptr = stageRef.current?.getPointerPosition();
      if (!ptr) return;
      const { idx, x, y } = pageAt((ptr.x - pan.x) / zoom, (ptr.y - pan.y) / zoom);
      const stack = stackAt(idx, x, y);
      if (idx !== pageIndex) setActivePage(idx);
      // right-clicking an unselected element selects it first, like every desktop editor
      const top = stack[0];
      if (top && !selectedIds.includes(top.id)) selectOnPage(idx, top.id);
      else if (!top && !e.evt.shiftKey) select(null);
      setMenu({ x: e.evt.clientX, y: e.evt.clientY, pageIndex: idx, world: { x, y }, stack });
    },
    [editingTextId, pageAt, pan, zoom, stackAt, pageIndex, setActivePage, selectedIds, selectOnPage, select]
  );

  const menuItems = useMemo((): MenuItem[] => {
    if (!menu) return [];
    const sel = pages[menu.pageIndex]?.elements.filter((el) => selectedIds.includes(el.id)) || [];
    const has = sel.length > 0;
    const locked = has && sel.every((el) => el.locked);
    const others = menu.stack.filter((el) => !selectedIds.includes(el.id));
    const label = (el: EditorElement) => el.name?.trim() || { text: 'Texto', image: 'Imagem', path: 'Vetor', rect: 'Retângulo', circle: 'Elipse', line: 'Linha', arrow: 'Seta', checkmark: 'Marca' }[el.type];
    const relative = (side: 'above' | 'below'): MenuItem[] =>
      others.map((el, i) => ({ id: `${side}-${el.id}`, label: `${i + 1}. ${label(el)}`, onClick: () => reorderRelative(el.id, side) }));

    const arrange: MenuItem = {
      id: 'arrange',
      label: 'Organizar',
      icon: Layers,
      disabled: !has,
      items: [
        { id: 'front', label: 'Trazer para frente', icon: BringToFront, shortcut: '⌘⇧]', onClick: () => reorder('front') },
        { id: 'forward', label: 'Avançar uma camada', icon: ArrowUp, shortcut: '⌘]', onClick: () => reorder('forward') },
        { id: 'backward', label: 'Recuar uma camada', icon: ArrowDown, shortcut: '⌘[', onClick: () => reorder('backward') },
        { id: 'back', label: 'Enviar para trás', icon: SendToBack, shortcut: '⌘⇧[', onClick: () => reorder('back') },
        { id: 'reverse', label: 'Inverter ordem da seleção', icon: FlipVertical2, separatorBefore: true, disabled: selectedIds.length < 2, onClick: reverseOrder },
        { id: 'above', label: 'Colocar à frente de…', icon: BringToFront, separatorBefore: true, disabled: !others.length, items: relative('above') },
        { id: 'below', label: 'Colocar atrás de…', icon: SendToBack, disabled: !others.length, items: relative('below') }
      ]
    };

    const align: MenuItem = {
      id: 'align',
      label: sel.length > 1 ? 'Alinhar seleção' : 'Alinhar na página',
      icon: AlignCenterVertical,
      disabled: !has,
      items: [
        { id: 'a-left', label: 'Esquerda', icon: AlignStartVertical, onClick: () => alignSelected('left') },
        { id: 'a-hcenter', label: 'Centro horizontal', icon: AlignCenterVertical, onClick: () => alignSelected('hcenter') },
        { id: 'a-right', label: 'Direita', icon: AlignEndVertical, onClick: () => alignSelected('right') },
        { id: 'a-top', label: 'Topo', icon: AlignStartHorizontal, separatorBefore: true, onClick: () => alignSelected('top') },
        { id: 'a-vcenter', label: 'Centro vertical', icon: AlignCenterHorizontal, onClick: () => alignSelected('vcenter') },
        { id: 'a-bottom', label: 'Base', icon: AlignEndHorizontal, onClick: () => alignSelected('bottom') }
      ]
    };

    const pick: MenuItem = {
      id: 'pick',
      label: 'Selecionar',
      icon: MousePointerClick,
      items: [
        ...menu.stack.map((el, i) => ({
          id: `pick-${el.id}`,
          label: `${i + 1}. ${label(el)}`,
          icon: selectedIds.includes(el.id) ? Square : undefined,
          onClick: () => selectOnPage(menu.pageIndex, el.id)
        })),
        { id: 'pick-add', label: 'Adicionar à seleção…', separatorBefore: true, disabled: menu.stack.length < 2, items: menu.stack.map((el, i) => ({ id: `add-${el.id}`, label: `${i + 1}. ${label(el)}`, onClick: () => select(el.id, { toggle: true }) })) },
        { id: 'pick-type', label: 'Todos do mesmo tipo', separatorBefore: true, disabled: !has, onClick: selectSameType },
        { id: 'pick-all', label: 'Selecionar tudo', shortcut: '⌘A', onClick: selectAll }
      ]
    };

    if (!has)
      return [
        { id: 'paste', label: 'Colar aqui', icon: ClipboardPaste, shortcut: '⌘V', disabled: !api.clipboardCount, onClick: () => paste(menu.world) },
        { id: 'select-all', label: 'Selecionar tudo', icon: MousePointerClick, shortcut: '⌘A', onClick: selectAll },
        ...(menu.stack.length ? [pick] : []),
        { id: 'rulers', label: showRulers ? 'Ocultar réguas' : 'Mostrar réguas', icon: RulerIcon, separatorBefore: true, onClick: () => setShowRulers(!showRulers) },
        { id: 'margins', label: showMargins ? 'Ocultar margens' : 'Mostrar margens', icon: Square, onClick: () => setShowMargins(!showMargins) }
      ];

    return [
      { id: 'cut', label: 'Recortar', icon: Scissors, shortcut: '⌘X', disabled: locked, onClick: cut },
      { id: 'copy', label: 'Copiar', icon: Copy, shortcut: '⌘C', onClick: copy },
      { id: 'paste', label: 'Colar aqui', icon: ClipboardPaste, shortcut: '⌘V', disabled: !api.clipboardCount, onClick: () => paste(menu.world) },
      { id: 'dup', label: 'Duplicar', icon: CopyPlus, shortcut: '⌘D', onClick: duplicateSelected },
      { ...arrange, separatorBefore: true },
      align,
      pick,
      { id: 'lock', label: locked ? 'Desbloquear' : 'Bloquear', icon: locked ? Unlock : Lock, separatorBefore: true, onClick: () => toggleLock() },
      { id: 'hide', label: 'Ocultar', icon: EyeOff, disabled: sel.length !== 1, onClick: () => toggleHidden(sel[0].id) },
      { id: 'del', label: 'Excluir', icon: Trash2, shortcut: 'Del', danger: true, separatorBefore: true, disabled: locked, onClick: deleteSelected }
    ];
  }, [menu, pages, selectedIds, reorder, reorderRelative, reverseOrder, alignSelected, selectOnPage, select, selectSameType, selectAll, api.clipboardCount, paste, cut, copy, duplicateSelected, toggleLock, toggleHidden, deleteSelected, showRulers, setShowRulers, showMargins, setShowMargins]);

  if (!pages.length)
    return (
      <div
        ref={containerRef}
        className="w-full h-full"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files || []);
          if (files.length && onDropFiles) onDropFiles(files);
        }}
      />
    );

  const cursor = formatBrush ? 'copy' : tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
  const curOff = layout.offsets[pageIndex] || { x: 0, y: 0 };
  const m = page?.margins;

  /**
   * Word-style margin editing: drag the brand-coloured grips on either ruler.
   * The pointer position is converted back to page points, the opposite margin is kept
   * at least MIN_CONTENT away, and only the pointerup is pushed onto the history stack.
   */
  const dragMargin = (axis: 'h' | 'v') => (edge: 'start' | 'end') => (e: React.PointerEvent) => {
    const el = containerRef.current;
    if (!el || !page) return;
    e.preventDefault();
    e.stopPropagation();
    if (!showMargins) setShowMargins(true);
    const MIN_CONTENT = 24;
    const rect = el.getBoundingClientRect();
    const size = axis === 'h' ? page.width : page.height;
    const base = axis === 'h' ? pan.x + curOff.x * zoom : pan.y + curOff.y * zoom;
    const start = { ...DEFAULT_MARGINS, ...page.margins };
    const move = (ev: PointerEvent) => {
      const local = axis === 'h' ? ev.clientX - rect.left - RULER : ev.clientY - rect.top - RULER;
      const v = Math.max(0, Math.min(size, Math.round((local - base) / zoom)));
      const next = { ...start };
      if (axis === 'h') {
        if (edge === 'start') next.left = Math.min(v, size - start.right - MIN_CONTENT);
        else next.right = Math.min(size - v, size - start.left - MIN_CONTENT);
      } else if (edge === 'start') next.top = Math.min(v, size - start.bottom - MIN_CONTENT);
      else next.bottom = Math.min(size - v, size - start.top - MIN_CONTENT);
      next.left = Math.max(0, next.left);
      next.right = Math.max(0, next.right);
      next.top = Math.max(0, next.top);
      next.bottom = Math.max(0, next.bottom);
      updatePage({ margins: next }, { history: false });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const renderElement = (el: EditorElement, pIdx: number) => {
    if (el.hidden) return null;
    const editable = tool === 'select' && !el.locked;
    const common = {
      id: el.id,
      x: el.x,
      y: el.y,
      rotation: el.rotation || 0,
      opacity: el.opacity ?? 1,
      draggable: editable,
      onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (tool !== 'select' || e.evt.button === 2) return;
        e.cancelBubble = true;
        if (formatBrush && !el.locked) {
          applyFormatTo(el.id);
          selectOnPage(pIdx, el.id);
          return;
        }
        if (el.locked) return selectOnPage(pIdx, el.id);
        if (e.evt.shiftKey && pIdx === pageIndex) select(el.id, { toggle: true });
        else if (!selectedIds.includes(el.id)) selectOnPage(pIdx, el.id);
      },
      onTap: () => tool === 'select' && selectOnPage(pIdx, el.id),
      onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (tool !== 'select') return;
        setHoverId(el.id);
        const st = e.target.getStage();
        if (st) st.container().style.cursor = el.locked ? 'not-allowed' : 'move';
      },
      onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
        setHoverId((h) => (h === el.id ? null : h));
        const st = e.target.getStage();
        if (st) st.container().style.cursor = '';
      },
      onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => onDragMove(el.id, pIdx, e),
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onDragEnd(el.id, pIdx, e),
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) => onTransformEnd(el.id, pIdx, e)
    };
    if (el.type === 'text') {
      const { fontSize: fs, dy } = scriptMetrics(el);
      const pad = el.padding ?? 4;
      const ind = el.indent || 0;
      return (
        <Group key={el.id} {...common} width={el.width} height={el.height} onTransform={(e) => onTextTransform(el, e)} onDblClick={() => startTextEdit(el, pIdx)} onDblTap={() => startTextEdit(el, pIdx)} visible={editingTextId !== el.id}>
          <Rect
            width={el.width}
            height={el.height}
            fill={el.backgroundColor && el.backgroundColor !== 'transparent' ? el.backgroundColor : 'rgba(0,0,0,0.001)'}
            stroke={el.stroke && el.stroke !== 'transparent' && (el.strokeWidth || 0) > 0 ? el.stroke : undefined}
            strokeWidth={el.strokeWidth || 0}
          />
          <Text
            x={pad + ind}
            y={pad + (el.spaceBefore || 0) + dy}
            width={Math.max(4, el.width - pad * 2 - ind)}
            text={renderedText(el)}
            fontSize={fs}
            fontFamily={`"${el.fontFamily || 'Helvetica'}", sans-serif`}
            fontStyle={konvaFontStyle(el)}
            textDecoration={el.textDecoration && el.textDecoration !== 'none' ? el.textDecoration : ''}
            align={el.align || 'left'}
            lineHeight={el.lineHeight || 1.25}
            letterSpacing={el.letterSpacing || 0}
            fill={el.fill || '#000'}
            wrap={el.wrap === 'none' ? 'none' : 'word'}
          />
        </Group>
      );
    }
    if (el.type === 'image') {
      return (
        <Group key={el.id} {...common} width={el.width} height={el.height}>
          <Rect width={el.width} height={el.height} fill="rgba(0,0,0,0.001)" />
          <URLImage src={el.content} width={el.width} height={el.height} />
        </Group>
      );
    }
    if (el.type === 'rect') return <Rect key={el.id} {...common} width={el.width} height={el.height} fill={el.fill === 'transparent' ? undefined : el.fill} stroke={el.stroke === 'transparent' ? undefined : el.stroke} strokeWidth={el.strokeWidth || 0} cornerRadius={el.cornerRadius || 0} />;
    if (el.type === 'circle') {
      return (
        <Group key={el.id} {...common} width={el.width} height={el.height}>
          <Ellipse x={el.width / 2} y={el.height / 2} radiusX={el.width / 2} radiusY={el.height / 2} fill={el.fill === 'transparent' ? undefined : el.fill} stroke={el.stroke === 'transparent' ? undefined : el.stroke} strokeWidth={el.strokeWidth || 0} />
        </Group>
      );
    }
    if (el.type === 'arrow') return <Arrow key={el.id} {...common} points={el.points || [0, 0, el.width, 0]} stroke={el.stroke} strokeWidth={el.strokeWidth || 2} fill={el.stroke} pointerLength={Math.max(8, (el.strokeWidth || 2) * 4)} pointerWidth={Math.max(8, (el.strokeWidth || 2) * 4)} hitStrokeWidth={16} />;
    if (el.type === 'line') return <Line key={el.id} {...common} points={el.points || [0, 0, el.width, 0]} stroke={el.stroke} strokeWidth={el.strokeWidth || 2} lineCap="round" lineJoin="round" hitStrokeWidth={16} />;
    if (el.type === 'path' || el.type === 'checkmark') {
      const data = el.type === 'checkmark' ? 'M4 12 L9 17 L20 6' : el.content;
      return (
        <Group key={el.id} {...common} width={el.width} height={el.height}>
          <Rect width={el.width} height={el.height} fill="transparent" />
          <Path data={data} scaleX={el.scaleX || el.width / 24} scaleY={el.scaleY || el.height / 24} fill={el.fill === 'transparent' ? undefined : el.fill} stroke={el.stroke === 'transparent' ? undefined : el.stroke} strokeWidth={el.strokeWidth ?? 2} lineCap="round" lineJoin="round" />
        </Group>
      );
    }
    return null;
  };

  const renderPage = (p: EditorPage, i: number) => {
    const off = layout.offsets[i];
    const active = i === pageIndex;
    return (
      <Group
        key={p.id}
        x={off.x}
        y={off.y}
        ref={(g) => {
          pageRefs.current[i] = g;
        }}
      >
        <Rect name="page-bg" x={0} y={0} width={p.width} height={p.height} fill={p.backgroundColor || '#ffffff'} shadowColor="#0f172a" shadowBlur={24 / zoom} shadowOpacity={0.14} shadowOffset={{ x: 0, y: 6 / zoom }} stroke={active && pages.length > 1 ? '#93c5fd' : undefined} strokeWidth={active ? 1.5 / zoom : 0} />
        {p.imageUrl && <URLImage src={p.imageUrl} x={0} y={0} width={p.width} height={p.height} listening={false} />}
        {!p.elements.length && !p.imageUrl && tool === 'select' && <Text text="Duplo clique para escrever" x={0} y={p.height / 2 - 9} width={p.width} align="center" fontSize={14} fontFamily="Helvetica" fill="#cbd5e1" listening={false} />}
        <Group clipX={0} clipY={0} clipWidth={p.width} clipHeight={p.height}>{p.elements.map((el) => renderElement(el, i))}</Group>
        {hoverId && !selectedIds.includes(hoverId) && p.elements.filter((el) => el.id === hoverId && !el.hidden).map((el) => <Rect key={`hover-${el.id}`} x={el.x} y={el.y} width={el.width} height={el.height} rotation={el.rotation || 0} stroke="#3b82f6" strokeWidth={1.5 / zoom} dash={[5 / zoom, 3 / zoom]} listening={false} />)}
        {showMargins && p.margins && active && <Rect x={p.margins.left} y={p.margins.top} width={p.width - p.margins.left - p.margins.right} height={p.height - p.margins.top - p.margins.bottom} stroke="#93c5fd" strokeWidth={1 / zoom} dash={[8 / zoom, 6 / zoom]} listening={false} />}
        {pages.length > 1 && <Text x={0} y={p.height + 6} width={p.width} align="center" text={`Página ${i + 1}`} fontSize={11 / zoom} fill="#64748b" listening={false} />}
      </Group>
    );
  };


  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#e9edf3]"
      style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '22px 22px' }}
      onDragOver={(e) => {
        e.preventDefault();
        setDropHover(true);
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={onDrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {showRulers && page && (
        <>
          <div className="absolute top-0 left-0 w-[22px] h-[22px] bg-white border-r border-b border-slate-200 z-10" />
          <Ruler orientation="h" length={size.width} zoom={zoom} offset={pan.x + curOff.x * zoom} margins={m ? [pan.x + (curOff.x + m.left) * zoom, pan.x + (curOff.x + page.width - m.right) * zoom] : undefined} onDragEdge={dragMargin('h')} />
          <Ruler orientation="v" length={size.height} zoom={zoom} offset={pan.y + curOff.y * zoom} margins={m ? [pan.y + (curOff.y + m.top) * zoom, pan.y + (curOff.y + page.height - m.bottom) * zoom] : undefined} onDragEdge={dragMargin('v')} />
        </>
      )}
      <div className="absolute" style={{ left: rulerOffset, top: rulerOffset, right: 0, bottom: 0 }}>
        <Stage ref={stageRef} width={size.width} height={size.height} onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onTouchStart={onMouseDown} onTouchMove={onMouseMove} onTouchEnd={onMouseUp} onDblClick={onStageDblClick} onDblTap={onStageDblClick} onContextMenu={openContextMenu} draggable={tool === 'hand'} x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom} onDragEnd={(e) => e.target === stageRef.current && setPan(clampPan({ x: e.target.x(), y: e.target.y() }))} style={{ cursor }}>
          <Layer>
            {pages.map(renderPage)}
            {guides.map((g, i) => (g.orientation === 'v' ? <Line key={i} points={[g.pos, -100000, g.pos, 100000]} stroke={g.kind === 'margin' ? '#2563eb' : '#f43f5e'} strokeWidth={1 / zoom} dash={[6 / zoom, 4 / zoom]} listening={false} /> : <Line key={i} points={[-100000, g.pos, 100000, g.pos]} stroke={g.kind === 'margin' ? '#2563eb' : '#f43f5e'} strokeWidth={1 / zoom} dash={[6 / zoom, 4 / zoom]} listening={false} />))}
            {marquee && <Rect x={layout.offsets[marquee.page].x + marquee.x} y={layout.offsets[marquee.page].y + marquee.y} width={marquee.w} height={marquee.h} fill="rgba(27,63,139,0.08)" stroke="#1b3f8b" strokeWidth={1 / zoom} listening={false} />}
            <Transformer
              ref={trRef}
              rotateEnabled
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              rotationSnapTolerance={5}
              keepRatio={selectedIds.length === 1 && ['image', 'path', 'checkmark', 'text'].includes(pages.flatMap((p) => p.elements).find((e) => e.id === selectedIds[0])?.type || '')}
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 4 || newBox.height < 4 ? oldBox : newBox)}
              anchorStyleFunc={(a) => {
                const name = a.name();
                a.fill('#ffffff');
                a.stroke('#1b3f8b');
                a.strokeWidth(1.5);
                if (name.includes('rotater')) {
                  // round rotate handle, like Word's green rotation grip
                  a.cornerRadius(7);
                  a.size({ width: 13, height: 13 });
                  a.stroke('#2e8b3d');
                  return;
                }
                const corner = /(top|bottom)-(left|right)/.test(name);
                if (corner) {
                  a.cornerRadius(6);
                  a.size({ width: 11, height: 11 });
                } else {
                  // side handles are short bars: they read as "resize this edge only"
                  const horizontal = name.includes('middle');
                  a.cornerRadius(3);
                  a.size(horizontal ? { width: 7, height: 18 } : { width: 18, height: 7 });
                }
              }}
              borderStroke="#1b3f8b"
              borderStrokeWidth={1.5}
              borderDash={[5, 3]}
              rotateAnchorOffset={30}
              padding={3}
              ignoreStroke
            />
          </Layer>
        </Stage>
      </div>
      {showV && (
        <div className="absolute top-0 bottom-0 right-0 w-2.5 z-20" style={{ top: rulerOffset }}>
          <div onPointerDown={dragThumb('y')} className="absolute right-0.5 w-1.5 rounded-full bg-slate-500/50 hover:bg-slate-600/70 cursor-pointer" style={{ top: vPos, height: vThumb }} />
        </div>
      )}
      {showH && (
        <div className="absolute left-0 right-0 bottom-0 h-2.5 z-20" style={{ left: rulerOffset }}>
          <div onPointerDown={dragThumb('x')} className="absolute bottom-0.5 h-1.5 rounded-full bg-slate-500/50 hover:bg-slate-600/70 cursor-pointer" style={{ left: hPos, width: hThumb }} />
        </div>
      )}
      {selectionRect && !dropHover && <FloatingTextToolbar api={api} rect={selectionRect} bounds={{ width: size.width + rulerOffset, height: size.height + rulerOffset }} />}
      {formatBrush && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[75] h-7 px-3 rounded-full bg-amber-500 text-white text-[11px] font-bold shadow-float flex items-center gap-2 pointer-events-none">
          Pincel de formatação: clique no elemento de destino · Esc cancela
        </div>
      )}
      {dropHover && <div className="absolute inset-0 pointer-events-none border-4 border-dashed border-brand-400/70 bg-brand-500/5 flex items-center justify-center text-brand-700 font-bold text-lg">Solte a imagem para inserir</div>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
});

StudioCanvas.displayName = 'StudioCanvas';
export default StudioCanvas;
