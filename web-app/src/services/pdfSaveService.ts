import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { EditorElement, EditorPage } from '../types/pdfEditor';
import { getFontBytes, isStandardFont, findFont } from '../features/studio/fonts';
import { renderedText, scriptMetrics } from '../features/studio/textStyle';

const parseColor = (color?: string): RGB | undefined => {
  if (!color || color === 'transparent') return undefined;
  const hex = color.trim();
  const m = hex.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  const rgbm = hex.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbm) return rgb(Number(rgbm[1]) / 255, Number(rgbm[2]) / 255, Number(rgbm[3]) / 255);
  return undefined;
};

/* ------------------------------------------------------------------ fonts */
class FontResolver {
  private cache = new Map<string, Promise<PDFFont>>();
  private std = new Map<string, Promise<PDFFont>>();
  private doc: PDFDocument;
  constructor(doc: PDFDocument) {
    this.doc = doc;
    doc.registerFontkit(fontkit);
  }

  private standard(family: string, bold: boolean, italic: boolean) {
    const fam = family.toLowerCase();
    const base = fam.includes('times') || fam.includes('tinos') || fam.includes('serif') ? 'times' : fam.includes('courier') || fam.includes('cousine') || fam.includes('mono') ? 'courier' : 'helvetica';
    const key = `${base}-${bold ? 'b' : ''}${italic ? 'i' : ''}`;
    if (!this.std.has(key)) {
      const table: Record<string, StandardFonts> = {
        'helvetica-': StandardFonts.Helvetica,
        'helvetica-b': StandardFonts.HelveticaBold,
        'helvetica-i': StandardFonts.HelveticaOblique,
        'helvetica-bi': StandardFonts.HelveticaBoldOblique,
        'times-': StandardFonts.TimesRoman,
        'times-b': StandardFonts.TimesRomanBold,
        'times-i': StandardFonts.TimesRomanItalic,
        'times-bi': StandardFonts.TimesRomanBoldItalic,
        'courier-': StandardFonts.Courier,
        'courier-b': StandardFonts.CourierBold,
        'courier-i': StandardFonts.CourierOblique,
        'courier-bi': StandardFonts.CourierBoldOblique
      };
      this.std.set(key, this.doc.embedFont(table[key]));
    }
    return this.std.get(key)!;
  }

  /** Resolves the best available font: embedded/Google TTF via backend, or a metric-similar standard font. */
  resolve(family: string | undefined, weight: number, italic: boolean): Promise<PDFFont> {
    const fam = family || 'Helvetica';
    const bold = weight >= 600;
    if (isStandardFont(fam) || !findFont(fam)) return this.standard(fam, bold, italic);
    const key = `${fam}|${weight}|${italic ? 1 : 0}`;
    if (!this.cache.has(key)) {
      this.cache.set(
        key,
        (async () => {
          const bytes = await getFontBytes(fam, weight, italic);
          if (bytes) {
            try {
              return await this.doc.embedFont(bytes, { subset: true });
            } catch (e) {
              console.warn('Font embed failed, falling back to standard', fam, e);
            }
          }
          return this.standard(fam, bold, italic);
        })()
      );
    }
    return this.cache.get(key)!;
  }
}

