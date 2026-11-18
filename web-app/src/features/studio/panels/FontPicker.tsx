import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search, Check } from 'lucide-react';
import { cn } from '../../../components/ui';
import { FONT_CATALOG, listEmbeddedFonts, ensureWebFont, type FontCategory, type FontDef } from '../fonts';
import Anchored from './Anchored';

const CAT_IDS: (FontCategory | 'all' | 'pdf')[] = ['all', 'sans', 'serif', 'display', 'handwriting', 'mono', 'pdf'];
const CAT_KEYS: Record<(typeof CAT_IDS)[number], string> = {
  all: 'fontPicker.catAll',
  sans: 'fontPicker.catSans',
  serif: 'fontPicker.catSerif',
  display: 'fontPicker.catDisplay',
  handwriting: 'fontPicker.catHandwriting',
  mono: 'fontPicker.catMono',
  pdf: 'fontPicker.catPdf'
};

const RECENT_KEY = 'optafiles_studio_recent_fonts';
const loadRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** Word-like font family picker: searchable, categorised, each option rendered in its own face. */
const FontPicker = ({ value, onChange, className }: { value: string; onChange: (family: string) => void; className?: string }) => {
  const { t } = useTranslation('studio');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<(typeof CAT_IDS)[number]>('all');
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo<FontDef[]>(() => [...listEmbeddedFonts(), ...FONT_CATALOG], [open]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((f) => (cat === 'all' ? true : cat === 'pdf' ? f.note?.includes('PDF importado') : f.category === cat)).filter((f) => !q || f.family.toLowerCase().includes(q));
  }, [all, cat, query]);

  // lazily load previews for visible fonts
  useEffect(() => {
    if (!open) return;
    list.slice(0, 40).forEach((f) => void ensureWebFont(f.family));
  }, [open, list]);

  const pick = (family: string) => {
    onChange(family);
    void ensureWebFont(family);
    const next = [family, ...recent.filter((r) => r !== family)].slice(0, 6);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    setOpen(false);
    setQuery('');
  };

  const Row = ({ f }: { f: FontDef }) => (
    <button onClick={() => pick(f.family)} className={cn('w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50', f.family === value && 'bg-brand-50')}>
      <span className="min-w-0">
        <span className="block text-[15px] truncate text-slate-900" style={{ fontFamily: `"${f.family}", sans-serif` }}>
          {f.family}
        </span>
        {f.note && <span className="block text-[10px] text-slate-400">{f.note}</span>}
      </span>
      <span className="flex items-center gap-1 shrink-0">
        <span className="text-[10px] text-slate-400">{t('fontPicker.weights', { count: f.weights.length })}</span>
        {f.family === value && <Check className="w-4 h-4 text-brand-600" />}
      </span>
    </button>
  );

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button onClick={() => setOpen((v) => !v)} className="h-8 w-[170px] rounded-lg border border-slate-200 bg-white px-2.5 flex items-center justify-between gap-2 text-xs font-semibold hover:border-slate-300" title={t('fontPicker.fontLabel')}>
        <span className="truncate" style={{ fontFamily: `"${value}", sans-serif` }}>{value}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>
      <Anchored anchor={ref} open={open} onClose={() => setOpen(false)} width={340} className="p-0">
        <div>
          <div className="sticky top-0 z-10 bg-white p-2 border-b border-slate-100 space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('fontPicker.searchPlaceholder')} className="w-full h-8 pl-8 pr-2 rounded-lg bg-slate-100 text-xs outline-none focus:bg-white focus:ring-2 focus:ring-brand-500/20" onKeyDown={(e) => e.key === 'Enter' && list[0] && pick(list[0].family)} />
            </div>
            <div className="flex gap-1 overflow-x-auto scrollbar-hide">
              {CAT_IDS.map((id) => (
                <button key={id} onClick={() => setCat(id)} className={cn('h-6 px-2 rounded-full text-[10px] font-bold whitespace-nowrap', cat === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                  {t(CAT_KEYS[id])}
                </button>
              ))}
            </div>
          </div>
          <div>
            {!query && cat === 'all' && recent.length > 0 && (
              <>
                <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('fontPicker.recent')}</p>
                {recent.map((r) => all.find((f) => f.family === r)).filter((f): f is FontDef => Boolean(f)).map((f) => <Row key={`r-${f.family}`} f={f} />)}
                <div className="h-px bg-slate-100 my-1" />
              </>
            )}
            {list.length === 0 && <p className="text-xs text-slate-400 text-center py-6">{t('fontPicker.noResults')}</p>}
            {list.map((f) => (
              <Row key={f.family} f={f} />
            ))}
          </div>
          <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400">{t('fontPicker.embedNote')}</div>
        </div>
      </Anchored>
    </div>
  );
};

export default FontPicker;
