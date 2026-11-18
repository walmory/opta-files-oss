/**
 * Groups PDFium text runs into editable paragraphs (lines → blocks), the way desktop editors do.
 * Coordinates: input is PDF user space (y up); output is canvas space (y down, origin top-left).
 */
import type { EditorElement } from '../../../types/pdfEditor';
import type { ExtractedImage, ExtractedPage, ExtractedText } from './pdfium';
import { ensureWebFont, mapPdfFontToFamily, registerEmbeddedFont } from '../fonts';

const uid = () => crypto.randomUUID();

/**
 * Width of a line as the canvas will really draw it. The substituted (or embedded) face rarely has the
 * advance widths of the original PDF font, so the ink box measured by PDFium is not a safe wrap width:
 * a few percent wider and every line folds in two and the paragraph runs over the next one.
 */
let measureCtx: CanvasRenderingContext2D | null = null;
const measureLine = (text: string, size: number, family: string, bold: boolean, italic: boolean): number => {
  if (!text) return 0;
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return 0;
  measureCtx.font = `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${size}px "${family}", sans-serif`;
  return measureCtx.measureText(text).width;
};

interface Line {
  runs: ExtractedText[];
  left: number;
  right: number;
  baseline: number; // canvas y
  top: number;
  bottom: number;
  size: number;
  text: string;
  key: string; // font signature
}

const sig = (t: ExtractedText) => `${t.fontKey || t.fontName}|${t.bold ? 'b' : ''}${t.italic ? 'i' : ''}|${t.color}`;

const buildLines = (runs: ExtractedText[], H: number): Line[] => {
  const sorted = [...runs].sort((a, b) => b.baseline - a.baseline || a.left - b.left);
  const lines: Line[] = [];
  for (const r of sorted) {
    const tol = Math.max(1, r.fontSize * 0.35);
    const line = lines.find((l) => Math.abs(H - r.baseline - l.baseline) <= tol && Math.abs(l.size - r.fontSize) <= Math.max(1, l.size * 0.25) && r.left >= l.left - r.fontSize * 8);
    if (line) {
      line.runs.push(r);
    } else {
      lines.push({ runs: [r], left: r.left, right: r.right, baseline: H - r.baseline, top: H - r.top, bottom: H - r.bottom, size: r.fontSize, text: '', key: sig(r) });
    }
  }
  for (const l of lines) {
    l.runs.sort((a, b) => a.left - b.left);
    let text = '';
    let prevRight: number | null = null;
    for (const r of l.runs) {
      if (prevRight !== null) {
        const gap = r.left - prevRight;
        if (gap > r.fontSize * 0.22 && !text.endsWith(' ') && !r.text.startsWith(' ')) text += ' ';
      }
      text += r.text;
      prevRight = r.right;
    }
    l.text = text.replace(/\s+$/g, '');
    l.left = Math.min(...l.runs.map((r) => r.left));
    l.right = Math.max(...l.runs.map((r) => r.right));
    l.top = Math.min(...l.runs.map((r) => H - r.top));
    l.bottom = Math.max(...l.runs.map((r) => H - r.bottom));
  }
  return lines.sort((a, b) => a.baseline - b.baseline || a.left - b.left);
};

const buildParagraphs = (lines: Line[]): Line[][] => {
  const paras: Line[][] = [];
  for (const l of lines) {
    const p = paras[paras.length - 1];
    if (p) {
      const prev = p[p.length - 1];
      const gap = l.baseline - prev.baseline;
      const sameFont = l.key === prev.key && Math.abs(l.size - prev.size) <= Math.max(0.6, prev.size * 0.15);
      const closeEnough = gap > 0 && gap <= prev.size * 1.9;
      const leftAligned = Math.abs(l.left - prev.left) <= prev.size * 2.5;
      const centered = Math.abs((l.left + l.right) / 2 - (prev.left + prev.right) / 2) <= prev.size * 1.5;
      const rightAligned = Math.abs(l.right - prev.right) <= prev.size * 1.5;
      const overlapsX = l.left < prev.right + prev.size * 2 && l.right > prev.left - prev.size * 2;
      if (sameFont && closeEnough && overlapsX && (leftAligned || centered || rightAligned)) {
        p.push(l);
        continue;
      }
    }
    paras.push([l]);
  }
  return paras;
};

