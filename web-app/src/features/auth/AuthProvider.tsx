import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../components/ui';
import { getSessionToken, setSessionToken } from '../../config/session';
import { AUTH_REQUIRED_EVENT, AuthApiError, authApi, type AuthConfig, type AuthRequiredReason, type AuthUser, type Usage } from './api';
import { AuthContext, type AuthContextValue, type AuthMode } from './context';
import AuthModal from './AuthModal';

interface ModalState {
  open: boolean;
  mode: AuthMode;
  reason?: AuthRequiredReason;
  message?: string;
}

const AuthProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation('auth');
  const toast = useToast();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [ready, setReady] = useState(() => !getSessionToken());
  const [modal, setModal] = useState<ModalState>({ open: false, mode: 'login' });

  const refresh = useCallback(async () => {
    if (!getSessionToken()) {
      const cfg = await authApi.config().catch(() => null);
      if (cfg) {
        setConfig(cfg);
        setUsage(cfg.usage);
      }
      return;
    }
    try {
      const me = await authApi.me();
      setUser(me.user);
      setUsage(me.usage);
    } catch (e) {
      if (e instanceof AuthApiError && e.status === 401) {
        setSessionToken(null);
        setUser(null);
      }
    }
  }, []);

  // Boot: validate the stored session and read the public config (verification, limits).
  useEffect(() => {
    let alive = true;
    const boot = async () => {
      const hadSession = Boolean(getSessionToken());
      const [cfg, me] = await Promise.all([
        authApi.config().catch(() => null),
        hadSession ? authApi.me().catch((e: unknown) => e) : Promise.resolve(null)
      ]);
      if (!alive) return;
      if (cfg) setConfig(cfg);
      if (me && !(me instanceof Error)) {
        const ok = me as { user: AuthUser; usage: Usage };
        setUser(ok.user);
        setUsage(ok.usage);
      } else {
        if (me instanceof AuthApiError && me.status === 401) setSessionToken(null);
        if (cfg) setUsage(cfg.usage);
      }
      setReady(true);
    };
    void boot();
    return () => {
      alive = false;
    };
  }, []);

  const openAuth = useCallback<AuthContextValue['openAuth']>((mode = 'login', reason, message) => setModal({ open: true, mode, reason, message }), []);

  // Any screen can ask for an account (engine answered AUTH_REQUIRED, quota reached…).
  useEffect(() => {
    const onRequired = (e: Event) => {
      const { reason, message } = (e as CustomEvent<{ reason: AuthRequiredReason; message?: string }>).detail || {};
      if (reason === 'verify') return setModal({ open: true, mode: 'verify', reason, message });
      if (getSessionToken()) {
        // Signed-in customer who hit the free plan limit: nothing to sign in to.
        if (message) toast.warning(message);
        void refresh();
        return;
      }
      setModal({ open: true, mode: 'register', reason, message });
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onRequired);
  }, [refresh, toast]);

  const onAuthenticated = useCallback(
    (token: string, u: AuthUser, isNew: boolean) => {
      setSessionToken(token);
      setUser(u);
      void refresh();
      const needsVerify = isNew && !u.verified && Boolean(config?.verification.email || config?.verification.phone);
      if (needsVerify) setModal((m) => ({ ...m, mode: 'verify' }));
      else setModal((m) => ({ ...m, open: false }));
      const first = u.name.split(' ')[0];
      toast.success(isNew ? t('toast.welcome', { name: first }) : t('toast.welcomeBack', { name: first }));
    },
    [config, refresh, t, toast]
  );

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setSessionToken(null);
    setUser(null);
    void refresh();
    toast.info(t('toast.signedOut'));
  }, [refresh, t, toast]);

  const requireAccount = useCallback(
    (reason: AuthRequiredReason) => {
      if (user) return true;
      openAuth('register', reason);
      return false;
    },
    [openAuth, user]
  );

  const value = useMemo<AuthContextValue>(() => ({ user, usage, config, ready, openAuth, logout, refresh, requireAccount }), [user, usage, config, ready, openAuth, logout, refresh, requireAccount]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthModal
        state={modal}
        user={user}
        config={config}
        onMode={(mode) => setModal((m) => ({ ...m, mode, message: undefined }))}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
        onAuthenticated={onAuthenticated}
        onUserUpdate={(u) => {
          setUser(u);
          if (u.verified) {
            toast.success(t('toast.verified'));
            setModal((m) => ({ ...m, open: false }));
          }
        }}
      />
    </AuthContext.Provider>
  );
};

export default AuthProvider;
