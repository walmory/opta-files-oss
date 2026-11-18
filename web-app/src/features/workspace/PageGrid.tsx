import { memo, useEffect, useState } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent, DragOverlay, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RotateCcw, RotateCw, Trash2, Scissors, Maximize2, FilePlus2 } from 'lucide-react';
import { cn } from '../../components/ui';
import { BLANK_SRC, pageSize, renderThumb, type VirtualPage } from './engine';

export type SelectMode = 'single' | 'toggle' | 'range';

interface Props {
  pages: VirtualPage[];
  selection: Set<string>;
  thumbWidth: number;
  onSelect: (key: string, mode: SelectMode) => void;
  onMove: (fromKey: string, toKey: string) => void;
  onOpen: (key: string) => void;
  onRotate: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  onToggleBreak: (key: string) => void;
  onInsertBlank: (afterKey: string) => void;
}

const useThumb = (page: VirtualPage, width: number) => {
  const [url, setUrl] = useState<string>('');
  useEffect(() => {
    let alive = true;
    if (page.src === BLANK_SRC) return;
    // render at a couple of fixed widths so the cache stays useful while zooming
    const bucket = width <= 160 ? 160 : width <= 240 ? 240 : 360;
    renderThumb(page.src, page.index, bucket).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [page.src, page.index, width]);
  return url;
};

const Thumb = memo(({ page, width, className }: { page: VirtualPage; width: number; className?: string }) => {
  const url = useThumb(page, width);
  const size = pageSize(page);
  const ratio = size.height / size.width;
  const rotated = page.rotation % 180 !== 0;
  return (
    <div className={cn('relative w-full overflow-hidden rounded-md bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_0_0_1px_rgba(15,23,42,0.06)]', className)} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
      {page.src === BLANK_SRC ? (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold uppercase tracking-widest text-slate-300">em branco</div>
      ) : url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          className="absolute left-1/2 top-1/2 max-w-none select-none"
          style={{
            width: rotated ? `${100 * ratio}%` : '100%',
            transform: `translate(-50%, -50%) rotate(${page.rotation}deg)`
          }}
        />
      ) : (
        <div className="absolute inset-0 animate-pulse bg-slate-100" />
      )}
    </div>
  );
});
Thumb.displayName = 'Thumb';

const IconBtn = ({ onClick, title, children, tone }: { onClick: (e: React.MouseEvent) => void; title: string; children: React.ReactNode; tone?: 'danger' }) => (
  <button
    type="button"
    title={title}
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => {
      e.stopPropagation();
      onClick(e);
    }}
    className={cn('h-7 w-7 rounded-lg flex items-center justify-center bg-white/95 text-slate-600 shadow-sm ring-1 ring-slate-900/10 hover:bg-white hover:text-brand-700 transition-colors', tone === 'danger' && 'hover:text-rose-600')}
  >
    {children}
  </button>
);

