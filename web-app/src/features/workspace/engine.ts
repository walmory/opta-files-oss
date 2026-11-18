/**
 * Opta Files Studio — document model.
 *
 * The workspace never mutates PDF bytes while the user edits. Instead it keeps a
 * *virtual page list* (which source page goes where, with which rotation) and only
 * materialises a real PDF (pdf-lib) when a tool runs, the user exports, or saves.
 * That makes rotate / delete / reorder / duplicate instant and undo/redo trivial.
 */
import { PDFDocument, degrees } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFLib } from '../../utils/pdfWorker';

export const BLANK_SRC = '__blank__';

export interface VirtualPage {
  /** stable identity for React keys / dnd */
  key: string;
  /** source id (or BLANK_SRC) */
  src: string;
  /** zero-based page index in the source */
  index: number;
  /** extra rotation applied by the user, degrees (0/90/180/270) */
  rotation: number;
  /** split marker: a new output file starts *after* this page */
  breakAfter?: boolean;
}

export interface Source {
  id: string;
  file: File;
  bytes: ArrayBuffer;
  pageCount: number;
  /** page sizes in PDF points, for aspect-ratio placeholders */
  sizes: { width: number; height: number }[];
  pdfjs?: Promise<PDFDocumentProxy>;
  pdflib?: Promise<PDFDocument>;
}

const sources = new Map<string, Source>();
let keySeq = 0;
export const nextKey = () => `p${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export const getSource = (id: string) => sources.get(id);

const openPdfjs = (src: Source) => {
  if (!src.pdfjs) src.pdfjs = PDFLib.getDocument({ data: src.bytes.slice(0) }).promise;
  return src.pdfjs;
};

const openPdflib = (src: Source) => {
  if (!src.pdflib) src.pdflib = PDFDocument.load(src.bytes, { ignoreEncryption: true, updateMetadata: false });
  return src.pdflib;
};

/** Registers a PDF file as a source and returns its virtual pages. */
export const registerSource = async (file: File): Promise<{ source: Source; pages: VirtualPage[] }> => {
  const bytes = await file.arrayBuffer();
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const partial: Source = { id, file, bytes, pageCount: 0, sizes: [] };
  const doc = await openPdfjs(partial);
  partial.pageCount = doc.numPages;
  const sizes: Source['sizes'] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    sizes.push({ width: vp.width, height: vp.height });
  }
  partial.sizes = sizes;
  sources.set(id, partial);
  const pages: VirtualPage[] = Array.from({ length: doc.numPages }, (_, index) => ({ key: nextKey(), src: id, index, rotation: 0 }));
  return { source: partial, pages };
};

export const releaseSource = (id: string) => {
  const s = sources.get(id);
  if (!s) return;
  void s.pdfjs?.then((d) => d.destroy()).catch(() => undefined);
  sources.delete(id);
  for (const k of Array.from(thumbCache.keys())) if (k.startsWith(`${id}:`)) thumbCache.delete(k);
};

// ---------------------------------------------------------------- rendering

const thumbCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
let running = 0;
const queue: (() => void)[] = [];
const MAX_PARALLEL = 3;

const schedule = <T,>(fn: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const go = () => {
      running++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          running--;
          queue.shift()?.();
        });
    };
    if (running < MAX_PARALLEL) go();
    else queue.push(go);
  });

/** Renders a page to a JPEG data URL. Cached per (source, page, width). */
export const renderThumb = (srcId: string, index: number, width = 220): Promise<string> => {
  if (srcId === BLANK_SRC) return Promise.resolve('');
  const key = `${srcId}:${index}:${width}`;
  const hit = thumbCache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const src = sources.get(srcId);
  if (!src) return Promise.resolve('');
  const job = schedule(async () => {
    const doc = await openPdfjs(src);
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    const url = canvas.toDataURL('image/jpeg', 0.82);
    thumbCache.set(key, url);
    return url;
  }).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
};

/** Renders a page at an arbitrary scale into the given canvas (viewer). */
export const renderPageToCanvas = async (srcId: string, index: number, scale: number, rotation: number, canvas: HTMLCanvasElement) => {
  const src = sources.get(srcId);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (!src) {
    const w = Math.round(595.28 * scale);
    const h = Math.round(841.89 * scale);
    canvas.width = rotation % 180 ? h : w;
    canvas.height = rotation % 180 ? w : h;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const doc = await openPdfjs(src);
  const page = await doc.getPage(index + 1);
  const vp = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
};

// ---------------------------------------------------------------- materialise

const A4: [number, number] = [595.28, 841.89];

/** Builds a real PDF from a virtual page list. */
export const materialize = async (pages: VirtualPage[], fileName: string): Promise<File> => {
  const out = await PDFDocument.create();
  out.setProducer('Opta Files');
  out.setCreator('Opta Files Studio');
  for (const vp of pages) {
    if (vp.src === BLANK_SRC) {
      const p = out.addPage(A4);
      if (vp.rotation) p.setRotation(degrees(vp.rotation));
      continue;
    }
    const src = sources.get(vp.src);
    if (!src) continue;
    const doc = await openPdflib(src);
    const [copied] = await out.copyPages(doc, [vp.index]);
    if (vp.rotation) copied.setRotation(degrees((copied.getRotation().angle + vp.rotation) % 360));
    out.addPage(copied);
  }
  const bytes = await out.save({ useObjectStreams: true });
  return new File([new Uint8Array(bytes) as BlobPart], fileName, { type: 'application/pdf' });
};

/** Splits pages at `breakAfter` markers into groups (never returns empty groups). */
export const splitGroups = (pages: VirtualPage[]): VirtualPage[][] => {
  const groups: VirtualPage[][] = [[]];
  pages.forEach((p, i) => {
    groups[groups.length - 1].push(p);
    if (p.breakAfter && i < pages.length - 1) groups.push([]);
  });
  return groups.filter((g) => g.length);
};

export const pageSize = (p: VirtualPage) => {
  const s = p.src === BLANK_SRC ? undefined : sources.get(p.src)?.sizes[p.index];
  const w = s?.width ?? A4[0];
  const h = s?.height ?? A4[1];
  return p.rotation % 180 ? { width: h, height: w } : { width: w, height: h };
};

export const ensurePdfName = (name: string) => (/\.pdf$/i.test(name) ? name : `${name.replace(/\.[^.]+$/, '')}.pdf`);