/* ------------------------------------------------------------------ geometry */
const localToWorld = (el: EditorElement, lx: number, ly: number) => {
  const rad = ((el.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: el.x + lx * cos - ly * sin, y: el.y + lx * sin + ly * cos };
};
const localToPdf = (el: EditorElement, pageHeight: number, lx: number, ly: number) => {
  const w = localToWorld(el, lx, ly);
  return { x: w.x, y: pageHeight - w.y };
};

const safeWidth = (font: PDFFont, s: string, size: number) => {
  try {
    return font.widthOfTextAtSize(s, size);
  } catch {
    // glyph missing in subset font → approximate
    return s.length * size * 0.5;
  }
};

const wrapText = (text: string, font: PDFFont, size: number, maxWidth: number, letterSpacing = 0, reflow = true): { text: string; hard: boolean }[] => {
  const paragraphs = text.split(/\r?\n/);
  // imported PDF text keeps its own line breaks: re-wrapping it here would not match what the canvas showed
  if (!reflow) return paragraphs.map((t) => ({ text: t, hard: true }));
  const lines: { text: string; hard: boolean }[] = [];
  const measure = (s: string) => safeWidth(font, s, size) + Math.max(0, s.length - 1) * letterSpacing;
  for (const para of paragraphs) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth || !line) line = candidate;
      else {
        lines.push({ text: line, hard: false });
        line = word;
      }
    }
    lines.push({ text: line, hard: true });
  }
  return lines;
};

