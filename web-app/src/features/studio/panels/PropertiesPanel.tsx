import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bold, Italic, Underline, Strikethrough, CaseUpper, AlignLeft, AlignCenter, AlignRight, AlignJustify, Trash2, Copy, Lock, Unlock, BringToFront, SendToBack, ArrowUp, ArrowDown, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, Layers, Eye, EyeOff, Type, Image as ImageIcon, Square, Circle, Minus, MoveRight, Shapes, ChevronDown, MousePointerClick, RotateCcw, RotateCw, FlipHorizontal2, Maximize, Replace, Link2, Unlink2, GripVertical, SlidersHorizontal, Pencil } from 'lucide-react';
import { cn, Tooltip } from '../../../components/ui';
import type { EditorElement } from '../../../types/pdfEditor';
import type { StudioApi } from '../useStudio';
import FontPicker from './FontPicker';
import Anchored from './Anchored';
import { FONT_SIZE_PRESETS, findFont, nearestWeight } from '../fonts';

const PALETTE = ['#000000', '#0f172a', '#334155', '#64748b', '#94a3b8', '#ffffff', '#1b3f8b', '#2f5bb3', '#60a5fa', '#2e8b3d', '#47ad55', '#ef4444', '#f97316', '#f59e0b', '#fde047', '#8b5cf6', '#ec4899', 'transparent'];
const WEIGHT_KEYS: Record<number, string> = { 100: 'thin', 200: 'extraLight', 300: 'light', 400: 'normal', 500: 'medium', 600: 'semiBold', 700: 'bold', 800: 'extraBold', 900: 'black' };
const ICONS: Record<EditorElement['type'], typeof Type> = { text: Type, image: ImageIcon, rect: Square, circle: Circle, line: Minus, arrow: MoveRight, path: Shapes, checkmark: Shapes };
const TYPE_KEYS: Record<EditorElement['type'], string> = { text: 'text', image: 'image', rect: 'rect', circle: 'circle', line: 'line', arrow: 'arrow', path: 'path', checkmark: 'checkmark' };

type TFn = (key: string) => string;
const typeLabel = (t: TFn, type: EditorElement['type']) => t(`properties.types.${TYPE_KEYS[type]}`);
const weightLabel = (t: TFn, w: number) => (WEIGHT_KEYS[w] ? t(`properties.weights.${WEIGHT_KEYS[w]}`) : String(w));

const CHECKER = 'repeating-conic-gradient(#e2e8f0 0 25%, #fff 0 50%) 0 0/8px 8px';
/** shared chrome for every input in the panel — filled at rest, outlined on focus */
const FIELD = 'h-8 rounded-lg bg-slate-50 border border-transparent text-xs font-semibold text-slate-700 outline-none transition-colors hover:border-slate-200 focus:bg-white focus:border-brand-400';

const Section = ({ title, children, defaultOpen = true, aside }: { title: string; children: React.ReactNode; defaultOpen?: boolean; aside?: React.ReactNode }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-slate-100 first:border-t-0">
      <div className="sticky top-0 z-10 flex items-center bg-white/95 backdrop-blur-sm">
        <button onClick={() => setOpen((v) => !v)} className="flex-1 flex items-center gap-1.5 pl-4 pr-2 h-9 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 hover:text-slate-700 transition-colors">
          <ChevronDown className={cn('w-3 h-3 transition-transform', !open && '-rotate-90')} />
          {title}
        </button>
        {aside && <div className="pr-3">{aside}</div>}
      </div>
      {open && <div className="px-4 pb-4 pt-0.5 space-y-2.5">{children}</div>}
    </section>
  );
};

/** label on the left, control on the right — the single row rhythm the whole panel follows */
const Row = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div className="flex items-center justify-between gap-3 min-h-8">
    <span className="text-[11px] text-slate-500 shrink-0" title={hint}>
      {label}
    </span>
    <div className="flex items-center gap-1.5">{children}</div>
  </div>
);

