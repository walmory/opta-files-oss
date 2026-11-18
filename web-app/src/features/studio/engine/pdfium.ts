/**
 * PDFium (WASM, MIT) engine wrapper — the same core used by iLovePDF/Sejda-class editors.
 * Responsibilities:
 *  - open documents from bytes
 *  - extract page objects (text runs with font/size/color/matrix, images as bitmaps)
 *  - strip text/image objects and save a "vector-only" copy (what stays behind the editable layer)
 *  - render pages (or stripped pages) to raster
 */
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';

export type Pdfium = WrappedPdfiumModule;

let instance: Promise<Pdfium> | null = null;

export const getPdfium = (): Promise<Pdfium> => {
  if (!instance) {
    instance = (async () => {
      const res = await fetch(wasmUrl);
      if (!res.ok) throw new Error('Falha ao baixar o motor PDFium (pdfium.wasm)');
      const wasmBinary = await res.arrayBuffer();
      const m = await init({ wasmBinary });
      m.PDFiumExt_Init();
      return m;
    })().catch((e) => {
      instance = null;
      throw e;
    });
  }
  return instance;
};

/* ------------------------------------------------------------------ memory helpers */
const mem = (m: Pdfium) => {
  const rt = m.pdfium as unknown as { HEAPU8: Uint8Array; HEAPF32: Float32Array; HEAPU32: Uint32Array; HEAP32: Int32Array; wasmExports: { malloc: (n: number) => number; free: (p: number) => void }; UTF16ToString: (p: number) => string; UTF8ToString: (p: number) => string; stringToUTF16: (s: string, p: number, max: number) => void; stringToUTF8: (s: string, p: number, max: number) => void };
  return {
    malloc: (n: number) => rt.wasmExports.malloc(Math.max(1, n)),
    free: (p: number) => rt.wasmExports.free(p),
    u8: () => rt.HEAPU8,
    f32: () => rt.HEAPF32,
    u32: () => rt.HEAPU32,
    i32: () => rt.HEAP32,
    utf16: (p: number) => rt.UTF16ToString(p),
    utf8: (p: number) => rt.UTF8ToString(p),
    writeUtf16: (s: string) => {
      const size = (s.length + 1) * 2;
      const p = rt.wasmExports.malloc(size);
      rt.stringToUTF16(s, p, size);
      return p;
    },
    writeUtf8: (s: string) => {
      const size = s.length * 4 + 1;
      const p = rt.wasmExports.malloc(size);
      rt.stringToUTF8(s, p, size);
      return p;
    }
  };
};

export interface PdfDocHandle {
  doc: number;
  filePtr: number;
  pageCount: number;
  close: () => void;
}

export const openDocument = async (bytes: Uint8Array): Promise<PdfDocHandle> => {
  const m = await getPdfium();
  const M = mem(m);
  const filePtr = M.malloc(bytes.length);
  M.u8().set(bytes, filePtr);
  const doc = m.FPDF_LoadMemDocument(filePtr, bytes.length, '');
  if (!doc) {
    const err = m.FPDF_GetLastError();
    M.free(filePtr);
    throw new Error(err === 4 ? 'PDF protegido por senha' : `Falha ao abrir PDF (erro ${err})`);
  }
  return { doc, filePtr, pageCount: m.FPDF_GetPageCount(doc), close: () => { m.FPDF_CloseDocument(doc); M.free(filePtr); } };
};

/* ------------------------------------------------------------------ extraction */
export interface ExtractedText {
  text: string;
  /** PDF user-space coords (y up) */
  left: number;
  right: number;
  top: number;
  bottom: number;
  baseline: number; // y of text origin
  originX: number;
  fontSize: number; // effective (matrix applied)
  rotation: number; // degrees, clockwise on screen
  /** extent of the run measured along its own baseline / perpendicular (page units) — unlike left/right/top/bottom, not inflated by rotation */
  runWidth: number;
  runHeight: number;
  fontName: string; // base font name (subset prefix removed)
  family: string;
  bold: boolean;
  italic: boolean;
  weight: number;
  serif: boolean;
  mono: boolean;
  color: string; // #rrggbb
  alpha: number;
  embedded: boolean;
  fontKey: string; // stable key for embedded font data
  /** paint order inside the page */
  order: number;
}

