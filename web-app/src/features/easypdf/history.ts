/**
 * Document history persisted in IndexedDB (binary safe, far beyond localStorage limits).
 * Metadata (no blob) is mirrored to the backend JSON store when available.
 */
import { apiFetch } from '../../config/env';
import { PDFLib } from '../../utils/pdfWorker';

export interface StoredDocument {
  id: string;
  name: string;
  createdAt: number;
  size: number;
  contentType: string;
  kind: 'pdf' | 'zip' | 'image' | 'text' | 'json' | 'other';
  source: 'tool' | 'editor' | 'upload' | 'quote';
  toolId?: string;
  toolName?: string;
  thumbnail?: string;
  pages?: number;
  tags?: string[];
  clientName?: string;
}

const DB_NAME = 'optafiles_easypdf';
const STORE = 'documents';
const BLOBS = 'blobs';

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const tx = async <T,>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

export const listDocuments = async (): Promise<StoredDocument[]> => {
  try {
    const all = await tx<StoredDocument[]>(STORE, 'readonly', (s) => s.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
};

export const getDocumentBlob = (id: string) => tx<Blob | undefined>(BLOBS, 'readonly', (s) => s.get(id));

export const deleteDocument = async (id: string) => {
  await tx(STORE, 'readwrite', (s) => s.delete(id));
  await tx(BLOBS, 'readwrite', (s) => s.delete(id));
  void apiFetch(`/api/store/pdf-history/${id}`, { method: 'DELETE' }).catch(() => undefined);
};

export const renderPdfThumbnail = async (blob: Blob, width = 240): Promise<{ thumbnail?: string; pages?: number }> => {
  try {
    const data = await blob.arrayBuffer();
    const pdf = await PDFLib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = width / viewport.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { pages: pdf.numPages };
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    return { thumbnail: canvas.toDataURL('image/jpeg', 0.7), pages: pdf.numPages };
  } catch {
    return {};
  }
};

export const saveDocument = async (blob: Blob, meta: Omit<StoredDocument, 'id' | 'createdAt' | 'size' | 'thumbnail' | 'pages'> & { id?: string }): Promise<StoredDocument> => {
  const id = meta.id || `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let extra: { thumbnail?: string; pages?: number } = {};
  if (meta.kind === 'pdf') extra = await renderPdfThumbnail(blob);
  else if (meta.kind === 'image') {
    extra.thumbnail = await new Promise<string | undefined>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(undefined);
      r.readAsDataURL(blob);
    });
  }
  const doc: StoredDocument = { ...meta, id, createdAt: Date.now(), size: blob.size, ...extra };
  await tx(STORE, 'readwrite', (s) => s.put(doc));
  await tx(BLOBS, 'readwrite', (s) => s.put(blob, id));
  const { thumbnail: _t, ...remote } = doc;
  void _t;
  void apiFetch('/api/store/pdf-history', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(remote) }).catch(() => undefined);
  return doc;
};

export const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

export const humanSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`);

const RECENT_KEY = 'optafiles_pdf_recent';
export const pushRecentTool = (id: string) => {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const list = [id, ...(Array.isArray(raw) ? raw : []).filter((x: string) => x !== id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
};
