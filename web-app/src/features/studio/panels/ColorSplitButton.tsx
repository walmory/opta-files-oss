import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { cn, Tooltip } from '../../../components/ui';
import Anchored from './Anchored';

import { THEME_COLORS, STANDARD_COLORS } from './colors';

interface Props {
  /** Icon rendered above the colour bar (Word puts the A / pen / bucket glyph here). */
  icon: React.ReactNode;
  value?: string;
  /** Colour applied when the main half of the button is clicked. */
  onChange: (value: string) => void;
  label: string;
  swatches?: string[];
  allowTransparent?: boolean;
  transparentLabel?: string;
  /** Colour shown in the bar when the value is unset/transparent. */
  fallbackBar?: string;
  compact?: boolean;
}

/**
 * Word-style split button: clicking the glyph applies the last colour, clicking the caret
 * opens the palette. Keeps one-click re-application fast, which is the whole point of the control.
 */
const ColorSplitButton = ({ icon, value, onChange, label, swatches = [...THEME_COLORS, ...STANDARD_COLORS], allowTransparent, transparentLabel, fallbackBar = '#ef4444', compact }: Props) => {
  const { t } = useTranslation('studio');
  const resolvedTransparentLabel = transparentLabel ?? t('colorPicker.noColor');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // remember the last real colour so the glyph half re-applies it with one click
  const recent = useRef<string | undefined>(undefined);
  if (value && value !== 'transparent') recent.current = value;

  const bar = recent.current || fallbackBar;
  const pick = (c: string) => {
    onChange(c);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative flex">
      <Tooltip label={label}>
        <button onClick={() => pick(bar)} className={cn('rounded-l-md flex flex-col items-center justify-center gap-0 hover:bg-slate-200/70 text-slate-700', compact ? 'h-7 w-7' : 'h-[26px] w-[26px]')}>
          <span className="leading-none">{icon}</span>
          <span className="w-[15px] h-[3px] rounded-sm mt-[1px] border border-black/10" style={{ background: bar }} />
        </button>
      </Tooltip>
      <button onClick={() => setOpen((v) => !v)} aria-label={t('colorPicker.moreColorsAria', { label })} className={cn('rounded-r-md flex items-center justify-center hover:bg-slate-200/70 text-slate-500', compact ? 'h-7 w-3.5' : 'h-[26px] w-3.5', open && 'bg-slate-200/70')}>
        <ChevronDown className="w-3 h-3" />
      </button>
      <Anchored anchor={ref} open={open} onClose={() => setOpen(false)} width={212} className="p-2.5">
        <div>
          {allowTransparent && (
            <button onClick={() => pick('transparent')} className="w-full h-7 mb-2 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-2 px-2">
              <span className="w-4 h-4 rounded border border-slate-200" style={{ background: 'repeating-conic-gradient(#e2e8f0 0 25%, #fff 0 50%) 0 0/6px 6px' }} />
              {resolvedTransparentLabel}
            </button>
          )}
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">{t('colorPicker.colorsLabel')}</p>
          <div className="grid grid-cols-9 gap-1">
            {swatches.map((c) => (
              <button key={c} title={c} onClick={() => pick(c)} className={cn('w-5 h-5 rounded border', value === c ? 'ring-2 ring-brand-500 border-transparent' : 'border-slate-200 hover:scale-110 transition-transform')} style={{ background: c }} />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input type="color" value={value && value !== 'transparent' ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 rounded-md border border-slate-200 p-0.5 cursor-pointer" title={t('colorPicker.moreColorsTitle')} />
            <input value={value === 'transparent' ? '' : value || ''} placeholder="#000000" onChange={(e) => onChange(e.target.value)} className="flex-1 h-7 px-2 rounded-md border border-slate-200 text-[11px] font-mono outline-none focus:border-brand-400" />
          </div>
        </div>
      </Anchored>
    </div>
  );
};

export default ColorSplitButton;
