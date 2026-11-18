import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CheckCheck, ChevronLeft, ChevronRight, Info, Keyboard, ListChecks, Loader2, Move, Plus, RotateCw, Trash2, X } from 'lucide-react';
import { Button, Switch, cn } from '../../../components/ui';
import { PDFLib } from '../../../utils/pdfWorker';

import { placementToPoints, type Placement, type PlacementOverlay } from '../placement';

interface Props {
  onClose: () => void;
  pdf: File | Blob;
  overlay: PlacementOverlay;
  /** Posições já definidas (uma por página; página 0 = todas). */
  initial: Placement[];
  title?: string;
  description?: string;
  /** Mostra o botão "todas as páginas". */
  allowAllPages?: boolean;
  /** Mostra o controlo de rotação. */
  allowRotation?: boolean;
  onApply: (placements: Placement[]) => void;
}

const QUICK: { label: string; x: number; y: number; title: string }[] = [
  { label: '↖', x: 0, y: 1, title: 'Topo esquerda' },
  { label: '↑', x: 0.5, y: 1, title: 'Topo centro' },
  { label: '↗', x: 1, y: 1, title: 'Topo direita' },
  { label: '←', x: 0, y: 0.5, title: 'Meio esquerda' },
  { label: '•', x: 0.5, y: 0.5, title: 'Centro' },
  { label: '→', x: 1, y: 0.5, title: 'Meio direita' },
  { label: '↙', x: 0, y: 0, title: 'Rodapé esquerda' },
  { label: '↓', x: 0.5, y: 0, title: 'Rodapé centro' },
  { label: '↘', x: 1, y: 0, title: 'Rodapé direita' }
];
const MARGIN_PCT = 4;
const THUMB_W = 112;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type XY = { x: number; y: number };
type PageImg = { url: string; w: number; h: number; ptW: number; ptH: number; page: number; key: string };
type PdfDoc = Awaited<ReturnType<typeof PDFLib.getDocument>['promise']>;

