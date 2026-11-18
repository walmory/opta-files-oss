import { createContext, useContext } from 'react';
import type { AuthConfig, AuthRequiredReason, AuthUser, Usage } from './api';

export type AuthMode = 'login' | 'register' | 'verify';

export interface AuthContextValue {
  /** null = anonymous visitor */
  user: AuthUser | null;
  usage: Usage | null;
  config: AuthConfig | null;
  /** true once the stored session has been checked with the backend */
  ready: boolean;
  openAuth: (mode?: AuthMode, reason?: AuthRequiredReason, message?: string) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Returns true when signed in; otherwise opens the sign-up modal and returns false. */
  requireAccount: (reason: AuthRequiredReason) => boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
