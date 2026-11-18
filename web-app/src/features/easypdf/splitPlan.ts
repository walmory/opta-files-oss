/**
 * Split plan: the shared vocabulary between the visual split editor and the local splitter.
 *
 * A plan is just the list of documents the user wants out of a single PDF, each one a page range
 * with a name. The editor produces it by clicking between pages, so what the user sees in the
 * thumbnails is literally what ends up in the ZIP — no guessing page numbers in a text field.
 */
import { PDFDocument } from 'pdf-lib';
import { PDFLib } from '../../utils/pdfWorker';
import { createZip, type ZipEntry } from './zip';

export interface SplitSegment {
  /** first page of the document, 1-based, inclusive */
  from: number;
  /** last page of the document, 1-based, inclusive */
  to: number;
  /** file name without extension; empty falls back to a sequential name */
  name?: string;
  /** unchecked segments are left out of the ZIP */
  keep?: boolean;
}

/** Filesystem-safe, reasonably short name — corta em limite de palavra para não gerar nome truncado no meio. */
export const slugName = (raw: string, max = 48) => {
  const clean = raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= max) return clean.replace(/^[-._\s]+|[-._\s]+$/g, '') || 'documento';
  const cut = clean.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.5 ? cut.slice(0, at) : cut).replace(/^[-._\s]+|[-._\s]+$/g, '') || 'documento';
};

/** "p1-4" / "p7" — sufixo que torna cada arquivo do ZIP identificável sem abrir. */
export const pageSuffix = (s: SplitSegment) => (s.from === s.to ? `p${s.from}` : `p${s.from}-${s.to}`);

/**
 * Nome final do arquivo dentro do ZIP: ordem + rótulo + faixa de páginas.
 * Ex.: `02-contrato-joao-p5-8.pdf`. A ordem mantém o ZIP na sequência do documento
 * original e a faixa evita nomes iguais e diz de onde veio cada pedaço.
 */
export const partFileName = (seg: SplitSegment, index: number, total: number, base: string) => {
  const seq = String(index + 1).padStart(String(Math.max(total, 1)).length, '0');
  return `${seq}-${slugName(seg.name || base)}-${pageSuffix(seg)}.pdf`;
};

/** Text of every page, in reading order, as one string per page. */
export const pageTexts = async (file: File | Blob, onProgress?: (pct: number) => void): Promise<string[]> => {
  const doc = await PDFLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      out.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
      page.cleanup();
      onProgress?.(Math.round((i / doc.numPages) * 60));
    }
  } finally {
    await doc.destroy();
  }
  return out;
};

/** Cut points (page numbers the cut happens *after*) → contiguous segments covering the document. */
export const segmentsFromCuts = (numPages: number, cuts: Iterable<number>): SplitSegment[] => {
  const sorted = [...new Set([...cuts])].filter((c) => c >= 1 && c < numPages).sort((a, b) => a - b);
  const out: SplitSegment[] = [];
  let from = 1;
  for (const c of sorted) {
    out.push({ from, to: c, keep: true });
    from = c + 1;
  }
  if (numPages > 0) out.push({ from, to: numPages, keep: true });
  return out;
};

/** Human label for a range: "p. 4" or "p. 4-9". */
export const rangeLabel = (s: SplitSegment) => (s.from === s.to ? `p. ${s.from}` : `p. ${s.from}-${s.to}`);

export interface SplitOutput {
  zip: Blob;
  parts: { name: string; pages: number[] }[];
}

/**
 * Rebuilds one PDF per kept segment and packs everything into a ZIP.
 * A single kept segment still returns a ZIP so the caller has one code path; callers that want a
 * bare PDF can check `parts.length === 1`.
 */
export const buildSplitZip = async (file: File, segments: SplitSegment[], onProgress?: (pct: number) => void): Promise<SplitOutput> => {
  const kept = segments.filter((s) => s.keep !== false && s.to >= s.from);
  if (!kept.length) throw new Error('Nenhum documento selecionado para gerar.');

  const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const total = src.getPageCount();
  const base = file.name.replace(/\.pdf$/i, '');
  const entries: ZipEntry[] = [];
  const parts: SplitOutput['parts'] = [];
  const used = new Set<string>();

  for (let i = 0; i < kept.length; i++) {
    const seg = kept[i];
    const indexes: number[] = [];
    for (let p = seg.from; p <= Math.min(seg.to, total); p++) if (p >= 1) indexes.push(p - 1);
    if (!indexes.length) continue;

    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, indexes);
    copied.forEach((p) => out.addPage(p));

    let name = partFileName(seg, i, kept.length, base);
    // two segments named the same would overwrite each other inside the archive
    for (let n = 2; used.has(name.toLowerCase()); n++) name = name.replace(/\.pdf$/i, `-${n}.pdf`);
    used.add(name.toLowerCase());

    entries.push({ name, blob: new Blob([(await out.save()) as BlobPart], { type: 'application/pdf' }) });
    parts.push({ name, pages: indexes.map((x) => x + 1) });
    onProgress?.(Math.round(((i + 1) / kept.length) * 95));
  }

  const zip = await createZip(entries);
  onProgress?.(100);
  return { zip, parts };
};

/**
 * Pages that start a new document, found by a phrase (or regex) repeated on each first page.
 * Shared by the "split by text" mode and by the visual editor's auto-detect button.
 * Returns 1-based page numbers with the matched snippet, usable as a file name.
 */
/**
 * Rótulo legível a partir do trecho casado: para na primeira quebra forte (ponto final,
 * hífen solto, dois espaços) para não arrastar o parágrafo inteiro para o nome do arquivo.
 */
const snippetLabel = (raw: string) => {
  const flat = raw.replace(/\s+/g, ' ').trim();
  const stop = flat.search(/(?:\.\s|\s[–—-]\s|\s{2,})/);
  return slugName(stop > 8 ? flat.slice(0, stop) : flat, 44);
};

export const matchTextStarts = (texts: string[], marker: string, regex?: boolean): { page: number; label: string }[] => {
  const needle = marker.trim();
  if (!needle) throw new Error('Informe o texto que marca o início de cada documento.');
  if (texts.every((t) => !t.trim())) {
    throw new Error('Este PDF não tem camada de texto (provavelmente é digitalizado). Passe-o pelo OCR antes de dividir por texto.');
  }

  let test: (text: string) => string | null;
  if (regex) {
    let re: RegExp;
    try {
      re = new RegExp(needle, 'i');
    } catch {
      throw new Error('Expressão regular inválida. Verifique a sintaxe ou desmarque a opção.');
    }
    test = (text) => text.match(re)?.[0] ?? null;
  } else {
    const lower = needle.toLowerCase();
    test = (text) => {
      const at = text.toLowerCase().indexOf(lower);
      return at < 0 ? null : text.slice(at, at + needle.length + 40);
    };
  }

  const out: { page: number; label: string }[] = [];
  texts.forEach((text, i) => {
    const m = test(text);
    if (m) out.push({ page: i + 1, label: snippetLabel(m) });
  });
  if (!out.length) throw new Error(`Nenhuma página contém “${needle}”. Confira o texto ou tente outro modo de divisão.`);
  return out;
};

/** Document starts (1-based pages) → segments. Pages before the first start join the first document. */
export const segmentsFromStarts = (numPages: number, starts: { page: number; label?: string }[]): SplitSegment[] =>
  starts.map((s, i) => ({
    from: i === 0 ? 1 : s.page,
    to: i + 1 < starts.length ? starts[i + 1].page - 1 : numPages,
    name: s.label,
    keep: true
  }));
