import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bold, Italic, Underline, Strikethrough, Baseline, Highlighter, AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered, ChevronDown, ChevronUp, Paintbrush, Eraser, Copy, Trash2, Type } from 'lucide-react';
import { cn, Tooltip } from '../../../components/ui';
import type { StudioApi } from '../useStudio';
import { TEXT_STYLE_PRESETS } from '../textStyle';
import { useTextFormat } from './useTextFormat';
import ColorSplitButton from './ColorSplitButton';
import { HIGHLIGHT_COLORS } from './colors';
import FontPicker from './FontPicker';
import Anchored from './Anchored';

const Item = ({ icon: Icon, label, onClick, active, disabled }: { icon: typeof Bold; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) => (
  <Tooltip label={label}>
    <button onClick={onClick} disabled={disabled} aria-pressed={active} className={cn('h-7 w-7 rounded-md flex items-center justify-center shrink-0 disabled:opacity-30', active ? 'bg-brand-100 text-brand-800 ring-1 ring-brand-300' : 'text-slate-700 hover:bg-slate-100')}>
      <Icon className="w-[15px] h-[15px]" />
    </button>
  </Tooltip>
);

const TB_WIDTH = 560;
const TB_HEIGHT = 40;
const GAP = 12;

export interface FloatingRect {
  /** selection bounding box in container pixels */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Word's floating mini toolbar: appears right above the selected text so the common
 * commands are within a few pixels of the cursor instead of across the screen.
 */
const FloatingTextToolbar = ({ api, rect, bounds }: { api: StudioApi; rect: FloatingRect; bounds: { width: number; height: number } }) => {
  const { t } = useTranslation('studio');
  const f = useTextFormat(api);
  const { primary, duplicateSelected, deleteSelected, clearFormat, copyFormat, formatBrush, setFormatBrush } = api;
  const [stylesOpen, setStylesOpen] = useState(false);
  const [alignOpen, setAlignOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const alignRef = useRef<HTMLDivElement>(null);
  const stylesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // the submenus are portalled onto <body>, so they are outside `ref` in the DOM
      if (t.closest?.('[data-studio-overlay="dropdown"]')) return;
      if (ref.current && !ref.current.contains(t)) {
        setStylesOpen(false);
        setAlignOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  if (!primary || primary.type !== 'text') return null;

  // prefer above the selection; flip below when it would clip the top of the viewport
  const above = rect.y - TB_HEIGHT - GAP >= 4;
  const top = above ? rect.y - TB_HEIGHT - GAP : Math.min(bounds.height - TB_HEIGHT - 4, rect.y + rect.height + GAP);
  const left = Math.max(6, Math.min(bounds.width - TB_WIDTH - 6, rect.x + rect.width / 2 - TB_WIDTH / 2));

  const AlignIcon = f.align === 'center' ? AlignCenter : f.align === 'right' ? AlignRight : f.align === 'justify' ? AlignJustify : AlignLeft;

  return (
    <div
      ref={ref}
      data-studio-overlay="floating-toolbar"
      className="absolute z-[70] animate-[fadeIn_120ms_ease-out]"
      style={{ left, top, width: TB_WIDTH }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="h-10 rounded-xl border border-slate-200 bg-white/95 backdrop-blur shadow-float flex items-center gap-0.5 px-1.5">
        <FontPicker value={f.family} onChange={f.setFamily} className="[&>button]:w-[124px] [&>button]:h-7" />
        <div className="flex items-center h-7 rounded-md border border-slate-200 overflow-hidden shrink-0">
          <input
            type="number"
            value={Math.round(f.fontSize * 10) / 10}
            min={2}
            max={400}
            onChange={(e) => f.setFontSize(Number(e.target.value))}
            onKeyDown={(e) => e.stopPropagation()}
            className="w-[42px] h-full px-1 text-[11px] font-semibold text-center outline-none"
            title={t('floatingToolbar.fontSize')}
          />
        </div>
        <Item icon={ChevronUp} label={t('floatingToolbar.increaseFontSize')} onClick={() => api.bumpFontSize(1)} />
        <Item icon={ChevronDown} label={t('floatingToolbar.decreaseFontSize')} onClick={() => api.bumpFontSize(-1)} />
        <span className="w-px h-5 bg-slate-200 mx-0.5 shrink-0" />
        <Item icon={Bold} label={t('floatingToolbar.bold')} onClick={f.toggleBold} active={f.bold} />
        <Item icon={Italic} label={t('floatingToolbar.italic')} onClick={f.toggleItalic} active={f.italic} disabled={!f.canItalic} />
        <Item icon={Underline} label={t('floatingToolbar.underline')} onClick={() => f.toggleDeco('underline')} active={f.deco.includes('underline')} />
        <Item icon={Strikethrough} label={t('floatingToolbar.strikethrough')} onClick={() => f.toggleDeco('line-through')} active={f.deco.includes('line-through')} />
        <ColorSplitButton icon={<Baseline className="w-[14px] h-[14px]" />} label={t('floatingToolbar.fontColor')} value={primary.fill} onChange={f.setFill} fallbackBar="#c00000" compact />
        <ColorSplitButton icon={<Highlighter className="w-[14px] h-[14px]" />} label={t('floatingToolbar.highlightColor')} value={primary.backgroundColor} onChange={f.setHighlight} swatches={HIGHLIGHT_COLORS} allowTransparent transparentLabel={t('floatingToolbar.noHighlight')} fallbackBar="#fef08a" compact />
        <span className="w-px h-5 bg-slate-200 mx-0.5 shrink-0" />
        <div ref={alignRef} className="relative shrink-0">
          <Tooltip label={t('floatingToolbar.alignment')}>
            <button onClick={() => { setAlignOpen((v) => !v); setStylesOpen(false); }} className={cn('h-7 px-1 rounded-md flex items-center gap-0.5 text-slate-700 hover:bg-slate-100', alignOpen && 'bg-slate-100')}>
              <AlignIcon className="w-[15px] h-[15px]" />
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>
          </Tooltip>
          <Anchored anchor={alignRef} open={alignOpen} onClose={() => setAlignOpen(false)} className="p-1">
            <div className="flex gap-0.5">
              {([
                ['left', AlignLeft, t('floatingToolbar.align.left')],
                ['center', AlignCenter, t('floatingToolbar.align.center')],
                ['right', AlignRight, t('floatingToolbar.align.right')],
                ['justify', AlignJustify, t('floatingToolbar.align.justify')]
              ] as const).map(([a, I, lbl]) => (
                <button key={a} title={lbl} onClick={() => { f.setAlign(a); setAlignOpen(false); }} className={cn('h-7 w-7 rounded-md flex items-center justify-center', f.align === a ? 'bg-brand-100 text-brand-800' : 'text-slate-600 hover:bg-slate-100')}>
                  <I className="w-[15px] h-[15px]" />
                </button>
              ))}
            </div>
          </Anchored>
        </div>
        <Item icon={List} label={t('floatingToolbar.bullets')} onClick={() => f.setList('bullet')} active={f.listStyle === 'bullet'} />
        <Item icon={ListOrdered} label={t('floatingToolbar.numbering')} onClick={() => f.setList('number')} active={f.listStyle === 'number'} />
        <span className="w-px h-5 bg-slate-200 mx-0.5 shrink-0" />
        <div ref={stylesRef} className="relative shrink-0">
          <Tooltip label={t('floatingToolbar.styles')}>
            <button onClick={() => { setStylesOpen((v) => !v); setAlignOpen(false); }} className={cn('h-7 px-1.5 rounded-md flex items-center gap-0.5 text-slate-700 hover:bg-slate-100', stylesOpen && 'bg-slate-100')}>
              <Type className="w-[15px] h-[15px]" />
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>
          </Tooltip>
          <Anchored anchor={stylesRef} open={stylesOpen} onClose={() => setStylesOpen(false)} width={190} align="right" className="py-1">
            <div>
              {TEXT_STYLE_PRESETS.map((s) => (
                <button key={s.id} onClick={() => { f.applyStyle(s); setStylesOpen(false); }} className={cn('w-full px-3 py-1.5 text-left hover:bg-slate-50 flex items-center justify-between gap-2', f.activeStyleId === s.id && 'bg-brand-50/60')}>
                  <span className="truncate" style={{ fontSize: Math.min(16, Math.max(10, (s.patch.fontSize || 12) * 0.8)), fontWeight: s.patch.fontWeight || 400, fontStyle: s.patch.fontStyle?.includes('italic') ? 'italic' : 'normal', color: s.patch.fill || '#0f172a' }}>
                    {s.label}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">{s.patch.fontSize}pt</span>
                </button>
              ))}
            </div>
          </Anchored>
        </div>
        <Item icon={Paintbrush} label={t('floatingToolbar.formatBrush')} onClick={() => (formatBrush ? setFormatBrush(null) : copyFormat(false))} active={Boolean(formatBrush)} />
        <Item icon={Eraser} label={t('floatingToolbar.clearFormat')} onClick={clearFormat} />
        <Item icon={Copy} label={t('floatingToolbar.duplicate')} onClick={duplicateSelected} />
        <Tooltip label={t('floatingToolbar.delete')}>
          <button onClick={deleteSelected} className="h-7 w-7 rounded-md flex items-center justify-center text-rose-600 hover:bg-rose-50 shrink-0">
            <Trash2 className="w-[15px] h-[15px]" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

export default FloatingTextToolbar;