const ColorField = ({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) => {
  const { t } = useTranslation('studio');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const empty = value === 'transparent' || !value;
  return (
    <Row label={label}>
      <button ref={ref} onClick={() => setOpen((v) => !v)} className={cn(FIELD, 'w-[124px] px-1.5 flex items-center gap-2 hover:bg-white')}>
        <span className="w-5 h-5 rounded-md border border-slate-200 shrink-0" style={{ background: empty ? CHECKER : value }} />
        <span className="text-[11px] font-mono text-slate-500 truncate">{empty ? t('properties.color.none') : value}</span>
      </button>
      <Anchored anchor={ref} open={open} onClose={() => setOpen(false)} width={228} align="right" className="p-2.5">
        <div className="grid grid-cols-9 gap-1">
          {PALETTE.map((c) => (
            <button key={c} onClick={() => onChange(c)} className={cn('w-5 h-5 rounded border', value === c ? 'ring-2 ring-brand-500 border-transparent' : 'border-slate-200')} style={{ background: c === 'transparent' ? CHECKER : c }} title={c} />
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <input type="color" value={value && value !== 'transparent' ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 rounded-md border border-slate-200 p-0.5 cursor-pointer" />
          <input value={value || ''} onChange={(e) => onChange(e.target.value)} className="flex-1 h-7 px-2 rounded-md border border-slate-200 text-[11px] font-mono outline-none focus:border-brand-400" />
        </div>
      </Anchored>
    </Row>
  );
};

/** compact number input: unit inside the field, steppers on hover */
const Num = ({ value, onChange, min = -9999, max = 9999, step = 1, suffix, presets, prefix, className, id }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; presets?: number[]; prefix?: string; className?: string; id?: string }) => {
  const clamp = (v: number) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : 0));
  const round = (v: number) => Math.round(v * 100) / 100;
  return (
    <div className={cn(FIELD, 'group/num relative flex items-center pl-1.5 pr-1 w-[104px] focus-within:bg-white focus-within:border-brand-400', className)}>
      {prefix && <span className="text-[10px] font-bold text-slate-400 w-3.5 shrink-0">{prefix}</span>}
      <input
        type="number"
        value={round(value)}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        list={presets ? `presets-${id}` : undefined}
        className="flex-1 min-w-0 h-full bg-transparent text-xs font-semibold text-right outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {presets && (
        <datalist id={`presets-${id}`}>
          {presets.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      )}
      {suffix && <span className="text-[10px] text-slate-400 pl-1 shrink-0">{suffix}</span>}
      <span className="absolute right-0 top-0 bottom-0 hidden group-hover/num:flex flex-col justify-center bg-gradient-to-l from-white via-white pl-2 pr-0.5 rounded-r-lg">
        <button tabIndex={-1} onClick={() => onChange(clamp(round(value + step)))} className="h-3 w-4 flex items-center justify-center text-slate-400 hover:text-brand-600">
          <ArrowUp className="w-2.5 h-2.5" />
        </button>
        <button tabIndex={-1} onClick={() => onChange(clamp(round(value - step)))} className="h-3 w-4 flex items-center justify-center text-slate-400 hover:text-brand-600">
          <ArrowDown className="w-2.5 h-2.5" />
        </button>
      </span>
    </div>
  );
};

/** segmented control: one tray, the active button lifts out of it */
// Tooltip wraps each button in an inline-flex span, so the stretch has to be applied to that wrapper
const Seg = ({ children }: { children: React.ReactNode }) => <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-100 [&>span]:flex-1">{children}</div>;

const Tog = ({ active, onClick, label, children, disabled }: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean }) => (
  <Tooltip label={label}>
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex-1 h-7 min-w-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-default',
        active ? 'bg-white text-brand-700 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'
      )}
    >
      {children}
    </button>
  </Tooltip>
);

