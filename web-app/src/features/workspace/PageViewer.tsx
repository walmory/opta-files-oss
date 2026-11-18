import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LayoutGrid, Minus, Plus, RotateCcw, RotateCw } from 'lucide-react';
import { Button, cn, Kbd } from '../../components/ui';
import { renderPageToCanvas, type VirtualPage } from './engine';

interface Props {
  page: VirtualPage;
  number: number;
  total: number;
  zoom: number;
  onZoom: (z: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onRotate: (delta: number) => void;
  onBackToGrid: () => void;
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

const PageViewer = ({ page, number, total, zoom, onZoom, onPrev, onNext, onRotate, onBackToGrid }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    setBusy(true);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const off = document.createElement('canvas');
    renderPageToCanvas(page.src, page.index, zoom * dpr, page.rotation, off)
      .then(() => {
        if (!alive) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.style.width = `${off.width / dpr}px`;
        canvas.style.height = `${off.height / dpr}px`;
        canvas.getContext('2d')?.drawImage(off, 0, 0);
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [page.src, page.index, page.rotation, zoom]);

  const step = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + dir))];
    onZoom(next);
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="h-11 px-3 flex items-center justify-between gap-3 border-b border-slate-200/70 bg-white/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" icon={LayoutGrid} onClick={onBackToGrid}>
            Páginas
          </Button>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <Button size="xs" variant="ghost" icon={RotateCcw} onClick={() => onRotate(-90)} title="Girar à esquerda" />
          <Button size="xs" variant="ghost" icon={RotateCw} onClick={() => onRotate(90)} title="Girar à direita" />
        </div>
        <div className="flex items-center gap-1 text-sm">
          <button onClick={onPrev} disabled={number <= 1} className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="tabular-nums font-semibold text-slate-700 min-w-20 text-center">
            {number} <span className="text-slate-400 font-medium">/ {total}</span>
          </span>
          <button onClick={onNext} disabled={number >= total} className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100">
            <Minus className="w-4 h-4" />
          </button>
          <span className="text-xs font-bold tabular-nums text-slate-600 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => step(1)} className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100">
            <Plus className="w-4 h-4" />
          </button>
          <span className="hidden xl:inline-flex items-center gap-1 ml-2 text-[11px] text-slate-400">
            <Kbd>←</Kbd> <Kbd>→</Kbd> navegar · <Kbd>Esc</Kbd> grade
          </span>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-8 flex">
        <div className={cn('m-auto shadow-2xl shadow-slate-900/20 ring-1 ring-slate-900/10 bg-white transition-opacity', busy && 'opacity-70')}>
          <canvas ref={canvasRef} className="block" />
        </div>
      </div>
    </div>
  );
};

export default PageViewer;