const detectAlign = (lines: Line[], boxLeft: number, boxRight: number): EditorElement['align'] => {
  if (lines.length < 2) return 'left';
  const size = lines[0].size;
  const boxCenter = (boxLeft + boxRight) / 2;
  const centered = lines.every((l) => Math.abs((l.left + l.right) / 2 - boxCenter) <= size * 0.6);
  const lefts = lines.every((l) => Math.abs(l.left - boxLeft) <= size * 0.4);
  const rights = lines.every((l) => Math.abs(l.right - boxRight) <= size * 0.4);
  if (lefts && rights) return 'justify';
  if (lefts) return 'left';
  if (rights) return 'right';
  if (centered) return 'center';
  return 'left';
};

export interface GroupOptions {
  /** Register embedded TrueType fonts and use them for rendering */
  useEmbeddedFonts?: boolean;
  /** Turn extracted vector artwork into editable path elements (default true) */
  paths?: boolean;
}

export const pageToElements = async (page: ExtractedPage, opts: GroupOptions = {}): Promise<EditorElement[]> => {
  const H = page.height;
  // paint order is rebuilt at the end so vectors, images and text keep the stacking the PDF had
  const els: (EditorElement & { order: number })[] = [];

  if (opts.paths !== false) {
    for (const p of page.paths) {
      els.push({
        id: uid(),
        type: 'path',
        content: p.d,
        x: p.left,
        y: H - p.top,
        width: Math.max(1, p.right - p.left),
        height: Math.max(1, p.top - p.bottom),
        // the path data is already in element-local points, so it must not be rescaled to the 24pt icon box
        scaleX: 1,
        scaleY: 1,
        fill: p.fill,
        stroke: p.stroke,
        strokeWidth: p.strokeWidth,
        opacity: p.opacity < 1 ? p.opacity : undefined,
        name: 'Vetor',
        order: p.order
      });
    }
  }

  for (const im of page.images as ExtractedImage[]) {
    els.push({ id: uid(), type: 'image', content: im.dataUrl, x: im.left, y: H - im.top, width: im.right - im.left, height: im.top - im.bottom, name: 'Imagem', order: im.order });
  }

  // embedded fonts → FontFace
  const familyByKey = new Map<string, string>();
  if (opts.useEmbeddedFonts !== false) {
    for (const [key, f] of Object.entries(page.fonts)) {
      if (!f.data) continue;
      const family = `PDF ${f.name}`.slice(0, 60);
      const run = page.texts.find((t) => t.fontKey === key);
      const ok = await registerEmbeddedFont(family, f.data, { weight: run?.bold ? 700 : 400, italic: run?.italic });
      if (ok) familyByKey.set(key, family);
    }
  }

  // web fonts must be loaded before measuring, otherwise measureText falls back to the wrong metrics
  const families = new Set<string>();
  for (const t of page.texts) {
    if (familyByKey.has(t.fontKey)) continue;
    families.add(mapPdfFontToFamily(t.fontName || t.family, { serif: t.serif, mono: t.mono }));
  }
  await Promise.all([...families].map((f) => ensureWebFont(f).catch(() => undefined)));

  const horizontal = page.texts.filter((t) => Math.abs(t.rotation) < 1.5);
  const rotated = page.texts.filter((t) => Math.abs(t.rotation) >= 1.5);

  const paragraphs = buildParagraphs(buildLines(horizontal, H));
  for (const lines of paragraphs) {
    const first = lines[0].runs[0];
    const size = Math.round(lines[0].size * 100) / 100;
    const left = Math.min(...lines.map((l) => l.left));
    const right = Math.max(...lines.map((l) => l.right));
    const top = Math.min(...lines.map((l) => l.top));
    const lastBaseline = lines[lines.length - 1].baseline;
    const gaps = lines.slice(1).map((l, i) => l.baseline - lines[i].baseline);
    const lineHeight = gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length / size) * 100) / 100 : 1.2;
    const family = familyByKey.get(first.fontKey) || mapPdfFontToFamily(first.fontName || first.family, { serif: first.serif, mono: first.mono });
    const ascentTop = lines[0].baseline - size * 0.92; // consistent box top regardless of glyph bounds
    const y = Math.min(top, ascentTop);
    const lh = Math.max(0.8, Math.min(3, lineHeight));
    const height = Math.max(size * 1.2, lastBaseline + size * 0.3 - y, lines.length * size * lh);
    const align = detectAlign(lines, left, right);
    const bold = Boolean(first.bold) || first.weight >= 600;
    const drawn = Math.max(0, ...lines.map((l) => measureLine(l.text, size, family, bold, Boolean(first.italic))));
    // box must fit the widest line as rendered here, not as measured in the source PDF
    const width = Math.max(size, right - left, drawn) + size * 0.6;
    els.push({
      id: uid(),
      type: 'text',
      content: lines.map((l) => l.text).join('\n'),
      x: left,
      y,
      width,
      height,
      fontSize: size,
      fontFamily: family,
      fontStyle: first.bold && first.italic ? 'bold italic' : first.bold ? 'bold' : first.italic ? 'italic' : 'normal',
      fontWeight: familyByKey.has(first.fontKey) ? undefined : first.weight >= 600 ? 700 : 400,
      fill: first.color,
      opacity: first.alpha < 1 ? first.alpha : undefined,
      align,
      lineHeight: lh,
      // the PDF already decided where every line breaks; reflowing would only misplace them
      wrap: 'none',
      padding: 0,
      name: lines[0].text.slice(0, 24) || 'Texto',
      order: Math.min(...lines.flatMap((l) => l.runs.map((r) => r.order)))
    });
  }

  // rotated runs (watermarks, vertical labels): one element per run, box anchored on the baseline origin and
  // offset by the ascent along the run's own "up" direction so the glyphs sit where PDFium drew them
  for (const t of rotated) {
    const family = familyByKey.get(t.fontKey) || mapPdfFontToFamily(t.fontName || t.family, { serif: t.serif, mono: t.mono });
    const size = Math.round(t.fontSize * 100) / 100;
    const w = Math.max(size, t.runWidth) + size * 0.3;
    const rad = (t.rotation * Math.PI) / 180;
    const ascent = size * 0.92;
    els.push({
      id: uid(),
      type: 'text',
      content: t.text.replace(/\s+$/g, ''),
      x: t.originX + Math.sin(rad) * ascent,
      y: H - t.baseline - Math.cos(rad) * ascent,
      width: w,
      height: size * 1.25,
      rotation: Math.round(t.rotation * 100) / 100,
      fontSize: size,
      fontFamily: family,
      fontStyle: t.bold && t.italic ? 'bold italic' : t.bold ? 'bold' : t.italic ? 'italic' : 'normal',
      fontWeight: familyByKey.has(t.fontKey) ? undefined : t.weight >= 600 ? 700 : 400,
      fill: t.color,
      opacity: t.alpha < 1 ? t.alpha : undefined,
      padding: 0,
      lineHeight: 1.2,
      wrap: 'none',
      name: t.text.trim().slice(0, 24) || 'Texto',
      order: t.order
    });
  }

  return els
    .sort((a, b) => a.order - b.order)
    .map((el) => {
      const copy: EditorElement & { order?: number } = { ...el };
      delete copy.order;
      return copy as EditorElement;
    });
};
