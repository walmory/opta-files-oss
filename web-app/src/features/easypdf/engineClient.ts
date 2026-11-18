import { getBackendUrl, apiFetch, authHeaders } from '../../config/env';
import type { PdfTool } from './tools';
import { requestAuth } from '../auth/api';

export interface ToolResult {
  blob: Blob;
  fileName: string;
  contentType: string;
  kind: 'pdf' | 'zip' | 'image' | 'text' | 'json' | 'other';
  json?: unknown;
  durationMs: number;
}

export interface EngineHealth {
  ok: boolean;
  message?: string;
  version?: string;
}

/** Consumer-facing copy — never leak infrastructure details to the customer. */
export const ENGINE_OFFLINE_MESSAGE = 'Serviço temporariamente indisponível. Tente novamente em instantes.';

const kindFromType = (ct: string, name: string): ToolResult['kind'] => {
  const lower = `${ct} ${name}`.toLowerCase();
  if (lower.includes('pdf')) return 'pdf';
  if (lower.includes('zip')) return 'zip';
  if (/(png|jpe?g|webp|gif|image\/)/.test(lower)) return 'image';
  if (lower.includes('json')) return 'json';
  if (/(text|csv|html|xml|markdown|rtf)/.test(lower)) return 'text';
  return 'other';
};

const fileNameFromDisposition = (header: string | null, fallback: string) => {
  if (!header) return fallback;
  const utf = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf) return decodeURIComponent(utf[1].replace(/"/g, ''));
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : fallback;
};

/** Probes the Opta processing engine through the backend. */
export const checkEngineHealth = async (): Promise<EngineHealth> => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await apiFetch('/pdf/health', { signal: ctrl.signal });
    clearTimeout(t);
    const data = (await res.json()) as { ok?: boolean; version?: string };
    return { ok: Boolean(data.ok) && res.ok, version: data.version };
  } catch {
    return { ok: false, message: ENGINE_OFFLINE_MESSAGE };
  }
};

/**
 * Runs a tool on the Opta engine through the backend.
 * - `files`: main inputs (sent as `fileInput`, repeated for multi-file tools)
 * - `values`: option values keyed by option.key (files for `type: 'file'` options)
 */
export const runTool = async (tool: PdfTool, files: File[], values: Record<string, unknown>, onProgress?: (pct: number) => void): Promise<ToolResult> => {
  const form = new FormData();
  files.forEach((f) => form.append('fileInput', f, f.name));

  // Tools with several friendly modes resolve their own endpoint and field names.
  const resolved = tool.resolve?.(values);
  const options = resolved ? [] : tool.options;
  if (resolved) {
    for (const [k, v] of Object.entries(resolved.fields)) {
      if (v === undefined || v === null || v === '') continue;
      form.append(k, String(v));
    }
  }

  for (const opt of options) {
    const v = values[opt.key];
    if (v === undefined || v === null || v === '') continue;
    if (opt.type === 'file') {
      if (Array.isArray(v)) v.forEach((f) => f instanceof File && form.append(opt.key, f, f.name));
      else if (v instanceof File) form.append(opt.key, v, v.name);
      continue;
    }
    if (opt.multiple && Array.isArray(v)) {
      v.forEach((x) => form.append(opt.key, String(x)));
      continue;
    }
    form.append(opt.key, String(v));
  }

  const url = `${getBackendUrl()}/pdf/api/v1/${resolved?.endpoint ?? tool.endpoint}`;
  const started = performance.now();

  // XHR for upload progress
  const response = await new Promise<{ status: number; blob: Blob; headers: Record<string, string> }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.responseType = 'blob';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      const headers: Record<string, string> = {};
      xhr
        .getAllResponseHeaders()
        .trim()
        .split(/[\r\n]+/)
        .forEach((line) => {
          const [k, ...rest] = line.split(': ');
          if (k) headers[k.toLowerCase()] = rest.join(': ');
        });
      resolve({ status: xhr.status, blob: xhr.response as Blob, headers });
    };
    xhr.onerror = () => reject(new Error('Sem conexão. Verifique sua internet e tente novamente.'));
    xhr.ontimeout = () => reject(new Error('O processamento demorou mais que o esperado. Tente novamente com um arquivo menor.'));
    xhr.timeout = 10 * 60 * 1000;
    xhr.send(form);
  });

  if (response.status < 200 || response.status >= 300) {
    if (response.status === 502 || response.status === 503 || response.status === 504) throw new Error(ENGINE_OFFLINE_MESSAGE);
    let detail = '';
    let code = '';
    try {
      const text = await response.blob.text();
      try {
        const j = JSON.parse(text) as { code?: string; message?: string; error?: string; details?: string; detail?: string; title?: string };
        code = j.code || '';
        detail = j.detail || j.message || j.error || j.details || j.title || '';
      } catch {
        detail = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    } catch {
      // ignore
    }
    // Walls only an account opens: let the auth layer take over (sign-up modal, verify step…).
    if (code === 'AUTH_REQUIRED' || code === 'QUOTA_EXCEEDED' || code === 'VERIFY_REQUIRED') {
      requestAuth(code === 'AUTH_REQUIRED' ? 'tool' : code === 'QUOTA_EXCEEDED' ? 'quota' : 'verify', detail || undefined);
      throw new Error(detail || 'Entre na sua conta para continuar.');
    }
    detail = detail.replace(/stirling[- ]?pdf/gi, 'Opta Files').slice(0, 240);
    if (response.status === 413) throw new Error('Arquivo muito grande. O limite é 200 MB por envio.');
    if (/keystore file is required|PKCS12\/PFX|certificate file is required|private key/i.test(detail)) throw new Error('O motor exige um certificado no formato escolhido (PKCS#12 .p12/.pfx com senha, ou PEM com certificado + chave). Use "Gerar formato exigido" para criar um.');
    if (/cannot be cast to class org\.bouncycastle\.openssl\.PEMKeyPair/i.test(detail)) throw new Error('A chave PEM está em PKCS#8 ("BEGIN PRIVATE KEY"). Converta para PKCS#1 ("BEGIN RSA PRIVATE KEY") ou use um .p12.');
    if (/wrong password|mac check|keystore password|decrypt/i.test(detail)) throw new Error('Senha do certificado incorreta.');
    if (response.status === 400 && /password|encrypt/i.test(detail)) throw new Error('Este PDF está protegido por senha. Use "Remover senha" primeiro.');
    throw new Error(detail || 'Não foi possível concluir esta operação. Verifique o arquivo e tente novamente.');
  }

  const contentType = response.headers['content-type'] || response.blob.type || 'application/octet-stream';
  const base = files[0]?.name?.replace(/\.[^.]+$/, '') || 'documento';
  const ext = contentType.includes('zip') ? 'zip' : contentType.includes('pdf') ? 'pdf' : contentType.includes('json') ? 'json' : contentType.split('/')[1]?.split(';')[0] || 'bin';
  const fileName = fileNameFromDisposition(response.headers['content-disposition'] || null, `${base}-${tool.id}.${ext}`);
  const kind = kindFromType(contentType, fileName);
  const result: ToolResult = { blob: response.blob, fileName, contentType, kind, durationMs: Math.round(performance.now() - started) };
  if (kind === 'json') {
    try {
      result.json = JSON.parse(await response.blob.text());
    } catch {
      // ignore
    }
  }
  return result;
};