const roundedRectPath = (w: number, h: number, r: number) => {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M ${rr} 0 H ${w - rr} A ${rr} ${rr} 0 0 1 ${w} ${rr} V ${h - rr} A ${rr} ${rr} 0 0 1 ${w - rr} ${h} H ${rr} A ${rr} ${rr} 0 0 1 0 ${h - rr} V ${rr} A ${rr} ${rr} 0 0 1 ${rr} 0 Z`;
};

const embedImage = async (doc: PDFDocument, dataUrl: string) => {
  if (dataUrl.startsWith('data:image/png')) return doc.embedPng(dataUrl);
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return doc.embedJpg(dataUrl);
  const png = await new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || 1;
      c.height = img.naturalHeight || 1;
      c.getContext('2d')?.drawImage(img, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
  return doc.embedPng(png);
};

/* ------------------------------------------------------------------ elements */
const drawText = async (page: PDFPage, el: EditorElement, fonts: FontResolver) => {
  const H = page.getSize().height;
  const rot = degrees(-(el.rotation || 0));
  const opacity = el.opacity ?? 1;
  const w = el.width * (el.scaleX || 1);
  const h = el.height * (el.scaleY || 1);
  const { fontSize: size, dy } = scriptMetrics(el);
  const weight = el.fontWeight ?? (el.fontStyle?.includes('bold') ? 700 : 400);
  const italic = Boolean(el.fontStyle?.includes('italic'));
  const font = await fonts.resolve(el.fontFamily, weight, italic);
  const lineHeight = size * (el.lineHeight || 1.2);
  const padding = el.padding ?? 4;
  const indent = el.indent || 0;
  const color = parseColor(el.fill) || rgb(0, 0, 0);
  const ls = el.letterSpacing || 0;
  if (el.backgroundColor && el.backgroundColor !== 'transparent') {
    const bl = localToPdf(el, H, 0, h);
    page.drawRectangle({ x: bl.x, y: bl.y, width: w, height: h, color: parseColor(el.backgroundColor), rotate: rot, opacity });
  }
  if (el.stroke && el.stroke !== 'transparent' && (el.strokeWidth || 0) > 0) {
    const bl = localToPdf(el, H, 0, h);
    page.drawRectangle({ x: bl.x, y: bl.y, width: w, height: h, borderColor: parseColor(el.stroke), borderWidth: el.strokeWidth, rotate: rot, opacity });
  }
  const content = renderedText(el);
  // text box geometry must match the Konva <Text> node exactly: left edge at padding+indent
  const textLeft = padding + indent;
  const maxW = Math.max(10, w - padding * 2 - indent);
  const topOffset = padding + (el.spaceBefore || 0) + dy;
  const lines = wrapText(content, font, size, maxW, ls, el.wrap !== 'none');
  const drawRun = (s: string, lx: number, baseY: number) => {
    if (ls) {
      let cx = 0;
      for (const ch of s) {
        const cp = localToPdf(el, H, lx + cx, baseY);
        page.drawText(ch, { x: cp.x, y: cp.y, size, font, color, rotate: rot, opacity });
        cx += safeWidth(font, ch, size) + ls;
      }
    } else {
      const p = localToPdf(el, H, lx, baseY);
      page.drawText(s, { x: p.x, y: p.y, size, font, color, rotate: rot, opacity });
    }
  };
  lines.forEach((line, i) => {
    const lw = safeWidth(font, line.text, size) + Math.max(0, line.text.length - 1) * ls;
    const baselineLocalY = topOffset + i * lineHeight + size * 0.8;
    let lx = textLeft;
    if (el.align === 'center') lx = textLeft + (maxW - lw) / 2;
    else if (el.align === 'right') lx = textLeft + maxW - lw;
    if (el.align === 'justify' && !line.hard && line.text.includes(' ')) {
      // distribute extra space between words
      const words = line.text.split(' ');
      const wordsW = words.reduce((a, wd) => a + safeWidth(font, wd, size), 0);
      const gap = (maxW - wordsW) / (words.length - 1);
      let cx = textLeft;
      for (const wd of words) {
        drawRun(wd, cx, baselineLocalY);
        cx += safeWidth(font, wd, size) + gap;
      }
    } else {
      drawRun(line.text, lx, baselineLocalY);
    }
    const deco = el.textDecoration || 'none';
    if (deco.includes('underline') || deco.includes('line-through')) {
      const effW = el.align === 'justify' && !line.hard ? maxW : lw;
      const draw = (uy: number, thick: number) => {
        const s = localToPdf(el, H, lx, uy);
        const e = localToPdf(el, H, lx + effW, uy);
        page.drawLine({ start: s, end: e, thickness: thick, color, opacity });
      };
      if (deco.includes('underline')) draw(baselineLocalY + size * 0.12, Math.max(0.5, size / 16));
      if (deco.includes('line-through')) draw(baselineLocalY - size * 0.3, Math.max(0.5, size / 18));
    }
  });
};

const drawElement = async (doc: PDFDocument, page: PDFPage, el: EditorElement, fonts: FontResolver) => {
  if (el.hidden) return;
  const H = page.getSize().height;
  const rot = degrees(-(el.rotation || 0));
  const opacity = el.opacity ?? 1;
  const w = el.width * (el.scaleX || 1);
  const h = el.height * (el.scaleY || 1);

  if (el.type === 'text') return drawText(page, el, fonts);

  if (el.type === 'image') {
    try {
      const image = await embedImage(doc, el.content);
      const bl = localToPdf(el, H, 0, h);
      page.drawImage(image, { x: bl.x, y: bl.y, width: w, height: h, rotate: rot, opacity });
    } catch (e) {
      console.error('Failed to embed image', e);
    }
    return;
  }
  if (el.type === 'rect') {
    const fill = parseColor(el.fill);
    const stroke = parseColor(el.stroke);
    const bw = stroke ? el.strokeWidth || 1 : 0;
    if (el.cornerRadius && el.cornerRadius > 0) {
      const tl = localToPdf(el, H, 0, 0);
      page.drawSvgPath(roundedRectPath(w, h, el.cornerRadius), { x: tl.x, y: tl.y, color: fill, borderColor: stroke, borderWidth: bw, rotate: rot, opacity, borderOpacity: opacity });
    } else {
      const bl = localToPdf(el, H, 0, h);
      page.drawRectangle({ x: bl.x, y: bl.y, width: w, height: h, color: fill, borderColor: stroke, borderWidth: bw, rotate: rot, opacity, borderOpacity: opacity });
    }
    return;
  }
  if (el.type === 'circle') {
    const c = localToPdf(el, H, w / 2, h / 2);
    page.drawEllipse({ x: c.x, y: c.y, xScale: w / 2, yScale: h / 2, color: parseColor(el.fill), borderColor: parseColor(el.stroke), borderWidth: parseColor(el.stroke) ? el.strokeWidth || 1 : 0, rotate: rot, opacity, borderOpacity: opacity });
    return;
  }
  if (el.type === 'line' || el.type === 'arrow') {
    const pts = el.points && el.points.length >= 4 ? el.points : [0, 0, el.width, 0];
    const color = parseColor(el.stroke) || rgb(0, 0, 0);
    const thickness = el.strokeWidth || 2;
    const sx = el.scaleX || 1;
    const sy = el.scaleY || 1;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      page.drawLine({ start: localToPdf(el, H, pts[i] * sx, pts[i + 1] * sy), end: localToPdf(el, H, pts[i + 2] * sx, pts[i + 3] * sy), thickness, color, opacity });
    }
    if (el.type === 'arrow') {
      const n = pts.length;
      const x1 = pts[n - 4] * sx;
      const y1 = pts[n - 3] * sy;
      const x2 = pts[n - 2] * sx;
      const y2 = pts[n - 1] * sy;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const len = Math.max(8, thickness * 4);
      const wing = Math.PI / 7;
      const p1 = localToWorld(el, x2 - len * Math.cos(ang - wing), y2 - len * Math.sin(ang - wing));
      const p2 = localToWorld(el, x2 - len * Math.cos(ang + wing), y2 - len * Math.sin(ang + wing));
      const tip = localToWorld(el, x2, y2);
      page.drawSvgPath(`M ${tip.x} ${tip.y} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y} Z`, { x: 0, y: H, color, opacity });
    }
    return;
  }
  if (el.type === 'path' || el.type === 'checkmark') {
    const data = el.type === 'checkmark' ? 'M4 12 l5 5 L20 6' : el.content;
    if (!data) return;
    const tl = localToPdf(el, H, 0, 0);
    const stroke = parseColor(el.stroke);
    page.drawSvgPath(data, { x: tl.x, y: tl.y, scale: el.scaleX || 1, color: parseColor(el.fill), borderColor: stroke, borderWidth: stroke ? el.strokeWidth || 1 : 0, rotate: rot, opacity, borderOpacity: opacity });
  }
};

/**
 * Exports the document.
 * `originalBytes` is the base PDF whose pages are copied (for imported PDFs this is the vector-only
 * copy produced by PDFium after stripping text/images, so edited content never overlaps the original).
 */
export const savePdf = async (originalBytes: ArrayBuffer | Uint8Array | null, pages: EditorPage[]): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  doc.setProducer('Opta Files');
  doc.setCreator('Opta Files');
  let original: PDFDocument | null = null;
  if (originalBytes) {
    try {
      original = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    } catch (e) {
      console.warn('Base PDF could not be loaded, exporting flattened pages', e);
    }
  }
  const fonts = new FontResolver(doc);

  for (const editorPage of pages) {
    let page: PDFPage;
    if (original && typeof editorPage.originalPageIndex === 'number' && editorPage.originalPageIndex < original.getPageCount()) {
      const [copied] = await doc.copyPages(original, [editorPage.originalPageIndex]);
      page = doc.addPage(copied);
      if (editorPage.backgroundColor && editorPage.backgroundColor !== '#ffffff' && editorPage.backgroundColor !== 'transparent') {
        // user changed the background of an imported page: paint behind is impossible, so skip
      }
    } else {
      page = doc.addPage([editorPage.width, editorPage.height]);
      if (editorPage.imageUrl) {
        try {
          const img = await embedImage(doc, editorPage.imageUrl);
          page.drawImage(img, { x: 0, y: 0, width: editorPage.width, height: editorPage.height });
        } catch {
          // ignore
        }
      } else if (editorPage.backgroundColor && editorPage.backgroundColor !== 'transparent') {
        page.drawRectangle({ x: 0, y: 0, width: editorPage.width, height: editorPage.height, color: parseColor(editorPage.backgroundColor) || rgb(1, 1, 1) });
      }
    }
    for (const el of editorPage.elements) await drawElement(doc, page, el, fonts);
  }
  return doc.save();
};
