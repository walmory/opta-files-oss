/**
 * Font catalog + loading (Word-like font picker).
 * - PDF standard 14 fonts: always exportable without embedding.
 * - Google Fonts: loaded on demand for canvas rendering; TTF fetched through the backend for PDF embedding.
 * - Embedded PDF fonts (TrueType/OpenType extracted by PDFium): registered as FontFace + embedded on export.
 */
import { apiFetch } from '../../config/env';

export type FontCategory = 'sans' | 'serif' | 'display' | 'handwriting' | 'mono';

export interface FontDef {
  family: string;
  category: FontCategory;
  weights: number[];
  italic: boolean;
  /** PDF standard font (no embedding needed) */
  standard?: boolean;
  /** metric-compatible replacement info */
  note?: string;
}

export const STANDARD_FONTS: FontDef[] = [
  { family: 'Helvetica', category: 'sans', weights: [400, 700], italic: true, standard: true, note: 'Padrão PDF (Arial)' },
  { family: 'Times', category: 'serif', weights: [400, 700], italic: true, standard: true, note: 'Padrão PDF (Times New Roman)' },
  { family: 'Courier', category: 'mono', weights: [400, 700], italic: true, standard: true, note: 'Padrão PDF' }
];

export const GOOGLE_FONTS: FontDef[] = [
  { family: 'Arimo', category: 'sans', weights: [400, 500, 600, 700], italic: true, note: 'Compatível com Arial' },
  { family: 'Tinos', category: 'serif', weights: [400, 700], italic: true, note: 'Compatível com Times New Roman' },
  { family: 'Cousine', category: 'mono', weights: [400, 700], italic: true, note: 'Compatível com Courier New' },
  { family: 'Carlito', category: 'sans', weights: [400, 700], italic: true, note: 'Compatível com Calibri' },
  { family: 'Caladea', category: 'serif', weights: [400, 700], italic: true, note: 'Compatível com Cambria' },
  { family: 'Gelasio', category: 'serif', weights: [400, 500, 600, 700], italic: true, note: 'Compatível com Georgia' },
  { family: 'Inter', category: 'sans', weights: [300, 400, 500, 600, 700, 800, 900], italic: false },
  { family: 'Roboto', category: 'sans', weights: [300, 400, 500, 700, 900], italic: true },
  { family: 'Open Sans', category: 'sans', weights: [300, 400, 500, 600, 700, 800], italic: true },
  { family: 'Lato', category: 'sans', weights: [300, 400, 700, 900], italic: true },
  { family: 'Montserrat', category: 'sans', weights: [300, 400, 500, 600, 700, 800, 900], italic: true },
  { family: 'Poppins', category: 'sans', weights: [300, 400, 500, 600, 700, 800], italic: true },
  { family: 'Nunito', category: 'sans', weights: [300, 400, 600, 700, 800, 900], italic: true },
  { family: 'Raleway', category: 'sans', weights: [300, 400, 500, 600, 700, 800], italic: true },
  { family: 'Manrope', category: 'sans', weights: [400, 500, 600, 700, 800], italic: false },
  { family: 'DM Sans', category: 'sans', weights: [400, 500, 700], italic: true },
  { family: 'Work Sans', category: 'sans', weights: [300, 400, 500, 600, 700, 800], italic: true },
  { family: 'Rubik', category: 'sans', weights: [300, 400, 500, 600, 700, 800, 900], italic: true },
  { family: 'Source Sans 3', category: 'sans', weights: [300, 400, 600, 700, 900], italic: true },
  { family: 'Noto Sans', category: 'sans', weights: [400, 500, 700], italic: true, note: 'Ampla cobertura de idiomas' },
  { family: 'Ubuntu', category: 'sans', weights: [300, 400, 500, 700], italic: true },
  { family: 'Quicksand', category: 'sans', weights: [300, 400, 500, 600, 700], italic: false },
  { family: 'Josefin Sans', category: 'sans', weights: [300, 400, 600, 700], italic: true },
  { family: 'Karla', category: 'sans', weights: [300, 400, 500, 600, 700, 800], italic: true },
  { family: 'Merriweather', category: 'serif', weights: [300, 400, 700, 900], italic: true },
  { family: 'Playfair Display', category: 'serif', weights: [400, 500, 600, 700, 800, 900], italic: true },
  { family: 'Lora', category: 'serif', weights: [400, 500, 600, 700], italic: true },
  { family: 'PT Serif', category: 'serif', weights: [400, 700], italic: true },
  { family: 'EB Garamond', category: 'serif', weights: [400, 500, 600, 700, 800], italic: true },
  { family: 'Cormorant Garamond', category: 'serif', weights: [300, 400, 500, 600, 700], italic: true },
  { family: 'Libre Baskerville', category: 'serif', weights: [400, 700], italic: true },
  { family: 'Crimson Text', category: 'serif', weights: [400, 600, 700], italic: true },
  { family: 'Oswald', category: 'display', weights: [300, 400, 500, 600, 700], italic: false },
  { family: 'Bebas Neue', category: 'display', weights: [400], italic: false },
  { family: 'Anton', category: 'display', weights: [400], italic: false },
  { family: 'Archivo Black', category: 'display', weights: [400], italic: false },
  { family: 'Abril Fatface', category: 'display', weights: [400], italic: false },
  { family: 'Righteous', category: 'display', weights: [400], italic: false },
  { family: 'Lobster', category: 'display', weights: [400], italic: false },
  { family: 'Pacifico', category: 'handwriting', weights: [400], italic: false },
  { family: 'Dancing Script', category: 'handwriting', weights: [400, 500, 600, 700], italic: false },
  { family: 'Caveat', category: 'handwriting', weights: [400, 500, 600, 700], italic: false },
  { family: 'Great Vibes', category: 'handwriting', weights: [400], italic: false },
  { family: 'Satisfy', category: 'handwriting', weights: [400], italic: false },
  { family: 'Kalam', category: 'handwriting', weights: [300, 400, 700], italic: false },
  { family: 'Roboto Mono', category: 'mono', weights: [300, 400, 500, 600, 700], italic: true },
  { family: 'JetBrains Mono', category: 'mono', weights: [300, 400, 500, 600, 700, 800], italic: true },
  { family: 'Source Code Pro', category: 'mono', weights: [300, 400, 500, 600, 700, 900], italic: true }
];