export interface ExtractedPath {
  /** SVG path data, relative to the element's top-left corner, y down */
  d: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  fill?: string;
  stroke?: string;
  strokeWidth: number;
  opacity: number;
  /** paint order inside the page */
  order: number;
}

export interface ExtractedImage {
  dataUrl: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number; // px of bitmap
  height: number;
  /** paint order inside the page */
  order: number;
}

export interface ExtractedPage {
  index: number;
  width: number;
  height: number;
  texts: ExtractedText[];
  images: ExtractedImage[];
  paths: ExtractedPath[];
  /** count of objects that could NOT be turned into elements (shadings, unknown types) */
  vectors: number;
  fonts: Record<string, { name: string; data?: Uint8Array }>;
}

const OBJ_TEXT = 1;
const OBJ_PATH = 2;
const OBJ_IMAGE = 3;

/* path segment kinds (public/fpdf_edit.h) */
const SEG_LINETO = 0;
const SEG_BEZIERTO = 1;
const SEG_MOVETO = 2;
/* FPDFPath_GetDrawMode fill modes */
const FILL_NONE = 0;
/** Form XObject: a reusable group of objects (watermarks, headers, stamps are usually drawn this way) */
const OBJ_FORM = 5;

/** PDF matrix [a b c d e f] (row-vector convention: p' = p × M) */
type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
/** m1 then m2 */
const mul = (m1: Mat, m2: Mat): Mat => [
  m1[0] * m2[0] + m1[1] * m2[2],
  m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2],
  m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
  m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
];
const apply = (m: Mat, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
interface Box { left: number; bottom: number; right: number; top: number }
const corners = (b: Box, m: Mat) => [apply(m, b.left, b.bottom), apply(m, b.right, b.bottom), apply(m, b.right, b.top), apply(m, b.left, b.top)];
const aabb = (pts: { x: number; y: number }[]): Box => ({ left: Math.min(...pts.map((p) => p.x)), right: Math.max(...pts.map((p) => p.x)), bottom: Math.min(...pts.map((p) => p.y)), top: Math.max(...pts.map((p) => p.y)) });
/** extent of a point cloud along a unit direction */
const extentAlong = (pts: { x: number; y: number }[], ux: number, uy: number) => {
  const d = pts.map((p) => p.x * ux + p.y * uy);
  return Math.max(...d) - Math.min(...d);
};

const cleanFontName = (n: string) => n.replace(/^[A-Z]{6}\+/, '').trim();

const bitmapToDataUrl = (m: Pdfium, bmp: number, preferJpeg = false): { dataUrl: string; width: number; height: number } => {
  const M = mem(m);
  const w = m.FPDFBitmap_GetWidth(bmp);
  const h = m.FPDFBitmap_GetHeight(bmp);
  const stride = m.FPDFBitmap_GetStride(bmp);
  const format = m.FPDFBitmap_GetFormat(bmp); // 1 gray, 2 BGR, 3 BGRx, 4 BGRA
  const buf = m.FPDFBitmap_GetBuffer(bmp);
  const src = M.u8().subarray(buf, buf + stride * h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const out = img.data;
  let hasAlpha = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (format === 1) {
        const v = src[y * stride + x];
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = 255;
      } else if (format === 2) {
        const i = y * stride + x * 3;
        out[o] = src[i + 2];
        out[o + 1] = src[i + 1];
        out[o + 2] = src[i];
        out[o + 3] = 255;
      } else {
        const i = y * stride + x * 4;
        out[o] = src[i + 2];
        out[o + 1] = src[i + 1];
        out[o + 2] = src[i];
        const a = format === 4 ? src[i + 3] : 255;
        out[o + 3] = a;
        if (a < 255) hasAlpha = true;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const dataUrl = preferJpeg && !hasAlpha ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
  return { dataUrl, width: w, height: h };
};

export const extractPage = async (h: PdfDocHandle, pageIndex: number): Promise<ExtractedPage> => {
  const m = await getPdfium();
  const M = mem(m);
  const page = m.FPDF_LoadPage(h.doc, pageIndex);
  if (!page) throw new Error(`Falha ao carregar página ${pageIndex + 1}`);
  const textPage = m.FPDFText_LoadPage(page);
  const width = m.FPDF_GetPageWidthF(page);
  const height = m.FPDF_GetPageHeightF(page);
  const texts: ExtractedText[] = [];
  const images: ExtractedImage[] = [];
  const paths: ExtractedPath[] = [];
  const fonts: ExtractedPage['fonts'] = {};
  let vectors = 0;
  let order = 0;

  const fptr = M.malloc(4 * 6); // scratch floats
  const uptr = M.malloc(4 * 4); // scratch uint32
  /**
   * Walk a page-object holder (the page itself or a Form XObject). Objects inside a form are expressed in the
   * form's own space; `parent` maps that space onto the page (composed for nested forms).
   */
  const walk = (count: number, get: (i: number) => number, parent: Mat) => {
    for (let i = 0; i < count; i++) {
      const obj = get(i);
      const type = m.FPDFPageObj_GetType(obj);
      if (type === OBJ_FORM) {
        m.FPDFPageObj_GetMatrix(obj, fptr);
        const fm = M.f32();
        const formMatrix: Mat = [fm[fptr / 4], fm[fptr / 4 + 1], fm[fptr / 4 + 2], fm[fptr / 4 + 3], fm[fptr / 4 + 4], fm[fptr / 4 + 5]];
        walk(m.FPDFFormObj_CountObjects(obj), (k) => m.FPDFFormObj_GetObject(obj, k), mul(formMatrix, parent));
        continue;
      }
      if (!m.FPDFPageObj_GetBounds(obj, fptr, fptr + 4, fptr + 8, fptr + 12)) continue;
      const f = M.f32();
      const local: Box = { left: f[fptr / 4], bottom: f[fptr / 4 + 1], right: f[fptr / 4 + 2], top: f[fptr / 4 + 3] };
      const pts = corners(local, parent);
      const b = aabb(pts);

      if (type === OBJ_TEXT) {
        const needed = m.FPDFTextObj_GetText(obj, textPage, 0, 0);
        let text = '';
        if (needed > 0) {
          const tp = M.malloc(needed + 2);
          m.FPDFTextObj_GetText(obj, textPage, tp, needed + 2);
          text = M.utf16(tp);
          M.free(tp);
        }
        if (!text.trim()) continue;
        m.FPDFTextObj_GetFontSize(obj, fptr);
        const rawSize = M.f32()[fptr / 4];
        m.FPDFPageObj_GetMatrix(obj, fptr);
        const mf = M.f32();
        const [a, bm, c, d, e, fy] = mul([mf[fptr / 4], mf[fptr / 4 + 1], mf[fptr / 4 + 2], mf[fptr / 4 + 3], mf[fptr / 4 + 4], mf[fptr / 4 + 5]], parent);
        const scaleY = Math.hypot(c, d) || 1;
        const rotation = -(Math.atan2(bm, a) * 180) / Math.PI; // PDF y-up → screen clockwise
        const fontSize = rawSize * scaleY;
        const baseLen = Math.hypot(a, bm) || 1;
        const runWidth = extentAlong(pts, a / baseLen, bm / baseLen);
        const runHeight = extentAlong(pts, -bm / baseLen, a / baseLen);

        const font = m.FPDFTextObj_GetFont(obj);
        let fontName = '';
        let family = '';
        let weight = 400;
        let flags = 0;
        let italicAngle = 0;
        let embedded = false;
        let fontKey = '';
        if (font) {
          const nl = m.FPDFFont_GetBaseFontName(font, 0, 0);
          if (nl > 0) {
            const np = M.malloc(nl + 1);
            m.FPDFFont_GetBaseFontName(font, np, nl + 1);
            fontName = cleanFontName(M.utf8(np));
            M.free(np);
          }
          try {
            const fl = m.FPDFFont_GetFamilyName(font, 0, 0);
            if (fl > 0) {
              const fp = M.malloc(fl + 1);
              m.FPDFFont_GetFamilyName(font, fp, fl + 1);
              family = M.utf8(fp);
              M.free(fp);
            }
          } catch {
            // older builds
          }
          weight = m.FPDFFont_GetWeight(font) || 400;
          flags = m.FPDFFont_GetFlags(font) || 0;
          if (m.FPDFFont_GetItalicAngle(font, uptr)) italicAngle = M.i32()[uptr / 4];
          embedded = Boolean(m.FPDFFont_GetIsEmbedded(font));
          fontKey = `${fontName}|${weight}|${flags}`;
          if (embedded && !fonts[fontKey]) {
            // font program bytes (TrueType/OpenType only are usable in the browser)
            m.FPDFFont_GetFontData(font, 0, 0, uptr);
            const size = M.u32()[uptr / 4];
            if (size > 0 && size < 8 * 1024 * 1024) {
              const dp = M.malloc(size);
              if (m.FPDFFont_GetFontData(font, dp, size, uptr)) {
                const data = M.u8().slice(dp, dp + size);
                const tag = String.fromCharCode(...data.subarray(0, 4));
                const isSfnt = tag === 'OTTO' || tag === 'true' || (data[0] === 0 && data[1] === 1 && data[2] === 0 && data[3] === 0);
                fonts[fontKey] = { name: fontName, data: isSfnt ? data : undefined };
              }
              M.free(dp);
            } else fonts[fontKey] = { name: fontName };
          }
        }
        const nameLower = `${fontName} ${family}`.toLowerCase();
        const bold = weight >= 600 || /bold|black|heavy|semibold|demibold|extrabold/.test(nameLower) || Boolean(flags & (1 << 18));
        const italic = italicAngle !== 0 || /italic|oblique/.test(nameLower) || Boolean(flags & (1 << 6));
        const serif = Boolean(flags & (1 << 1)) || /times|serif|georgia|garamond|cambria|book|roman|minion|palatino/.test(nameLower);
        const mono = Boolean(flags & 1) || /courier|mono|consolas|menlo/.test(nameLower);

        const renderMode = m.FPDFTextObj_GetTextRenderMode(obj);
        if (renderMode === 3 || renderMode === 7) continue; // invisible (OCR layers)
        let r = 0;
        let g = 0;
        let bl = 0;
        let al = 255;
        const ok = renderMode === 1 || renderMode === 5 ? m.FPDFPageObj_GetStrokeColor(obj, uptr, uptr + 4, uptr + 8, uptr + 12) : m.FPDFPageObj_GetFillColor(obj, uptr, uptr + 4, uptr + 8, uptr + 12);
        if (ok) {
          const u = M.u32();
          r = u[uptr / 4];
          g = u[uptr / 4 + 1];
          bl = u[uptr / 4 + 2];
          al = u[uptr / 4 + 3];
        }
        const hex = `#${[r, g, bl].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
        texts.push({ text, left: b.left, right: b.right, top: b.top, bottom: b.bottom, baseline: fy, originX: e, fontSize, rotation, runWidth, runHeight, fontName, family: family || fontName, bold, italic, weight, serif, mono, color: hex, alpha: al / 255, embedded, fontKey, order: order++ });
      } else if (type === OBJ_PATH) {
        // Vector artwork (rules, table borders, logos, coloured bars). PDFium hands us the raw
        // segments in the path's own space, so the object matrix has to be applied here — unlike
        // GetBounds above, which already reports page-space coordinates.
        const segCount = m.FPDFPath_CountSegments(obj);
        if (segCount <= 0) {
          vectors += 1;
          continue;
        }
        let fillMode = FILL_NONE;
        let stroked = false;
        if (m.FPDFPath_GetDrawMode(obj, uptr, uptr + 4)) {
          const iv = M.i32();
          fillMode = iv[uptr / 4];
          stroked = iv[uptr / 4 + 1] !== 0;
        }
        if (fillMode === FILL_NONE && !stroked) continue; // clip-only path: nothing is painted

        m.FPDFPageObj_GetMatrix(obj, fptr);
        const pf = M.f32();
        const own: Mat = [pf[fptr / 4], pf[fptr / 4 + 1], pf[fptr / 4 + 2], pf[fptr / 4 + 3], pf[fptr / 4 + 4], pf[fptr / 4 + 5]];
        const full = mul(own, parent);

        const r2 = (n: number) => Math.round(n * 100) / 100;
        let d = '';
        let bez: string[] = [];
        for (let sIdx = 0; sIdx < segCount; sIdx++) {
          const seg = m.FPDFPath_GetPathSegment(obj, sIdx);
          if (!seg) continue;
          const segType = m.FPDFPathSegment_GetType(seg);
          if (!m.FPDFPathSegment_GetPoint(seg, fptr, fptr + 4)) continue;
          const sf = M.f32();
          const wp = apply(full, sf[fptr / 4], sf[fptr / 4 + 1]);
          // relative to the element box, y flipped to screen orientation
          const x = r2(wp.x - b.left);
          const y = r2(b.top - wp.y);
          if (segType === SEG_MOVETO) {
            bez = [];
            d += `M ${x} ${y} `;
          } else if (segType === SEG_LINETO) {
            bez = [];
            d += `L ${x} ${y} `;
          } else if (segType === SEG_BEZIERTO) {
            bez.push(`${x} ${y}`);
            if (bez.length === 3) {
              d += `C ${bez.join(' ')} `;
              bez = [];
            }
          }
          if (m.FPDFPathSegment_GetClose(seg)) d += 'Z ';
        }
        if (!d.trim()) {
          vectors += 1;
          continue;
        }

        const readColor = (ok: boolean) => {
          if (!ok) return null;
          const u = M.u32();
          const [cr, cg, cb, ca] = [u[uptr / 4], u[uptr / 4 + 1], u[uptr / 4 + 2], u[uptr / 4 + 3]];
          return { hex: `#${[cr, cg, cb].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`, alpha: ca / 255 };
        };
        const fillC = fillMode !== FILL_NONE ? readColor(Boolean(m.FPDFPageObj_GetFillColor(obj, uptr, uptr + 4, uptr + 8, uptr + 12))) : null;
        const strokeC = stroked ? readColor(Boolean(m.FPDFPageObj_GetStrokeColor(obj, uptr, uptr + 4, uptr + 8, uptr + 12))) : null;
        if (!fillC && !strokeC) continue;
        // a fully transparent paint draws nothing
        if ((fillC?.alpha ?? 0) === 0 && (strokeC?.alpha ?? 0) === 0) continue;

        let sw = 1;
        if (m.FPDFPageObj_GetStrokeWidth(obj, fptr)) sw = M.f32()[fptr / 4];
        const scale = Math.sqrt(Math.abs(full[0] * full[3] - full[1] * full[2])) || 1;

        paths.push({
          d: d.trim(),
          left: b.left,
          right: b.right,
          top: b.top,
          bottom: b.bottom,
          fill: fillC?.hex,
          stroke: strokeC?.hex,
          strokeWidth: Math.max(0.1, r2(sw * scale)),
          opacity: Math.max(fillC?.alpha ?? 0, strokeC?.alpha ?? 0),
          order: order++
        });
      } else if (type === OBJ_IMAGE) {
        const bw = b.right - b.left;
        const bh = b.top - b.bottom;
        if (bw < 1 || bh < 1) continue;
        try {
          const bmp = m.FPDFImageObj_GetRenderedBitmap(h.doc, page, obj);
          if (bmp) {
            const px = bitmapToDataUrl(m, bmp, bw * bh > 40000);
            m.FPDFBitmap_Destroy(bmp);
            images.push({ dataUrl: px.dataUrl, left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: px.width, height: px.height, order: order++ });
          }
        } catch (e) {
          console.warn('image extraction failed', e);
        }
      } else {
        vectors += 1;
      }
    }
  };

  try {
    walk(m.FPDFPage_CountObjects(page), (i) => m.FPDFPage_GetObject(page, i), IDENTITY);
  } finally {
    M.free(fptr);
    M.free(uptr);
    m.FPDFText_ClosePage(textPage);
    m.FPDF_ClosePage(page);
  }
  return { index: pageIndex, width, height, texts, images, paths, vectors, fonts };
};

/* ------------------------------------------------------------------ strip + save */
/**
 * Removes text and/or image objects from every page (in place) and returns the saved bytes.
 * Pass the handle of a document opened specifically for this purpose (it is mutated).
 */
export const stripAndSave = async (h: PdfDocHandle, opts: { text?: boolean; images?: boolean; paths?: boolean } = { text: true, images: true }): Promise<Uint8Array> => {
  const m = await getPdfium();
  const M = mem(m);
  for (let p = 0; p < h.pageCount; p++) {
    const page = m.FPDF_LoadPage(h.doc, p);
    if (!page) continue;
    // Recurse into Form XObjects too (watermarks/stamps live there); PDFium regenerates the form streams
    // together with the page content on FPDFPage_GenerateContent.
    const strip = (count: number, get: (i: number) => number, remove: (obj: number) => boolean) => {
      for (let i = count - 1; i >= 0; i--) {
        const obj = get(i);
        const type = m.FPDFPageObj_GetType(obj);
        if ((type === OBJ_TEXT && opts.text) || (type === OBJ_IMAGE && opts.images) || (type === OBJ_PATH && opts.paths)) {
          if (remove(obj)) m.FPDFPageObj_Destroy(obj);
        } else if (type === OBJ_FORM) {
          strip(m.FPDFFormObj_CountObjects(obj), (k) => m.FPDFFormObj_GetObject(obj, k), (o) => m.FPDFFormObj_RemoveObject(obj, o));
        }
      }
    };
    strip(m.FPDFPage_CountObjects(page), (i) => m.FPDFPage_GetObject(page, i), (o) => m.FPDFPage_RemoveObject(page, o));
    m.FPDFPage_GenerateContent(page);
    m.FPDF_ClosePage(page);
  }
  const writer = m.PDFiumExt_OpenFileWriter();
  try {
    m.PDFiumExt_SaveAsCopy(h.doc, writer);
    const size = m.PDFiumExt_GetFileWriterSize(writer);
    const buf = M.malloc(size);
    m.PDFiumExt_GetFileWriterData(writer, buf, size);
    const out = M.u8().slice(buf, buf + size);
    M.free(buf);
    return out;
  } finally {
    m.PDFiumExt_CloseFileWriter(writer);
  }
};

/* ------------------------------------------------------------------ render */
export const renderPage = async (h: PdfDocHandle, pageIndex: number, scale = 2, opts?: { jpeg?: boolean }): Promise<{ dataUrl: string; width: number; height: number }> => {
  const m = await getPdfium();
  const page = m.FPDF_LoadPage(h.doc, pageIndex);
  if (!page) throw new Error('Falha ao renderizar página');
  try {
    const w = Math.ceil(m.FPDF_GetPageWidthF(page) * scale);
    const hh = Math.ceil(m.FPDF_GetPageHeightF(page) * scale);
    const bmp = m.FPDFBitmap_CreateEx(w, hh, 4, 0, 0);
    m.FPDFBitmap_FillRect(bmp, 0, 0, w, hh, 0xffffffff);
    m.FPDF_RenderPageBitmap(bmp, page, 0, 0, w, hh, 0, 0x01 /* FPDF_ANNOT */);
    const out = bitmapToDataUrl(m, bmp, opts?.jpeg ?? true);
    m.FPDFBitmap_Destroy(bmp);
    return out;
  } finally {
    m.FPDF_ClosePage(page);
  }
};

/** True when a page has nothing but text/images (i.e. background can be plain white). */
export const pageIsFlat = (p: ExtractedPage) => p.vectors === 0;