const Card = ({ page, number, selected, thumbWidth, isLast, actions }: { page: VirtualPage; number: number; selected: boolean; thumbWidth: number; isLast: boolean; actions: Props }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.key });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, width: thumbWidth };
  return (
    <div ref={setNodeRef} style={style} className={cn('relative shrink-0', isDragging && 'opacity-30')}>
      <div
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        onClick={(e) => actions.onSelect(page.key, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single')}
        onDoubleClick={() => actions.onOpen(page.key)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') actions.onOpen(page.key);
        }}
        className={cn('group relative rounded-xl p-2 transition-all cursor-grab active:cursor-grabbing outline-none', selected ? 'bg-brand-50 ring-2 ring-brand-500 shadow-brand' : 'hover:bg-white/80 ring-1 ring-transparent hover:ring-slate-200 focus-visible:ring-brand-300')}
      >
        <Thumb page={page} width={thumbWidth} />
        {/* hover actions */}
        <div className="absolute inset-x-2 top-3 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex gap-1 pl-1">
            <IconBtn title="Girar à esquerda" onClick={() => actions.onRotate(page.key, -90)}>
              <RotateCcw className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Girar à direita" onClick={() => actions.onRotate(page.key, 90)}>
              <RotateCw className="w-3.5 h-3.5" />
            </IconBtn>
          </div>
          <div className="flex gap-1 pr-1">
            <IconBtn title="Abrir" onClick={() => actions.onOpen(page.key)}>
              <Maximize2 className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Excluir página" tone="danger" onClick={() => actions.onRemove(page.key)}>
              <Trash2 className="w-3.5 h-3.5" />
            </IconBtn>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between px-0.5">
          <span className={cn('text-[11px] font-bold tabular-nums', selected ? 'text-brand-700' : 'text-slate-500')}>{number}</span>
          {page.rotation !== 0 && <span className="text-[10px] font-semibold text-slate-400">{page.rotation}°</span>}
        </div>
      </div>

      {/* gutter: split marker + insert blank */}
      {!isLast && (
        <div className="absolute top-0 bottom-0 -right-3 w-6 flex flex-col items-center justify-center gap-1 z-10">
          <button
            type="button"
            title={page.breakAfter ? 'Remover marcador de divisão' : 'Dividir depois desta página'}
            onClick={(e) => {
              e.stopPropagation();
              actions.onToggleBreak(page.key);
            }}
            className={cn('h-6 w-6 rounded-full flex items-center justify-center transition-all ring-1', page.breakAfter ? 'bg-gold-500 text-white ring-gold-600 shadow-sm scale-100' : 'bg-white text-slate-400 ring-slate-200 opacity-0 hover:opacity-100 hover:text-gold-600 hover:ring-gold-300 [.grid-hover_&]:opacity-60')}
          >
            <Scissors className="w-3 h-3" />
          </button>
          <button
            type="button"
            title="Inserir página em branco aqui"
            onClick={(e) => {
              e.stopPropagation();
              actions.onInsertBlank(page.key);
            }}
            className="h-6 w-6 rounded-full flex items-center justify-center bg-white text-slate-400 ring-1 ring-slate-200 opacity-0 hover:opacity-100 hover:text-brand-600 hover:ring-brand-300 transition-all [.grid-hover_&]:opacity-60"
          >
            <FilePlus2 className="w-3 h-3" />
          </button>
          {page.breakAfter && <div className="absolute inset-y-3 left-1/2 -translate-x-1/2 border-l-2 border-dashed border-gold-400 -z-10" />}
        </div>
      )}
    </div>
  );
};

const PageGrid = (props: Props) => {
  const { pages, selection, thumbWidth, onMove } = props;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const [dragging, setDragging] = useState<VirtualPage | null>(null);
  const ids = pages.map((p) => p.key);

  const onDragStart = (e: DragStartEvent) => setDragging(pages.find((p) => p.key === e.active.id) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    if (e.over && e.active.id !== e.over.id) onMove(String(e.active.id), String(e.over.id));
  };

  const dragCount = dragging && selection.has(dragging.key) ? selection.size : 1;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="grid-hover flex flex-wrap gap-x-6 gap-y-5 p-6 pb-32 content-start">
          {pages.map((p, i) => (
            <Card key={p.key} page={p} number={i + 1} selected={selection.has(p.key)} thumbWidth={thumbWidth} isLast={i === pages.length - 1} actions={props} />
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="relative" style={{ width: thumbWidth }}>
            <div className="rounded-xl p-2 bg-white ring-2 ring-brand-500 shadow-2xl rotate-2">
              <Thumb page={dragging} width={thumbWidth} />
            </div>
            {dragCount > 1 && <span className="absolute -top-2 -right-2 h-7 min-w-7 px-2 rounded-full brand-gradient text-white text-xs font-bold flex items-center justify-center shadow-brand">{dragCount}</span>}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
};

export default PageGrid;