export const FONT_CATALOG: FontDef[] = [...STANDARD_FONTS, ...GOOGLE_FONTS];

/** Fonts extracted from imported PDFs (registered at runtime) */
const embeddedFonts = new Map<string, { data: Uint8Array; face: FontFace; def: FontDef }>();

export const registerEmbeddedFont = async (family: string, data: Uint8Array, opts: { weight?: number; italic?: boolean } = {}): Promise<boolean> => {
  if (embeddedFonts.has(family)) return true;
  try {
    const face = new FontFace(family, data.buffer as ArrayBuffer, { weight: String(opts.weight || 400), style: opts.italic ? 'italic' : 'normal' });
    await face.load();
    document.fonts.add(face);
    embeddedFonts.set(family, { data, face, def: { family, category: 'sans', weights: [opts.weight || 400], italic: Boolean(opts.italic) } });
    return true;
  } catch (e) {
    console.warn('Embedded font rejected by browser', family, e);
    return false;
  }
};
export const getEmbeddedFont = (family: string) => embeddedFonts.get(family);
export const listEmbeddedFonts = (): FontDef[] => Array.from(embeddedFonts.values()).map((v) => ({ ...v.def, note: 'Fonte do PDF importado' }));

export const findFont = (family: string): FontDef | undefined => FONT_CATALOG.find((f) => f.family.toLowerCase() === family.toLowerCase()) || embeddedFonts.get(family)?.def;

export const isStandardFont = (family: string) => STANDARD_FONTS.some((f) => f.family.toLowerCase() === family.toLowerCase());

/** Nearest available weight for a family */
export const nearestWeight = (family: string, weight: number) => {
  const def = findFont(family);
  if (!def) return weight >= 600 ? 700 : 400;
  return def.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), def.weights[0]);
};

/* ------------------------------------------------------------------ web font loading (canvas) */
const linkPromises = new Map<string, Promise<void>>();
const fontListeners = new Set<() => void>();
export const onFontsChanged = (fn: () => void) => {
  fontListeners.add(fn);
  return () => fontListeners.delete(fn);
};
const notify = () => fontListeners.forEach((fn) => fn());

