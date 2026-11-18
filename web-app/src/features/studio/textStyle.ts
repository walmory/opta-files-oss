import type { EditorElement } from '../../types/pdfEditor';

/** Konva fontStyle string from element (weight + italic) */
export const konvaFontStyle = (el: EditorElement) => {
  const italic = el.fontStyle?.includes('italic');
  const weight = el.fontWeight ?? (el.fontStyle?.includes('bold') ? 700 : 400);
  const w = weight === 400 ? '' : weight === 700 ? 'bold' : String(weight);
  return `${italic ? 'italic ' : ''}${w}`.trim() || 'normal';
};

export const applyTransform = (text: string, t?: EditorElement['textTransform']) => (t === 'uppercase' ? text.toUpperCase() : t === 'lowercase' ? text.toLowerCase() : t === 'capitalize' ? text.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : text);

/** Prefix each non-empty line with a bullet or an incrementing number. */
export const applyList = (text: string, style?: EditorElement['listStyle']) => {
  if (!style || style === 'none') return text;
  let n = 0;
  return text
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line;
      n += 1;
      return style === 'bullet' ? `•  ${line}` : `${n}.  ${line}`;
    })
    .join('\n');
};

/** Full text as rendered on canvas and in the exported PDF (case transform + list markers). */
export const renderedText = (el: EditorElement) => applyList(applyTransform(el.content || '', el.textTransform), el.listStyle);

const SCRIPT_SCALE = 0.62;

/**
 * Effective type metrics for super/subscript. Word shrinks the glyphs and shifts the baseline;
 * we do the same for the whole box so canvas and export stay identical.
 */
export const scriptMetrics = (el: EditorElement) => {
  const base = el.fontSize || 16;
  const script = el.textScript && el.textScript !== 'none' ? el.textScript : null;
  if (!script) return { fontSize: base, dy: 0 };
  return { fontSize: Math.max(2, Math.round(base * SCRIPT_SCALE * 100) / 100), dy: script === 'super' ? -base * 0.33 : base * 0.16 };
};

export type TextStylePreset = {
  id: string;
  label: string;
  preview: string;
  /** patch applied to the selected text elements */
  patch: Partial<EditorElement>;
};

/** Word's Styles gallery (Normal / No Spacing / Heading 1 / Heading 2 / Title). */
export const TEXT_STYLE_PRESETS: TextStylePreset[] = [
  { id: 'normal', label: 'Normal', preview: 'AaBbCcDdEe', patch: { fontSize: 12, fontWeight: 400, fontStyle: 'normal', fill: '#0f172a', lineHeight: 1.25, spaceBefore: 0, spaceAfter: 6, letterSpacing: 0, textTransform: 'none', textDecoration: 'none' } },
  { id: 'no-spacing', label: 'Sem espaço', preview: 'AaBbCcDdEe', patch: { fontSize: 12, fontWeight: 400, fontStyle: 'normal', fill: '#0f172a', lineHeight: 1, spaceBefore: 0, spaceAfter: 0, letterSpacing: 0, textTransform: 'none', textDecoration: 'none' } },
  { id: 'heading-1', label: 'Título 1', preview: 'AaBb', patch: { fontSize: 20, fontWeight: 700, fontStyle: 'bold', fill: '#1b3f8b', lineHeight: 1.15, spaceBefore: 12, spaceAfter: 4, textTransform: 'none', textDecoration: 'none' } },
  { id: 'heading-2', label: 'Título 2', preview: 'AaBb', patch: { fontSize: 16, fontWeight: 600, fontStyle: 'bold', fill: '#2f5bb3', lineHeight: 1.15, spaceBefore: 10, spaceAfter: 4, textTransform: 'none', textDecoration: 'none' } },
  { id: 'title', label: 'Título', preview: 'AaB', patch: { fontSize: 28, fontWeight: 700, fontStyle: 'bold', fill: '#0f172a', lineHeight: 1.1, letterSpacing: -0.5, spaceBefore: 0, spaceAfter: 10, textTransform: 'none', textDecoration: 'none' } },
  { id: 'subtitle', label: 'Subtítulo', preview: 'AaBbCc', patch: { fontSize: 14, fontWeight: 400, fontStyle: 'italic', fill: '#64748b', lineHeight: 1.2, letterSpacing: 0.4, spaceBefore: 0, spaceAfter: 8, textTransform: 'none', textDecoration: 'none' } },
  { id: 'quote', label: 'Citação', preview: 'AaBbCc', patch: { fontSize: 12, fontWeight: 400, fontStyle: 'italic', fill: '#475569', lineHeight: 1.4, indent: 24, spaceBefore: 6, spaceAfter: 6, textTransform: 'none', textDecoration: 'none' } },
  { id: 'caption', label: 'Legenda', preview: 'AaBbCc', patch: { fontSize: 9, fontWeight: 400, fontStyle: 'normal', fill: '#64748b', lineHeight: 1.2, letterSpacing: 0.2, spaceBefore: 2, spaceAfter: 2, textTransform: 'none', textDecoration: 'none' } }
];

/** Text properties carried by the format painter and reset by "clear formatting". */
export const TEXT_FORMAT_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'textTransform', 'align', 'lineHeight', 'letterSpacing', 'padding', 'fill', 'backgroundColor', 'listStyle', 'indent', 'textScript', 'spaceBefore', 'spaceAfter', 'stroke', 'strokeWidth', 'opacity'] as const;

/** Non-text (shape/image) properties carried by the format painter. */
export const SHAPE_FORMAT_KEYS = ['fill', 'stroke', 'strokeWidth', 'cornerRadius', 'opacity'] as const;

export const pickFormat = (el: EditorElement): Partial<EditorElement> => {
  const keys = el.type === 'text' ? TEXT_FORMAT_KEYS : SHAPE_FORMAT_KEYS;
  const out: Record<string, unknown> = {};
  keys.forEach((k) => {
    const v = (el as unknown as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  });
  return out as Partial<EditorElement>;
};

/** Word's "Clear All Formatting": back to plain body text, content untouched. */
export const CLEARED_TEXT_FORMAT: Partial<EditorElement> = {
  fontWeight: 400,
  fontStyle: 'normal',
  textDecoration: 'none',
  textTransform: 'none',
  textScript: 'none',
  listStyle: 'none',
  indent: 0,
  letterSpacing: 0,
  lineHeight: 1.25,
  spaceBefore: 0,
  spaceAfter: 0,
  backgroundColor: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  fill: '#0f172a',
  opacity: 1
};