const Ghost = ({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) => (
  <button onClick={onClick} disabled={disabled} className="h-8 px-2 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 flex items-center justify-center gap-1.5 transition-colors">
    {children}
  </button>
);

/* ------------------------------------------------------------------ layers */
const LayersTab = ({ api }: { api: StudioApi }) => {
  const { t } = useTranslation('studio');
  const { elements, selectedIds, select, toggleLock, toggleHidden, moveLayer, updateElements, commit } = api;
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; above: boolean } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const list = [...elements].reverse(); // top of the list = top of the stack

  const drop = (target: EditorElement, above: boolean) => {
    if (!drag || drag === target.id) return;
    const rest = elements.filter((e) => e.id !== drag);
    const ti = rest.findIndex((e) => e.id === target.id);
    if (ti === -1) return;
    moveLayer(drag, above ? ti + 1 : ti);
    setDrag(null);
    setOver(null);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
        {!list.length && (
          <p className="px-2 py-8 text-center text-xs text-slate-400">
            {t('properties.layers.emptyTitle')}
            <br />
            {t('properties.layers.emptySubtitle')}
          </p>
        )}
        {list.map((el) => {
          const I = ICONS[el.type] || Shapes;
          const active = selectedIds.includes(el.id);
          const label = el.name?.trim() || (el.type === 'text' ? el.content.slice(0, 28) || typeLabel(t, 'text') : typeLabel(t, el.type));
          return (
            <div
              key={el.id}
              draggable={renaming !== el.id}
              onDragStart={() => setDrag(el.id)}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setOver({ id: el.id, above: e.clientY < r.top + r.height / 2 });
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(el, e.clientY < e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2);
              }}
              onClick={(e) => select(el.id, { toggle: e.shiftKey || e.metaKey || e.ctrlKey })}
              className={cn(
                'group relative flex items-center gap-1.5 h-9 pl-1 pr-1.5 rounded-lg cursor-pointer select-none transition-colors',
                active ? 'bg-brand-50 text-brand-900' : 'hover:bg-slate-50',
                el.hidden && 'opacity-45',
                drag === el.id && 'opacity-40',
                over?.id === el.id && drag && drag !== el.id && (over.above ? 'shadow-[inset_0_2px_0_0_var(--color-brand-500,#2f5bb3)]' : 'shadow-[inset_0_-2px_0_0_var(--color-brand-500,#2f5bb3)]')
              )}
            >
              <GripVertical className="w-3.5 h-3.5 shrink-0 text-slate-300 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing" />
              <span className={cn('w-6 h-6 rounded-md flex items-center justify-center shrink-0', active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>
                <I className="w-3.5 h-3.5" />
              </span>
              {renaming === el.id ? (
                <input
                  autoFocus
                  defaultValue={el.name || label}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    updateElements([el.id], { name: e.target.value.trim() || undefined });
                    commit();
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  className="flex-1 min-w-0 h-6 px-1.5 rounded-md border border-brand-400 text-xs outline-none"
                />
              ) : (
                <span className={cn('flex-1 min-w-0 truncate text-xs', active ? 'font-semibold' : 'text-slate-700')} onDoubleClick={() => setRenaming(el.id)}>
                  {label}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRenaming(el.id);
                }}
                className="p-1 rounded-md text-slate-300 opacity-0 group-hover:opacity-100 hover:text-slate-600 hover:bg-white"
                title={t('properties.actions.rename')}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLock(el.id);
                }}
                className={cn('p-1 rounded-md hover:bg-white', el.locked ? 'text-amber-600' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-slate-600')}
                title={el.locked ? t('properties.actions.unlock') : t('properties.actions.lock')}
              >
                {el.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleHidden(el.id);
                }}
                className={cn('p-1 rounded-md hover:bg-white', el.hidden ? 'text-slate-600' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-slate-600')}
                title={el.hidden ? t('properties.actions.show') : t('properties.actions.hide')}
              >
                {el.hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
          );
        })}
      </div>
      <p className="shrink-0 px-4 py-2.5 border-t border-slate-100 text-[10px] leading-relaxed text-slate-400">
        {t('properties.layers.footerHint')}
      </p>
    </div>
  );
};

/* ------------------------------------------------------------------ image */
const ImageSection = ({ api, el, pageWidth, pageHeight }: { api: StudioApi; el: EditorElement; pageWidth: number; pageHeight: number }) => {
  const [lockRatio, setLockRatio] = useState(true);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = el.content;
    return () => {
      alive = false;
    };
  }, [el.content]);
  const ratio = el.width / Math.max(1, el.height);
  const setW = (w: number) => api.updateSelected(lockRatio ? { width: Math.max(4, w), height: Math.max(4, Math.round(w / ratio)) } : { width: Math.max(4, w) });
  const setH = (h: number) => api.updateSelected(lockRatio ? { height: Math.max(4, h), width: Math.max(4, Math.round(h * ratio)) } : { height: Math.max(4, h) });
  const rotate = (delta: number) => api.updateSelected({ rotation: ((((el.rotation || 0) + delta) % 360) + 360) % 360 });
  const fitWidth = () => {
    const w = pageWidth - 72;
    api.updateSelected({ width: w, height: Math.round(w / ratio), x: 36 });
  };
  const fitPage = () => {
    const s = Math.min((pageWidth - 72) / el.width, (pageHeight - 72) / el.height);
    const w = Math.round(el.width * s);
    const h = Math.round(el.height * s);
    api.updateSelected({ width: w, height: h, x: Math.round((pageWidth - w) / 2), y: Math.round((pageHeight - h) / 2) });
  };
  const resetRatio = () => natural && api.updateSelected({ height: Math.round(el.width * (natural.h / natural.w)) });
  const replace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const r = new FileReader();
    r.onload = () => api.updateSelected({ content: String(r.result) });
    r.readAsDataURL(f);
  };
  return (
    <Section title="Imagem">
      <div className="flex items-center gap-3">
        <span className="w-14 h-14 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden shrink-0 flex items-center justify-center">
          <img src={el.content} alt="" className="max-w-full max-h-full object-contain" />
        </span>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Num prefix="L" value={Math.round(el.width)} onChange={setW} min={4} suffix="pt" className="flex-1 w-auto" id="img-w" />
            <Tooltip label={lockRatio ? 'Proporção travada' : 'Proporção livre'}>
              <button onClick={() => setLockRatio((v) => !v)} className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-colors', lockRatio ? 'bg-brand-50 text-brand-700' : 'text-slate-400 hover:bg-slate-100')}>
                {lockRatio ? <Link2 className="w-4 h-4" /> : <Unlink2 className="w-4 h-4" />}
              </button>
            </Tooltip>
            <Num prefix="A" value={Math.round(el.height)} onChange={setH} min={4} suffix="pt" className="flex-1 w-auto" id="img-h" />
          </div>
          <p className="text-[10px] text-slate-400 truncate">{natural ? `Original ${natural.w}×${natural.h} px` : 'Carregando dimensões…'}</p>
        </div>
      </div>
      <Row label="Rotação">
        <Tooltip label="Girar −90°">
          <button onClick={() => rotate(-90)} className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500">
            <RotateCcw className="w-4 h-4" />
          </button>
        </Tooltip>
        <input type="range" min={-180} max={180} step={1} value={((((el.rotation || 0) + 180) % 360) + 360) % 360 - 180} onChange={(e) => api.updateSelected({ rotation: Number(e.target.value) }, { history: false })} onMouseUp={() => api.commit()} onTouchEnd={() => api.commit()} className="w-[90px] accent-brand-600" />
        <Tooltip label="Girar +90°">
          <button onClick={() => rotate(90)} className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500">
            <RotateCw className="w-4 h-4" />
          </button>
        </Tooltip>
      </Row>
      <div className="grid grid-cols-2 gap-1.5">
        <Ghost onClick={fitWidth}>
          <Maximize className="w-3.5 h-3.5" /> Largura da página
        </Ghost>
        <Ghost onClick={fitPage}>
          <FlipHorizontal2 className="w-3.5 h-3.5" /> Centralizar
        </Ghost>
        <Ghost onClick={resetRatio} disabled={!natural}>
          Proporção original
        </Ghost>
        <Ghost onClick={() => fileRef.current?.click()}>
          <Replace className="w-3.5 h-3.5" /> Substituir
        </Ghost>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={replace} />
      </div>
    </Section>
  );
};

