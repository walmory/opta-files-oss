import { getSessionToken } from './session';

/**
 * Centralized runtime configuration.
 * Every external key / URL is read from Vite env vars here — never hardcode secrets in components.
 */

const read = (key: string, fallback = ''): string => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key];
  return value && value.trim() ? value.trim() : fallback;
};

const inferBackendUrl = (): string => {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3001';
  const host = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
  return `${window.location.protocol}//${host}:3001`;
};

const backendUrl = read('VITE_BACKEND_BASE_URL', inferBackendUrl()).replace(/\/$/, '');

export const ENV = {
  /** Google Maps JS + Places + Distance Matrix */
  GOOGLE_MAPS_API_KEY: read('VITE_GOOGLE_MAPS_API_KEY'),
  /** Gemini (video inventory analysis, layout AI, quote detection) */
  GEMINI_API_KEY: read('VITE_GEMINI_API_KEY'),
  /** Opta backend (PDF engine gateway, fonts and JSON store) */
  BACKEND_URL: backendUrl,
  /** Shared token required by the backend. Public by design (static app):
   *  it stops drive-by bots and scripted abuse, it is not a user secret. */
  API_TOKEN: read('VITE_API_TOKEN'),
  /** Company defaults used in documents */
  COMPANY: {
    name: read('VITE_COMPANY_NAME', 'Opta Files'),
    currency: read('VITE_CURRENCY', 'GBP'),
    locale: read('VITE_LOCALE', 'pt-BR')
  }
} as const;

export const hasGoogleMaps = () => Boolean(ENV.GOOGLE_MAPS_API_KEY);
export const hasGemini = () => Boolean(ENV.GEMINI_API_KEY);

/** Backend URL that can be overridden at runtime (settings screen / failover). */
export const getBackendUrl = (): string => {
  try {
    const saved = localStorage.getItem('optafiles_backend_url');
    if (saved && !saved.includes(':3010')) return saved.replace('localhost', '127.0.0.1');
  } catch {
    // ignore storage errors
  }
  return ENV.BACKEND_URL.replace('localhost', '127.0.0.1');
};

export const setBackendUrl = (url: string) => {
  try {
    localStorage.setItem('optafiles_backend_url', url.replace(/\/$/, ''));
  } catch {
    // ignore
  }
};

/** Headers the backend expects: the shared app token and, when signed in, the customer session. */
export const authHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = ENV.API_TOKEN ? { 'x-opta-token': ENV.API_TOKEN } : {};
  const session = getSessionToken();
  if (session) headers.Authorization = `Bearer ${session}`;
  return headers;
};

/** fetch() against the Opta backend with the shared token attached. */
export const apiFetch = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${getBackendUrl()}${path}`, { ...init, headers: { ...authHeaders(), ...(init.headers || {}) } });
