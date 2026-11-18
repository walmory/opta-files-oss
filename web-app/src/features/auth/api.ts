/** Thin client for the backend /auth routes. */
import { apiFetch } from '../../config/env';
import { getDeviceId } from '../../config/session';

export type Channel = 'email' | 'phone';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  /** masked, e.g. +55 ••••• 4321 */
  phone: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  verified: boolean;
  plan: 'free' | 'pro' | string;
  createdAt: number;
}

export interface Usage {
  used: number;
  limit: number | null;
  remaining: number | null;
}

export interface AuthConfig {
  verification: { email: boolean; phone: boolean; required: boolean };
  limits: { anonymous: number | null; free: number | null; pro: number | null };
  usage: Usage;
}

export class AuthApiError extends Error {
  status: number;
  code: string;
  field?: string;
  retryIn?: number;
  constructor(status: number, body: { code?: string; message?: string; field?: string; retryIn?: number }) {
    super(body.message || 'Não foi possível concluir. Tente novamente.');
    this.status = status;
    this.code = body.code || 'UNKNOWN';
    this.field = body.field;
    this.retryIn = body.retryIn;
  }
}

const call = async <T,>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> => {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await apiFetch(`/auth${path}`, {
      ...rest,
      ...(json !== undefined ? { method: rest.method || 'POST', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } } : {})
    });
  } catch {
    throw new AuthApiError(0, { code: 'NETWORK', message: 'Sem conexão. Verifique sua internet e tente novamente.' });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthApiError(res.status, body);
  return body as T;
};

export const authApi = {
  config: () => call<AuthConfig>('/config'),
  me: () => call<{ user: AuthUser; usage: Usage }>('/me'),
  register: (data: { name: string; email: string; phone: string; password: string }) =>
    call<{ token: string; user: AuthUser }>('/register', { json: { ...data, deviceId: getDeviceId() } }),
  login: (identifier: string, password: string) => call<{ token: string; user: AuthUser }>('/login', { json: { identifier, password } }),
  logout: () => call<{ ok: true }>('/logout', { method: 'POST' }),
  sendCode: (channel: Channel) => call<{ sentTo: string; expiresIn: number }>('/verify/send', { json: { channel } }),
  confirmCode: (channel: Channel, code: string) => call<{ user: AuthUser }>('/verify/confirm', { json: { channel, code } })
};

/** Fired by any part of the app that hits a wall only an account can open. */
export const AUTH_REQUIRED_EVENT = 'opta:auth-required';
export type AuthRequiredReason = 'tool' | 'editor' | 'studio' | 'quota' | 'verify' | 'manual';
export const requestAuth = (reason: AuthRequiredReason, message?: string) =>
  window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail: { reason, message } }));