const PlacementStudio = ({ onClose, pdf, overlay, initial, title, description, allowAllPages = true, allowRotation = true, onApply }: Props) => {
  const first = initial[0];
  /** Estilo partilhado por todas as páginas (tamanho, opacidade, rotação). A posição X/Y é por página. */
  const [style, setStyle] = useState({ widthPct: first.widthPct, fontSize: first.fontSize, opacity: first.opacity, rotation: first.rotation });
  const [allPages, setAllPages] = useState(allowAllPages && initial.some((p) => p.page === 0));
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initial.filter((p) => p.page > 0).map((p) => p.page)));
  /** Instâncias por página (pode haver várias assinaturas na mesma página). */
  const [positions, setPositions] = useState<Record<number, XY[]>>(() => {
    const out: Record<number, XY[]> = {};
    initial.filter((p) => p.page > 0).forEach((p) => (out[p.page] = [...(out[p.page] ?? []), { x: p.x, y: p.y }]));
    return out;
  });
  /** Índice da instância ativa na página em destaque. */
  const [active, setActive] = useState(0);
  /** Páginas cuja posição já foi confirmada (arrastada ou marcada como pronta). */
  const [done, setDone] = useState<Set<number>>(() => new Set(initial.filter((p) => p.page > 0).map((p) => p.page)));
  /** Última posição X/Y usada — ponto de partida para páginas novas. */
  const [lastXY, setLastXY] = useState<XY>({ x: first.x, y: first.y });
  const [previewPage, setPreviewPage] = useState(Math.max(1, first.page));
  const [numPages, setNumPages] = useState(1);
  const [pageSizes, setPageSizes] = useState<Record<number, { w: number; h: number }>>({});
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [pageImg, setPageImg] = useState<PageImg | null>(null);
  const [docReady, setDocReady] = useState(0);
  const [imgRatio, setImgRatio] = useState(1); // altura / largura da imagem
  const areaRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<Record<number, HTMLElement | null>>({});
  const [areaSize, setAreaSize] = useState({ w: 640, h: 560 });
  const docRef = useRef<PdfDoc | null>(null);

  // ao mudar de página, volta à primeira instância (padrão "derivar estado no render")
  const [pageForActive, setPageForActive] = useState(previewPage);
  if (pageForActive !== previewPage) {
    setPageForActive(previewPage);
    setActive(0);
  }
  const instances: XY[] = useMemo(() => (positions[previewPage]?.length ? positions[previewPage] : [lastXY]), [positions, previewPage, lastXY]);
  const activeIdx = clamp(active, 0, instances.length - 1);
  const pageXY: XY = instances[activeIdx];
  const totalMarks = useMemo(() => Object.values(positions).reduce((n, l) => n + l.length, 0), [positions]);
  const pageSize = pageSizes[previewPage] ?? { w: first.pageW, h: first.pageH };
  const isTarget = allPages || selected.has(previewPage);
  const place: Placement = { ...style, page: previewPage, x: pageXY.x, y: pageXY.y, pageW: pageSize.w, pageH: pageSize.h };

  const targets = useMemo(() => (allPages ? Array.from({ length: numPages }, (_, i) => i + 1) : [...selected].sort((a, b) => a - b)), [allPages, selected, numPages]);
  const pending = useMemo(() => (allPages ? [] : targets.filter((p) => !done.has(p))), [allPages, targets, done]);

  // proporção da imagem (para redimensionar mantendo o aspecto)
  useEffect(() => {
    if (overlay.kind !== 'image') return;
    const im = new Image();
    im.onload = () => setImgRatio(im.naturalHeight / Math.max(1, im.naturalWidth));
    im.src = overlay.url;
  }, [overlay]);

  // tamanho da área de pré-visualização
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAreaSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // carrega o documento
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await pdf.arrayBuffer();
      const doc = await PDFLib.getDocument({ data }).promise;
      if (cancelled) {
        void doc.destroy();
        return;
      }
      docRef.current = doc;
      setNumPages(doc.numPages);
      setPreviewPage((p) => clamp(p, 1, doc.numPages));
      setSelected((s) => new Set([...s].filter((p) => p <= doc.numPages)));
      setDocReady((n) => n + 1);
    })().catch(() => setDocReady(-1));
    return () => {
      cancelled = true;
      void docRef.current?.destroy();
      docRef.current = null;
    };
  }, [pdf]);

  // miniaturas (esqueleto do documento), em sequência
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || docReady <= 0) return;
    let cancelled = false;
    (async () => {
      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled) return;
        try {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale = (THUMB_W / base.width) * Math.min(2, window.devicePixelRatio || 1);
          const vp = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(vp.width);
          canvas.height = Math.ceil(vp.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
          if (cancelled) return;
          const url = canvas.toDataURL('image/jpeg', 0.7);
          setPageSizes((s) => (s[n] ? s : { ...s, [n]: { w: base.width, h: base.height } }));
          setThumbs((t) => ({ ...t, [n]: url }));
        } catch {
          /* página inválida */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docReady]);

  // renderiza a página em destaque
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || docReady <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(previewPage);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.max(Math.min((areaSize.w - 32) / base.width, (areaSize.h - 32) / base.height, 2.5), 0.2);
        const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
        if (cancelled) return;
        setPageImg({ url: canvas.toDataURL('image/jpeg', 0.85), w: base.width * scale, h: base.height * scale, ptW: base.width, ptH: base.height, page: previewPage, key: `${previewPage}:${areaSize.w}x${areaSize.h}` });
        setPageSizes((s) => ({ ...s, [previewPage]: { w: base.width, h: base.height } }));
      } catch {
        /* página inválida */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docReady, previewPage, areaSize.w, areaSize.h]);

  // mantém a miniatura da página atual visível
  useEffect(() => {
    thumbRefs.current[previewPage]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [previewPage]);

  const loading = docReady === 0 || !pageImg || pageImg.page !== previewPage;

  /* ---------- geometria do elemento na tela ---------- */
  const scalePx = pageImg ? pageImg.w / pageImg.ptW : 1; // px por ponto
  const textMetrics = useMemo(() => {
    if (overlay.kind !== 'text') return null;
    const c = document.createElement('canvas').getContext('2d');
    if (!c) return { w: style.fontSize * overlay.text.length * 0.6, h: style.fontSize };
    c.font = `bold ${style.fontSize}px Helvetica, Arial, sans-serif`;
    return { w: c.measureText(overlay.text || ' ').width, h: style.fontSize };
  }, [overlay, style.fontSize]);

  /** tamanho do elemento em pontos */
  const elemPt = useMemo(() => {
    if (overlay.kind === 'image') {
      const w = (place.pageW * style.widthPct) / 100;
      return { w, h: w * imgRatio };
    }
    return { w: textMetrics?.w ?? 0, h: textMetrics?.h ?? 0 };
  }, [overlay.kind, place.pageW, style.widthPct, imgRatio, textMetrics]);

  const elemPx = { w: elemPt.w * scalePx, h: elemPt.h * scalePx };
  const leftPx = (place.x / 100) * (pageImg?.w ?? 0);
  const bottomPx = (place.y / 100) * (pageImg?.h ?? 0);

  /** Define X/Y da página atual (e memoriza como ponto de partida das próximas). */
  const setXY = useCallback(
    (fn: (cur: XY) => XY) => {
      const next = fn(pageXY);
      setLastXY(next);
      setPositions((pos) => {
        const list = pos[previewPage]?.length ? [...pos[previewPage]] : [lastXY];
        list[clamp(activeIdx, 0, list.length - 1)] = next;
        return { ...pos, [previewPage]: list };
      });
      if (!allPages) setDone((d) => (d.has(previewPage) ? d : new Set(d).add(previewPage)));
    },
    [previewPage, pageXY, allPages, activeIdx, lastXY]
  );

  /* ---------- arrastar ---------- */
  const drag = useRef<{ mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; of: number } | null>(null);

  const startDrag = (mode: 'move' | 'resize', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, ox: place.x, oy: place.y, ow: style.widthPct, of: style.fontSize };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !pageImg) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.mode === 'move') {
      const nx = d.ox + (dx / pageImg.w) * 100;
      const ny = d.oy - (dy / pageImg.h) * 100;
      setXY(() => ({ x: clamp(nx, 0, 100 - (elemPt.w / place.pageW) * 100), y: clamp(ny, 0, 100 - (elemPt.h / place.pageH) * 100) }));
    } else if (overlay.kind === 'image') {
      const nw = d.ow + (dx / pageImg.w) * 100;
      setStyle((s) => ({ ...s, widthPct: clamp(nw, 3, 100 - place.x) }));
    } else {
      const nf = d.of + dx / scalePx / Math.max(1, overlay.text.length * 0.6);
      setStyle((s) => ({ ...s, fontSize: clamp(Math.round(nf), 6, 200) }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  const quick = useCallback(
    (qx: number, qy: number) => {
      const wPct = (elemPt.w / place.pageW) * 100;
      const hPct = (elemPt.h / place.pageH) * 100;
      const x = qx === 0 ? MARGIN_PCT : qx === 1 ? 100 - MARGIN_PCT - wPct : 50 - wPct / 2;
      const y = qy === 0 ? MARGIN_PCT : qy === 1 ? 100 - MARGIN_PCT - hPct : 50 - hPct / 2;
      setXY(() => ({ x: clamp(x, 0, 100), y: clamp(y, 0, 100) }));
    },
    [elemPt, place.pageW, place.pageH, setXY]
  );

  /* ---------- seleção de páginas ---------- */
  const togglePage = (n: number) => {
    if (allPages) return;
    const isOn = selected.has(n);
    setSelected((s) => {
      const next = new Set(s);
      if (isOn) next.delete(n);
      else next.add(n);
      return next;
    });
    if (isOn) {
      setDone((d) => {
        const nd = new Set(d);
        nd.delete(n);
        return nd;
      });
    } else {
      setPositions((pos) => (pos[n]?.length ? pos : { ...pos, [n]: [lastXY] }));
    }
  };
  const selectRange = (mode: 'all' | 'none' | 'odd' | 'even') => {
    if (allPages) return;
    const all = Array.from({ length: numPages }, (_, i) => i + 1);
    const pick = mode === 'all' ? all : mode === 'odd' ? all.filter((n) => n % 2 === 1) : mode === 'even' ? all.filter((n) => n % 2 === 0) : [];
    setSelected(new Set(pick));
    setPositions((pos) => ({ ...Object.fromEntries(pick.map((n) => [n, [lastXY]])), ...pos }));
    setDone((d) => new Set([...d].filter((n) => pick.includes(n))));
  };

  /** Confirma a página atual e salta para a próxima que falta posicionar. */
  const confirmAndNext = () => {
    if (!allPages && selected.has(previewPage)) {
      setPositions((pos) => (pos[previewPage]?.length ? pos : { ...pos, [previewPage]: [lastXY] }));
      setDone((d) => new Set(d).add(previewPage));
    }
    const after = targets.find((p) => p > previewPage && !done.has(p)) ?? targets.find((p) => p !== previewPage && !done.has(p));
    if (after) setPreviewPage(after);
  };

  const pts = placementToPoints(place);
  const canApply = !loading && !!pageImg && (allPages || selected.size > 0);

  const buildResult = (): Placement[] => {
    if (allPages) return instances.map((xy) => ({ ...style, page: 0, x: xy.x, y: xy.y, pageW: pageSize.w, pageH: pageSize.h }));
    return targets.flatMap((n) => {
      const list = positions[n]?.length ? positions[n] : [lastXY];
      const sz = pageSizes[n] ?? pageSize;
      return list.map((xy) => ({ ...style, page: n, x: xy.x, y: xy.y, pageW: sz.w, pageH: sz.h }));
    });
  };

  /** Adiciona uma instância na posição indicada (ou clonada da ativa, deslocada). */
  const addInstanceAt = useCallback(
    (xy?: XY) => {
      const wPct = (elemPt.w / place.pageW) * 100;
      const hPct = (elemPt.h / place.pageH) * 100;
      const fallback: XY = {
        x: clamp(pageXY.x + wPct + 3 <= 100 - wPct ? pageXY.x + wPct + 3 : pageXY.x - wPct - 3, 0, Math.max(0, 100 - wPct)),
        y: clamp(pageXY.x + wPct + 3 > 100 - wPct ? pageXY.y + hPct + 3 : pageXY.y, 0, Math.max(0, 100 - hPct))
      };
      const next = xy ? { x: clamp(xy.x, 0, Math.max(0, 100 - wPct)), y: clamp(xy.y, 0, Math.max(0, 100 - hPct)) } : fallback;
      const list = [...instances, next];
      setPositions((pos) => ({ ...pos, [previewPage]: list }));
      setActive(list.length - 1);
      setLastXY(next);
      if (!allPages) {
        setSelected((sel) => (sel.has(previewPage) ? sel : new Set(sel).add(previewPage)));
        setDone((d) => (d.has(previewPage) ? d : new Set(d).add(previewPage)));
      }
    },
    [elemPt, place.pageW, place.pageH, pageXY, instances, previewPage, allPages]
  );

  /** Backspace / botão Remover: apaga a instância ativa; se for a última, tira a página da seleção. */
  const removeInstance = useCallback(() => {
    if (instances.length > 1) {
      const list = instances.filter((_, i) => i !== activeIdx);
      setPositions((pos) => ({ ...pos, [previewPage]: list }));
      setActive(clamp(activeIdx, 0, list.length - 1));
      return;
    }
    if (allPages) return;
    setPositions((pos) => {
      const next = { ...pos };
      delete next[previewPage];
      return next;
    });
    setSelected((sel) => {
      const next = new Set(sel);
      next.delete(previewPage);
      return next;
    });
    setDone((d) => {
      const next = new Set(d);
      next.delete(previewPage);
      return next;
    });
    setActive(0);
  }, [instances, activeIdx, previewPage, allPages]);

  /** Duplo clique na página: coloca uma assinatura nova no ponto clicado. */
  const pageDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const wPct = (elemPt.w / place.pageW) * 100;
    const hPct = (elemPt.h / place.pageH) * 100;
    const xy: XY = {
      x: ((e.clientX - rect.left) / rect.width) * 100 - wPct / 2,
      y: ((rect.bottom - e.clientY) / rect.height) * 100 - hPct / 2
    };
    if (isTarget) {
      addInstanceAt(xy);
      return;
    }
    if (allPages) return;
    const first: XY = { x: clamp(xy.x, 0, Math.max(0, 100 - wPct)), y: clamp(xy.y, 0, Math.max(0, 100 - hPct)) };
    setSelected((sel) => new Set(sel).add(previewPage));
    setDone((d) => new Set(d).add(previewPage));
    setPositions((pos) => ({ ...pos, [previewPage]: [first] }));
    setLastXY(first);
    setActive(0);
  };

  /* ---------- atalhos de teclado ---------- */
  // sem lista de dependências: o handler é sempre a versão mais recente
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'PageDown' || (e.key === ']' && !e.metaKey && !e.ctrlKey)) {
        setPreviewPage((n) => Math.min(numPages, n + 1));
        return;
      }
      if (e.key === 'PageUp' || (e.key === '[' && !e.metaKey && !e.ctrlKey)) {
        setPreviewPage((n) => Math.max(1, n - 1));
        return;
      }
      if (!isTarget) {
        if (e.key === 'Enter' && !allPages) togglePage(previewPage);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        removeInstance();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        addInstanceAt();
        return;
      }
      if (e.key === 'Tab' && instances.length > 1) {
        e.preventDefault();
        setActive((i) => (i + (e.shiftKey ? instances.length - 1 : 1)) % instances.length);
        return;
      }
      const step = e.shiftKey ? 5 : 0.5;
      const maxX = Math.max(0, 100 - (elemPt.w / place.pageW) * 100);
      const maxY = Math.max(0, 100 - (elemPt.h / place.pageH) * 100);
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setXY((c) => ({ ...c, x: clamp(c.x - step, 0, maxX) }));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setXY((c) => ({ ...c, x: clamp(c.x + step, 0, maxX) }));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setXY((c) => ({ ...c, y: clamp(c.y + step, 0, maxY) }));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setXY((c) => ({ ...c, y: clamp(c.y - step, 0, maxY) }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Sugestão contextual: diz sempre qual é o passo seguinte. */
  const hint = allPages
    ? 'Arraste a assinatura — a mesma posição é usada em todas as páginas.'
    : selected.size === 0
      ? 'Comece por escolher as páginas à esquerda — ou dê duplo clique na página para assinar já aqui.'
      : !isTarget
        ? `A página ${previewPage} não está selecionada. Duplo clique nela para a incluir.`
        : pending.length
          ? `Arraste a assinatura. Faltam ${pending.length} ${pending.length === 1 ? 'página' : 'páginas'} — use “Confirmar e ir à próxima”.`
          : 'Tudo posicionado. Duplo clique para juntar outra assinatura, ou clique em Aplicar.';

  const statusLabel = allPages ? `Todas as ${numPages} páginas` : selected.size === 0 ? 'Nenhuma página selecionada' : `${selected.size - pending.length} de ${selected.size} posicionadas`;

  const renderThumb = (n: number, horizontal: boolean) => {
    const on = allPages || selected.has(n);
    const ok = allPages || done.has(n);
    const cur = n === previewPage;
    const sz = pageSizes[n] ?? pageSize;
    const list = positions[n]?.length ? positions[n] : [lastXY];
    const wPct = (elemPt.w / sz.w) * 100;
    const hPct = (elemPt.h / sz.h) * 100;
    return (
      <div
        key={n}
        ref={(el) => {
          thumbRefs.current[n] = el;
        }}
        role="button"
        tabIndex={0}
        onClick={() => setPreviewPage(n)}
        onDoubleClick={() => togglePage(n)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setPreviewPage(n);
          if (e.key === ' ') {
            e.preventDefault();
            togglePage(n);
          }
        }}
        title={`Página ${n}${on ? ' · selecionada' : ''} — duplo clique para ${on ? 'remover' : 'selecionar'}`}
        className={cn(
          'relative shrink-0 rounded-lg border-2 bg-white text-left cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
          horizontal ? 'w-[64px]' : 'w-full',
          cur ? 'border-brand-600 shadow-md' : on ? 'border-brand-300' : 'border-slate-200 hover:border-slate-300',
          !on && !allPages && 'opacity-60 hover:opacity-100'
        )}
      >
        <div className="relative w-full overflow-hidden rounded-md bg-slate-100" style={{ aspectRatio: `${sz.w} / ${sz.h}` }}>
          {thumbs[n] ? <img src={thumbs[n]} alt="" draggable={false} className="absolute inset-0 w-full h-full object-contain" /> : <div className="absolute inset-0 animate-pulse bg-slate-200/70" />}
          {on &&
            list.map((xy, i) => (
              <div
                key={i}
                className={cn('absolute rounded-[2px] ring-1', ok ? 'bg-brand-500/50 ring-brand-600' : 'bg-amber-400/50 ring-amber-500')}
                style={{ left: `${xy.x}%`, bottom: `${xy.y}%`, width: `${Math.max(wPct, 6)}%`, height: `${Math.max(hPct, 3)}%` }}
              />
            ))}
          {on && list.length > 1 && <span className="absolute top-0.5 right-0.5 rounded-full bg-brand-600 text-white text-[9px] font-bold px-1 leading-4">×{list.length}</span>}
        </div>
        <div className="flex items-center justify-between px-1 py-0.5">
          <span className={cn('text-[10px] font-bold tabular-nums', cur ? 'text-brand-700' : 'text-slate-500')}>{n}</span>
          <button
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={allPages}
            onClick={(e) => {
              e.stopPropagation();
              togglePage(n);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className={cn(
              'w-4 h-4 rounded flex items-center justify-center border transition-colors',
              allPages ? 'bg-brand-600 border-brand-600 text-white cursor-default' : on ? (ok ? 'bg-brand-600 border-brand-600 text-white' : 'bg-amber-400 border-amber-400 text-white') : 'bg-white border-slate-300 hover:border-brand-400'
            )}
            title={allPages ? 'Todas as páginas' : on ? (ok ? 'Posicionada' : 'Selecionada — falta posicionar') : 'Selecionar página'}
          >
            {on && <Check className="w-3 h-3" strokeWidth={3} />}
          </button>
        </div>
      </div>
    );
  };

  const pageList = Array.from({ length: numPages }, (_, i) => i + 1);

  return createPortal(
    <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-6" onMouseDown={onClose}>
      <div className="bg-white w-full max-w-[1240px] h-[96vh] sm:h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* Cabeçalho */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-100 bg-white">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight truncate">{title ?? 'Posicionar no documento'}</h2>
            <p className="text-[11px] sm:text-xs text-slate-500 truncate">{description ?? 'Escolha as páginas na lista, depois arraste o elemento em cada uma. O que vê na prévia é o que fica.'}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={cn('hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold border', allPages || (selected.size > 0 && pending.length === 0) ? 'bg-brand-50 text-brand-700 border-brand-200' : selected.size > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200')}>
              <ListChecks className="w-3.5 h-3.5" />
              {statusLabel}
            </span>
            <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center" aria-label="Fechar">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Corpo */}
        <div className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[148px_1fr_260px]">
          {/* Esqueleto do documento (miniaturas) */}
          <aside className="md:border-r border-b md:border-b-0 border-slate-100 bg-slate-50/80 flex flex-col min-h-0">
            <div className="shrink-0 px-2.5 pt-2 pb-1.5 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Páginas</p>
              <span className="text-[10px] tabular-nums text-slate-400">{numPages}</span>
            </div>
            {!allPages && (
              <div className="shrink-0 px-2 pb-1.5 flex flex-wrap gap-1">
                {(
                  [
                    ['all', 'Todas'],
                    ['odd', 'Ímpares'],
                    ['even', 'Pares'],
                    ['none', 'Limpar']
                  ] as const
                ).map(([m, l]) => (
                  <button key={m} type="button" onClick={() => selectRange(m)} className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-700">
                    {l}
                  </button>
                ))}
              </div>
            )}
            {/* vertical (desktop) */}
            <div className="hidden md:flex flex-1 min-h-0 overflow-y-auto custom-scrollbar flex-col gap-2 px-2.5 pb-3">{pageList.map((n) => renderThumb(n, false))}</div>
            {/* horizontal (mobile) */}
            <div className="md:hidden flex overflow-x-auto custom-scrollbar gap-2 px-2.5 pb-2">{pageList.map((n) => renderThumb(n, true))}</div>
          </aside>

          {/* Pré-visualização */}
          <div ref={areaRef} className="relative bg-slate-200/70 overflow-hidden flex items-center justify-center p-4 select-none touch-none min-h-0 flex-1">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-200/60 z-10">
                <Loader2 className="w-6 h-6 text-brand-600 animate-spin" />
              </div>
            )}
            {/* indicador da página em destaque */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full bg-white/95 shadow border border-slate-200 px-1.5 py-1 text-[11px] font-semibold text-slate-700">
              <button type="button" disabled={previewPage <= 1} onClick={() => setPreviewPage((p) => Math.max(1, p - 1))} className="h-6 w-6 rounded-full hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center" aria-label="Página anterior">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-1 tabular-nums">
                Página {previewPage} / {numPages}
              </span>
              <button type="button" disabled={previewPage >= numPages} onClick={() => setPreviewPage((p) => Math.min(numPages, p + 1))} className="h-6 w-6 rounded-full hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center" aria-label="Próxima página">
                <ChevronRight className="w-4 h-4" />
              </button>
              {!allPages && (
                <span className={cn('ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold', isTarget ? (done.has(previewPage) ? 'bg-brand-100 text-brand-700' : 'bg-amber-100 text-amber-700') : 'bg-slate-100 text-slate-500')}>
                  {isTarget ? (done.has(previewPage) ? 'Posicionada' : 'A posicionar') : 'Não selecionada'}
                </span>
              )}
            </div>

            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 max-w-[92%] flex items-center gap-1.5 rounded-full bg-slate-900/85 text-white shadow-lg px-3 py-1.5 text-[11px] font-medium">
              <Info className="w-3.5 h-3.5 shrink-0 opacity-80" />
              <span className="truncate">{hint}</span>
            </div>

            {pageImg && (
              <div className="relative shadow-xl bg-white" onDoubleClick={pageDoubleClick} title="Duplo clique para adicionar outra assinatura aqui" style={{ width: pageImg.w, height: pageImg.h }}>
                <img src={pageImg.url} alt={`Página ${previewPage}`} draggable={false} className="absolute inset-0 w-full h-full pointer-events-none" />
                {isTarget &&
                  instances.map((xy, i) =>
                    i === activeIdx ? null : (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setActive(i)}
                        title={`Selecionar assinatura ${i + 1}`}
                        className="absolute group/other"
                        style={{ left: (xy.x / 100) * pageImg.w, bottom: (xy.y / 100) * pageImg.h, width: Math.max(elemPx.w, 8), height: Math.max(elemPx.h, 8), transform: `rotate(${-style.rotation}deg)`, transformOrigin: 'bottom left' }}
                      >
                        <div className="absolute inset-0 ring-1 ring-dashed ring-slate-400 rounded-sm bg-white/30 group-hover/other:ring-brand-400" />
                        {overlay.kind === 'image' ? (
                          <img src={overlay.url} alt="" draggable={false} className="absolute inset-0 w-full h-full object-fill pointer-events-none" style={{ opacity: style.opacity * 0.7 }} />
                        ) : (
                          <span className="absolute left-0 bottom-0 whitespace-nowrap font-bold leading-none pointer-events-none" style={{ fontSize: style.fontSize * scalePx, color: overlay.color, opacity: style.opacity * 0.7, fontFamily: 'Helvetica, Arial, sans-serif' }}>
                            {overlay.text}
                          </span>
                        )}
                        <span className="absolute -top-2 -left-2 w-4 h-4 rounded-full bg-slate-500 text-white text-[9px] font-bold flex items-center justify-center shadow">{i + 1}</span>
                      </button>
                    )
                  )}
                {isTarget ? (
                  <div
                    onPointerDown={(e) => startDrag('move', e)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    className="absolute cursor-move group"
                    style={{ left: leftPx, bottom: bottomPx, width: Math.max(elemPx.w, 8), height: Math.max(elemPx.h, 8), transform: `rotate(${-style.rotation}deg)`, transformOrigin: 'bottom left' }}
                  >
                    <div className="absolute inset-0 ring-2 ring-brand-500 ring-offset-0 rounded-sm bg-brand-500/5 group-hover:bg-brand-500/10" />
                    {instances.length > 1 && (
                      <span className="absolute -top-2.5 -right-2.5 min-w-5 h-5 px-1 rounded-full bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center shadow">
                        {activeIdx + 1}/{instances.length}
                      </span>
                    )}
                    {overlay.kind === 'image' ? (
                      <img src={overlay.url} alt="" draggable={false} className="absolute inset-0 w-full h-full object-fill pointer-events-none" style={{ opacity: style.opacity }} />
                    ) : (
                      <span className="absolute left-0 bottom-0 whitespace-nowrap font-bold leading-none pointer-events-none" style={{ fontSize: style.fontSize * scalePx, color: overlay.color, opacity: style.opacity, fontFamily: 'Helvetica, Arial, sans-serif' }}>
                        {overlay.text}
                      </span>
                    )}
                    <div className="absolute -top-2.5 -left-2.5 w-5 h-5 rounded-full bg-brand-600 text-white flex items-center justify-center shadow">
                      <Move className="w-3 h-3" />
                    </div>
                    <div
                      onPointerDown={(e) => startDrag('resize', e)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      className="absolute -bottom-2 -right-2 w-4 h-4 rounded-sm bg-white border-2 border-brand-600 cursor-nwse-resize shadow"
                      title="Redimensionar"
                    />
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/10">
                    <button type="button" onClick={() => togglePage(previewPage)} className="rounded-xl bg-white shadow-lg border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:border-brand-300 hover:text-brand-700">
                      Esta página não está selecionada — <span className="text-brand-700">incluir página {previewPage}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Controlos */}
          <div className="md:border-l border-t md:border-t-0 border-slate-100 bg-white overflow-y-auto custom-scrollbar p-4 space-y-4 text-xs max-h-[38vh] md:max-h-none">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-2">Onde aplicar</p>
              {allowAllPages && (
                <Switch
                  checked={allPages}
                  onChange={(v) => {
                    setAllPages(v);
                    if (v) setPositions((pos) => ({ ...pos, [previewPage]: instances }));
                  }}
                  label="Todas as páginas"
                  description="Mesma posição em cada página."
                />
              )}
              {!allPages && (
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">Página {previewPage}</span>
                    <Switch checked={selected.has(previewPage)} onChange={() => togglePage(previewPage)} />
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    {selected.size === 0 ? 'Marque as páginas na lista à esquerda (ou use Todas / Ímpares / Pares).' : pending.length === 0 ? `${selected.size} ${selected.size === 1 ? 'página posicionada' : 'páginas posicionadas'}.` : `Faltam ${pending.length}: ${pending.slice(0, 8).join(', ')}${pending.length > 8 ? '…' : ''}`}
                  </p>
                  {selected.size > 0 && (
                    <Button size="sm" variant={pending.length ? 'primary' : 'outline'} icon={CheckCheck} className="w-full" onClick={confirmAndNext} disabled={!isTarget && pending.length === 0}>
                      {isTarget && !done.has(previewPage) ? 'Confirmar e ir à próxima' : pending.length ? 'Ir à próxima por posicionar' : 'Tudo posicionado'}
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className={cn(!isTarget && 'opacity-40 pointer-events-none')}>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-2">Nesta página</p>
              <div className="rounded-xl border border-slate-200 bg-white p-2 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-700">
                    {instances.length === 1 ? '1 assinatura' : `${instances.length} assinaturas`}
                    {allPages && numPages > 1 ? ' · em todas' : ''}
                  </span>
                  {instances.length > 1 && (
                    <div className="flex items-center gap-1">
                      {instances.map((_, i) => (
                        <button key={i} type="button" onClick={() => setActive(i)} className={cn('h-5 min-w-5 px-1 rounded-md text-[10px] font-bold', i === activeIdx ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                          {i + 1}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Button size="xs" variant="outline" icon={Plus} onClick={() => addInstanceAt()} title="Adicionar outra assinatura nesta página">
                    Adicionar outra
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={Trash2}
                    onClick={removeInstance}
                    disabled={allPages && instances.length <= 1}
                    title={instances.length > 1 ? 'Remover a assinatura selecionada (Backspace)' : 'Remover a assinatura desta página (Backspace)'}
                  >
                    Remover
                  </Button>
                </div>
              </div>
            </div>

            <div className={cn(!isTarget && 'opacity-40 pointer-events-none')}>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-2">Posição rápida</p>
              <div className="grid grid-cols-3 gap-1">
                {QUICK.map((q) => (
                  <button key={q.title} type="button" title={q.title} onClick={() => quick(q.x, q.y)} className="h-8 rounded-lg border border-slate-200 text-sm text-slate-600 hover:border-brand-300 hover:text-brand-700 hover:bg-brand-50">
                    {q.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="font-semibold text-slate-600">{overlay.kind === 'image' ? 'Tamanho' : 'Tamanho da fonte'}</span>
              <div className="flex items-center gap-2 mt-1">
                {overlay.kind === 'image' ? (
                  <input type="range" min={3} max={100} step={0.5} value={style.widthPct} onChange={(e) => setStyle((s) => ({ ...s, widthPct: clamp(Number(e.target.value), 3, 100 - place.x) }))} className="flex-1" />
                ) : (
                  <input type="range" min={6} max={200} value={style.fontSize} onChange={(e) => setStyle((s) => ({ ...s, fontSize: Number(e.target.value) }))} className="flex-1" />
                )}
                <span className="w-12 text-right tabular-nums text-slate-500">{overlay.kind === 'image' ? `${Math.round(style.widthPct)}%` : `${style.fontSize}pt`}</span>
              </div>
            </label>

            <label className="block">
              <span className="font-semibold text-slate-600">Opacidade</span>
              <div className="flex items-center gap-2 mt-1">
                <input type="range" min={0.05} max={1} step={0.05} value={style.opacity} onChange={(e) => setStyle((s) => ({ ...s, opacity: Number(e.target.value) }))} className="flex-1" />
                <span className="w-12 text-right tabular-nums text-slate-500">{Math.round(style.opacity * 100)}%</span>
              </div>
            </label>

            {allowRotation && (
              <label className="block">
                <span className="font-semibold text-slate-600 inline-flex items-center gap-1">
                  <RotateCw className="w-3 h-3" /> Rotação
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <input type="range" min={-180} max={180} value={style.rotation} onChange={(e) => setStyle((s) => ({ ...s, rotation: Number(e.target.value) }))} className="flex-1" />
                  <span className="w-12 text-right tabular-nums text-slate-500">{style.rotation}°</span>
                </div>
              </label>
            )}

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1 text-[11px] text-slate-600">
              <p className="font-bold text-slate-700">Coordenadas (pt)</p>
              <p className="tabular-nums">X {pts.x.toFixed(1)} · Y {pts.y.toFixed(1)}</p>
              <p className="tabular-nums">Página {place.pageW.toFixed(0)} × {place.pageH.toFixed(0)} pt</p>
              <p className="tabular-nums">{allPages ? 'Todas as páginas' : targets.length ? `Páginas: ${targets.slice(0, 12).join(', ')}${targets.length > 12 ? '…' : ''}` : 'Nenhuma página'}</p>
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div className="shrink-0 px-4 sm:px-5 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500 sm:hidden">{statusLabel}</span>
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-400">
            <Keyboard className="w-3.5 h-3.5" />
            <span className="rounded bg-white border border-slate-200 px-1 py-0.5 font-semibold text-slate-500">arrastar</span>
            <span>posicionar</span>
            <span className="rounded bg-white border border-slate-200 px-1 py-0.5 font-semibold text-slate-500">duplo clique</span>
            <span>nova</span>
            <span className="rounded bg-white border border-slate-200 px-1 py-0.5 font-semibold text-slate-500">←↑↓→</span>
            <span>ajustar</span>
            <span className="rounded bg-white border border-slate-200 px-1 py-0.5 font-semibold text-slate-500">Backspace</span>
            <span>remover</span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={() => onApply(buildResult())} disabled={!canApply}>
              {allPages ? (instances.length > 1 ? `Aplicar ${instances.length} em todas` : 'Aplicar em todas') : selected.size > 1 ? `Aplicar em ${selected.size} páginas${totalMarks > selected.size ? ` (${totalMarks} assinaturas)` : ''}` : instances.length > 1 ? `Aplicar ${instances.length} assinaturas` : 'Aplicar posição'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default PlacementStudio;