/* ------------------------------------------------------------------ panel */
/** Right sidebar: identity of the selection, its properties and the page stack, split in two tabs. */
const PropertiesPanel = ({ api }: { api: StudioApi }) => {
  const { t } = useTranslation('studio');
  const { primary, selected, updateSelected, deleteSelected, duplicateSelected, toggleLock, reorder, alignSelected, elements, page } = api;
  const [tab, setTab] = useState<'props' | 'layers'>('props');
  const many = selected.length > 1;
  const isText = primary?.type === 'text';
  const isShape = primary ? ['rect', 'circle', 'path', 'checkmark'].includes(primary.type) : false;
  const isLine = primary ? ['line', 'arrow'].includes(primary.type) : false;
  const deco = primary?.textDecoration || 'none';
  const weight = primary?.fontWeight ?? (primary?.fontStyle?.includes('bold') ? 700 : 400);
  const bold = weight >= 600;
  const italic = Boolean(primary?.fontStyle?.includes('italic'));
  const fontDef = primary?.fontFamily ? findFont(primary.fontFamily) : undefined;
  const weights = fontDef?.weights || [400, 700];

  const setWeight = (w: number) => updateSelected({ fontWeight: w, fontStyle: (w >= 600 && italic ? 'bold italic' : w >= 600 ? 'bold' : italic ? 'italic' : 'normal') as 'normal' });
  const setItalic = (i: boolean) => updateSelected({ fontStyle: (bold && i ? 'bold italic' : bold ? 'bold' : i ? 'italic' : 'normal') as 'normal' });
  const toggleDeco = (d: 'underline' | 'line-through') => {
    const parts = deco.split(' ').filter((p) => p && p !== 'none');
    const next = parts.includes(d) ? parts.filter((p) => p !== d) : [...parts, d];
    updateSelected({ textDecoration: (next.join(' ') || 'none') as 'none' });
  };

  const Icon = primary ? ICONS[primary.type] || Shapes : MousePointerClick;
  const title = !primary ? 'Nenhuma seleção' : many ? `${selected.length} elementos` : primary.name?.trim() || typeLabel(t, primary.type);
  const subtitle = !primary ? 'Clique em um elemento da página' : many ? [...new Set(selected.map((el) => typeLabel(t, el.type)))].join(' · ') : `${typeLabel(t, primary.type)} · ${Math.round(primary.width)}×${Math.round(primary.height)} pt`;

  return (
    <aside className="w-[320px] shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
      <header className="shrink-0 px-3 pt-3 pb-2.5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', primary ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-400')}>
            <Icon className="w-4.5 h-4.5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-slate-800 truncate leading-tight">{title}</p>
            <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>
          </div>
          {primary && (
            <div className="flex items-center gap-0.5 shrink-0">
              <Tooltip label="Duplicar (⌘D)">
                <button onClick={duplicateSelected} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                  <Copy className="w-4 h-4" />
                </button>
              </Tooltip>
              <Tooltip label={primary.locked ? 'Desbloquear' : 'Bloquear'}>
                <button onClick={() => toggleLock()} className={cn('p-1.5 rounded-lg hover:bg-slate-100', primary.locked ? 'text-amber-600' : 'text-slate-400 hover:text-slate-700')}>
                  {primary.locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                </button>
              </Tooltip>
              <Tooltip label="Excluir (Delete)">
                <button onClick={deleteSelected} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                  <Trash2 className="w-4 h-4" />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
        <div className="mt-2.5 flex p-0.5 rounded-xl bg-slate-100">
          {([
            { id: 'props' as const, label: 'Propriedades', icon: SlidersHorizontal },
            { id: 'layers' as const, label: `Camadas`, icon: Layers, badge: elements.length }
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn('flex-1 h-7 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all', tab === t.id ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-700')}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
              {t.badge !== undefined && <span className={cn('px-1.5 rounded-full text-[10px] tabular-nums', tab === t.id ? 'bg-brand-50 text-brand-700' : 'bg-slate-200/70 text-slate-500')}>{t.badge}</span>}
            </button>
          ))}
        </div>
      </header>

      {tab === 'layers' ? (
        <LayersTab api={api} />
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {!primary && (
            <div className="px-5 py-10 text-center space-y-3">
              <span className="mx-auto w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center">
                <MousePointerClick className="w-5 h-5 text-slate-300" />
              </span>
              <p className="text-[13px] font-semibold text-slate-700">Nada selecionado</p>
              <p className="text-[11px] leading-relaxed text-slate-500">Clique em um texto, imagem ou forma para editar as propriedades aqui. Duplo clique na página cria um texto novo com o estilo da barra superior.</p>
              <div className="pt-1 space-y-1 text-[11px] text-slate-400">
                <p>
                  <kbd className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[10px] text-slate-500">clique direito</kbd> abre organizar, alinhar e camadas
                </p>
                <p>
                  <kbd className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[10px] text-slate-500">⌘A</kbd> seleciona tudo na página
                </p>
              </div>
            </div>
          )}

          {primary && isText && (
            <>
              <Section title="Tipografia">
                <FontPicker value={primary.fontFamily || 'Helvetica'} onChange={(family) => updateSelected({ fontFamily: family, fontWeight: nearestWeight(family, weight) })} className="w-full [&>button]:w-full [&>button]:h-9" />
                <div className="grid grid-cols-[1fr_104px] gap-1.5">
                  <select value={nearestWeight(primary.fontFamily || 'Helvetica', weight)} onChange={(e) => setWeight(Number(e.target.value))} className={cn(FIELD, 'px-2 cursor-pointer')}>
                    {weights.map((w) => (
                      <option key={w} value={w}>
                        {weightLabel(t, w)}
                      </option>
                    ))}
                  </select>
                  <Num value={primary.fontSize || 16} onChange={(v) => updateSelected({ fontSize: v })} min={2} max={400} suffix="pt" presets={FONT_SIZE_PRESETS} id="font-size" />
                </div>
                <Seg>
                  <Tog active={bold} onClick={() => setWeight(bold ? 400 : 700)} label="Negrito (⌘B)">
                    <Bold className="w-4 h-4" />
                  </Tog>
                  <Tog active={italic} onClick={() => setItalic(!italic)} label="Itálico (⌘I)" disabled={fontDef ? !fontDef.italic : false}>
                    <Italic className="w-4 h-4" />
                  </Tog>
                  <Tog active={deco.includes('underline')} onClick={() => toggleDeco('underline')} label="Sublinhado (⌘U)">
                    <Underline className="w-4 h-4" />
                  </Tog>
                  <Tog active={deco.includes('line-through')} onClick={() => toggleDeco('line-through')} label="Tachado">
                    <Strikethrough className="w-4 h-4" />
                  </Tog>
                  <Tog active={primary.textTransform === 'uppercase'} onClick={() => updateSelected({ textTransform: primary.textTransform === 'uppercase' ? 'none' : 'uppercase' })} label="Maiúsculas">
                    <CaseUpper className="w-4 h-4" />
                  </Tog>
                </Seg>
                <ColorField label="Cor do texto" value={primary.fill} onChange={(v) => updateSelected({ fill: v })} />
                <ColorField label="Realce / fundo" value={primary.backgroundColor || 'transparent'} onChange={(v) => updateSelected({ backgroundColor: v })} />
              </Section>
              <Section title="Parágrafo">
                <Seg>
                  <Tog active={(primary.align || 'left') === 'left'} onClick={() => updateSelected({ align: 'left' })} label="Esquerda">
                    <AlignLeft className="w-4 h-4" />
                  </Tog>
                  <Tog active={primary.align === 'center'} onClick={() => updateSelected({ align: 'center' })} label="Centro">
                    <AlignCenter className="w-4 h-4" />
                  </Tog>
                  <Tog active={primary.align === 'right'} onClick={() => updateSelected({ align: 'right' })} label="Direita">
                    <AlignRight className="w-4 h-4" />
                  </Tog>
                  <Tog active={primary.align === 'justify'} onClick={() => updateSelected({ align: 'justify' })} label="Justificar">
                    <AlignJustify className="w-4 h-4" />
                  </Tog>
                </Seg>
                <Row label="Entrelinha">
                  <Num value={primary.lineHeight || 1.25} onChange={(v) => updateSelected({ lineHeight: v })} min={0.6} max={4} step={0.05} presets={[1, 1.15, 1.25, 1.5, 2]} id="lh" />
                </Row>
                <Row label="Espaçamento">
                  <Num value={primary.letterSpacing || 0} onChange={(v) => updateSelected({ letterSpacing: v })} min={-5} max={40} step={0.5} suffix="px" id="ls" />
                </Row>
                <Row label="Margem interna">
                  <Num value={primary.padding ?? 4} onChange={(v) => updateSelected({ padding: v })} min={0} max={60} suffix="px" id="pad" />
                </Row>
                <Row label="Quebra de linha" hint="Texto importado de PDF mantém as quebras originais">
                  <Seg>
                    <Tog active={primary.wrap !== 'none'} onClick={() => updateSelected({ wrap: 'word' })} label="Reflui na largura da caixa">
                      <span className="text-[10px] font-bold px-1">Auto</span>
                    </Tog>
                    <Tog active={primary.wrap === 'none'} onClick={() => updateSelected({ wrap: 'none' })} label="Mantém as quebras do texto">
                      <span className="text-[10px] font-bold px-1">Fixa</span>
                    </Tog>
                  </Seg>
                </Row>
              </Section>
            </>
          )}

          {primary && isShape && (
            <Section title="Estilo">
              <ColorField label="Preenchimento" value={primary.fill} onChange={(v) => updateSelected({ fill: v })} />
              <ColorField label="Borda" value={primary.stroke || 'transparent'} onChange={(v) => updateSelected({ stroke: v })} />
              <Row label="Espessura">
                <Num value={primary.strokeWidth || 0} onChange={(v) => updateSelected({ strokeWidth: v })} min={0} max={60} suffix="px" id="sw" />
              </Row>
              {primary.type === 'rect' && (
                <Row label="Cantos">
                  <Num value={primary.cornerRadius || 0} onChange={(v) => updateSelected({ cornerRadius: v })} min={0} max={300} suffix="px" id="cr" />
                </Row>
              )}
            </Section>
          )}

          {primary && isLine && (
            <Section title="Estilo">
              <ColorField label="Cor" value={primary.stroke} onChange={(v) => updateSelected({ stroke: v, fill: v })} />
              <Row label="Espessura">
                <Num value={primary.strokeWidth || 2} onChange={(v) => updateSelected({ strokeWidth: v })} min={1} max={60} suffix="px" id="lw" />
              </Row>
            </Section>
          )}

          {primary && primary.type === 'image' && !many && <ImageSection api={api} el={primary} pageWidth={page?.width || 595} pageHeight={page?.height || 842} />}

          {primary && (
            <>
              <Section title="Aparência">
                <Row label="Opacidade">
                  <input type="range" min={0.05} max={1} step={0.05} value={primary.opacity ?? 1} onChange={(e) => updateSelected({ opacity: Number(e.target.value) }, { history: false })} onMouseUp={() => api.commit()} onTouchEnd={() => api.commit()} className="w-[104px] accent-brand-600" />
                  <span className="w-10 text-right text-xs font-semibold text-slate-600 tabular-nums">{Math.round((primary.opacity ?? 1) * 100)}%</span>
                </Row>
              </Section>

              <Section title="Posição e tamanho" defaultOpen={primary.type !== 'text'}>
                <div className="grid grid-cols-2 gap-1.5">
                  <Num prefix="X" value={primary.x} onChange={(v) => updateSelected({ x: v })} suffix="pt" className="w-auto" id="x" />
                  <Num prefix="Y" value={primary.y} onChange={(v) => updateSelected({ y: v })} suffix="pt" className="w-auto" id="y" />
                  <Num prefix="L" value={primary.width} onChange={(v) => updateSelected({ width: Math.max(4, v) })} min={4} suffix="pt" className="w-auto" id="w" />
                  <Num prefix="A" value={primary.height} onChange={(v) => updateSelected({ height: Math.max(4, v) })} min={4} suffix="pt" className="w-auto" id="h" />
                </div>
                <Row label="Rotação">
                  <Num value={primary.rotation || 0} onChange={(v) => updateSelected({ rotation: v })} min={-360} max={360} suffix="°" id="rot" />
                </Row>
                {page && (
                  <p className="text-[10px] text-slate-400">
                    Página {page.width}×{page.height} pt · 1 pt = 0,353 mm
                  </p>
                )}
              </Section>

              <Section title="Organizar">
                <div className="space-y-1.5">
                  <p className="text-[10px] text-slate-400">{many ? 'Alinhar entre os selecionados' : 'Alinhar na página'}</p>
                  <Seg>
                    <Tog onClick={() => alignSelected('left')} label={many ? 'Alinhar esquerdas' : 'Encostar à esquerda'}>
                      <AlignStartVertical className="w-4 h-4" />
                    </Tog>
                    <Tog onClick={() => alignSelected('hcenter')} label="Centralizar horizontalmente">
                      <AlignCenterVertical className="w-4 h-4" />
                    </Tog>
                    <Tog onClick={() => alignSelected('right')} label="Alinhar à direita">
                      <AlignEndVertical className="w-4 h-4" />
                    </Tog>
                    <Tog onClick={() => alignSelected('top')} label="Alinhar ao topo">
                      <AlignStartHorizontal className="w-4 h-4" />
                    </Tog>
                    <Tog onClick={() => alignSelected('vcenter')} label="Centralizar verticalmente">
                      <AlignCenterHorizontal className="w-4 h-4" />
                    </Tog>
                    <Tog onClick={() => alignSelected('bottom')} label="Alinhar à base">
                      <AlignEndHorizontal className="w-4 h-4" />
                    </Tog>
                  </Seg>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] text-slate-400">Ordem na pilha</p>
                  <Seg>
                    <Tog onClick={() => reorder('front')} label="Trazer para frente (⌘⇧])">
                      <BringToFront className="w-4 h-4" />
                    </Tog>
                    <Tog onClick={() => reorder('forward')} label="Avançar (⌘])">
                      <ArrowUp className="w-4 h-4" />
                    </Tog>
                    <Tog onClick={() => reorder('backward')} label="Recuar (⌘[)">
                      <ArrowDown className="w-4 h-4" />
                    </Tog>
                    <Tog onClick={() => reorder('back')} label="Enviar para trás (⌘⇧[)">
                      <SendToBack className="w-4 h-4" />
                    </Tog>
                  </Seg>
                </div>
                <Ghost onClick={() => setTab('layers')}>
                  <Layers className="w-3.5 h-3.5" /> Ver todas as camadas
                </Ghost>
              </Section>
            </>
          )}
        </div>
      )}
    </aside>
  );
};

export default PropertiesPanel;