export const ensureWebFont = async (family: string): Promise<void> => {
  const def = findFont(family);
  if (!def || def.standard || embeddedFonts.has(family)) return;
  if (!linkPromises.has(family)) {
    const axes = def.italic ? `ital,wght@${def.weights.map((w) => `0,${w}`).join(';')};${def.weights.map((w) => `1,${w}`).join(';')}` : `wght@${def.weights.join(';')}`;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${axes}&display=swap`;
    const p = new Promise<void>((resolve) => {
      link.onload = () => resolve();
      link.onerror = () => resolve();
      setTimeout(resolve, 6000);
    });
    document.head.appendChild(link);
    linkPromises.set(family, p);
  }
  await linkPromises.get(family);
  try {
    await Promise.all(def.weights.map((w) => document.fonts.load(`${w} 16px "${family}"`)));
    if (def.italic) await document.fonts.load(`italic 16px "${family}"`);
  } catch {
    // ignore
  }
  notify();
};

/* ------------------------------------------------------------------ TTF bytes for PDF embedding */
const ttfCache = new Map<string, Promise<Uint8Array | null>>();

export const getFontBytes = (family: string, weight = 400, italic = false): Promise<Uint8Array | null> => {
  const emb = embeddedFonts.get(family);
  if (emb) return Promise.resolve(emb.data);
  const def = findFont(family);
  if (!def || def.standard) return Promise.resolve(null);
  const w = nearestWeight(family, weight);
  const it = italic && def.italic;
  const key = `${family}|${w}|${it ? 1 : 0}`;
  if (!ttfCache.has(key)) {
    ttfCache.set(
      key,
      (async () => {
        try {
          const res = await apiFetch(`/fonts/ttf?family=${encodeURIComponent(family)}&weight=${w}&italic=${it ? 1 : 0}`);
          if (!res.ok) return null;
          return new Uint8Array(await res.arrayBuffer());
        } catch {
          return null;
        }
      })()
    );
  }
  return ttfCache.get(key)!;
};

/* ------------------------------------------------------------------ PDF font name → catalog family */
export const mapPdfFontToFamily = (fontName: string, hints: { serif?: boolean; mono?: boolean } = {}): string => {
  const n = fontName.toLowerCase().replace(/[\s_-]/g, '');
  const table: [RegExp, string][] = [
    [/arial|helvetica|liberationsans|freesans|nimbussans|dejavusans(?!mono)/, 'Arimo'],
    [/timesnewroman|times|liberationserif|nimbusroman|freeserif/, 'Tinos'],
    [/couriernew|courier|liberationmono|nimbusmono|dejavusansmono/, 'Cousine'],
    [/calibri/, 'Carlito'],
    [/cambria/, 'Caladea'],
    [/georgia/, 'Gelasio'],
    [/verdana|tahoma/, 'Open Sans'],
    [/segoe/, 'Noto Sans'],
    [/garamond/, 'EB Garamond'],
    [/palatino|bookantiqua/, 'Libre Baskerville'],
    [/consolas|menlo|monaco/, 'JetBrains Mono'],
    [/roboto(?!mono)/, 'Roboto'],
    [/robotomono/, 'Roboto Mono'],
    [/opensans/, 'Open Sans'],
    [/lato/, 'Lato'],
    [/montserrat/, 'Montserrat'],
    [/poppins/, 'Poppins'],
    [/inter(?!national)/, 'Inter'],
    [/nunito/, 'Nunito'],
    [/raleway/, 'Raleway'],
    [/merriweather/, 'Merriweather'],
    [/playfair/, 'Playfair Display'],
    [/lora/, 'Lora'],
    [/oswald/, 'Oswald'],
    [/manrope/, 'Manrope'],
    [/ubuntu/, 'Ubuntu'],
    [/sourcesans/, 'Source Sans 3'],
    [/notosans/, 'Noto Sans'],
    [/dmsans/, 'DM Sans'],
    [/worksans/, 'Work Sans']
  ];
  for (const [re, fam] of table) if (re.test(n)) return fam;
  if (hints.mono) return 'Cousine';
  if (hints.serif) return 'Tinos';
  return 'Arimo';
};

export const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96];
