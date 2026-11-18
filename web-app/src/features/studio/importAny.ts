import { PDFDocument } from 'pdf-lib';
import { apiFetch } from '../../config/env';

export const isPdfFile = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
export const isImageFile = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|svg)$/i.test(f.name);

const OFFICE = /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|md|html?|csv|epub)$/i;
export const isConvertible = (f: File) => OFFICE.test(f.name);

const rasterize = (file: File): Promise<{ bytes: Uint8Array; width: number; height: number; kind: 'png' | 'jpg' }> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      try {
        const isJpeg = /jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name);
        if (isJpeg || file.type === 'image/png') {
          resolve({ bytes: new Uint8Array(await file.arrayBuffer()), width: img.naturalWidth, height: img.naturalHeight, kind: isJpeg ? 'jpg' : 'png' });
          return;
        }
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d')?.drawImage(img, 0, 0);
        const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/png'));
        if (!blob) throw new Error('canvas');
        resolve({ bytes: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height, kind: 'png' });
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Imagem inválida'));
    };
    img.src = url;
  });

/** Images → one A4-fitted page per image, built locally with pdf-lib (no server needed). */
export const imagesToPdf = async (files: File[]): Promise<File> => {
  const pdf = await PDFDocument.create();
  for (const f of files) {
    const { bytes, width, height, kind } = await rasterize(f);
    const img = kind === 'jpg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    const landscape = width > height;
    const pw = landscape ? 841.89 : 595.28;
    const ph = landscape ? 595.28 : 841.89;
    const page = pdf.addPage([pw, ph]);
    const margin = 36;
    const scale = Math.min((pw - margin * 2) / width, (ph - margin * 2) / height);
    const w = width * scale;
    const h = height * scale;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  const out = await pdf.save();
  const name = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') + '.pdf' : `imagens-${files.length}.pdf`;
  return new File([out as BlobPart], name, { type: 'application/pdf' });
};

/** Office/text documents → PDF via the Opta engine. Throws when the service is offline. */
export const officeToPdf = async (file: File): Promise<File> => {
  const form = new FormData();
  form.append('fileInput', file, file.name);
  const res = await apiFetch('/pdf/api/v1/convert/file/pdf', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Não foi possível converter ${file.name.split('.').pop()?.toUpperCase()} agora. Tente novamente em instantes.`);
  const blob = await res.blob();
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.pdf', { type: 'application/pdf' });
};

/** Normalises anything the user drops into a single PDF file ready for `loadPdf`. */
export const anyToPdf = async (files: File[]): Promise<{ pdf: File; note?: string }> => {
  const pdfs = files.filter(isPdfFile);
  if (pdfs.length === 1) return { pdf: pdfs[0] };
  if (pdfs.length > 1) {
    const merged = await PDFDocument.create();
    for (const f of pdfs) {
      const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
    return { pdf: new File([(await merged.save()) as BlobPart], `mesclado-${pdfs.length}.pdf`, { type: 'application/pdf' }), note: `${pdfs.length} PDFs mesclados` };
  }
  const images = files.filter(isImageFile);
  if (images.length) return { pdf: await imagesToPdf(images), note: `${images.length} imagem(ns) convertida(s) em página(s)` };
  const office = files.find(isConvertible);
  if (office) return { pdf: await officeToPdf(office), note: `${office.name} convertido para PDF` };
  throw new Error('Formato não suportado. Solte PDF, imagens (JPG/PNG/WEBP) ou documentos Office.');
};
