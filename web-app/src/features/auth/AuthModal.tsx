import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PhoneInput } from 'react-international-phone';
import 'react-international-phone/style.css';
import { AtSign, Check, Eye, EyeOff, KeyRound, Mail, ShieldCheck, Smartphone, UserRound, X } from 'lucide-react';
import { Button, Input, Modal, cn } from '../../components/ui';
import { OptaMark } from '../../components/brand/Logo';
import { AuthApiError, authApi, type AuthConfig, type AuthRequiredReason, type AuthUser, type Channel } from './api';
import type { AuthMode } from './context';

interface Props {
  state: { open: boolean; mode: AuthMode; reason?: AuthRequiredReason; message?: string };
  user: AuthUser | null;
  config: AuthConfig | null;
  onMode: (mode: AuthMode) => void;
  onClose: () => void;
  onAuthenticated: (token: string, user: AuthUser, isNew: boolean) => void;
  onUserUpdate: (user: AuthUser) => void;
}

type FieldErrors = Partial<Record<'name' | 'email' | 'phone' | 'password' | 'identifier', string>>;

const PasswordField = ({ value, onChange, error, hint, autoComplete }: { value: string; onChange: (v: string) => void; error?: string; hint?: string; autoComplete: string }) => {
  const { t } = useTranslation('auth');
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input label={t('fields.password')} name="password" type={show ? 'text' : 'password'} icon={KeyRound} value={value} onChange={(e) => onChange(e.target.value)} error={error} hint={hint} autoComplete={autoComplete} required className="pr-10" />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-[27px] p-1.5 rounded-lg text-slate-400 hover:text-slate-700" aria-label={show ? t('actions.hidePassword') : t('actions.showPassword')}>
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
};

/* ------------------------------------------------------------------ login */
const LoginForm = ({ onAuthenticated, onMode }: Pick<Props, 'onAuthenticated' | 'onMode'>) => {
  const { t } = useTranslation('auth');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await authApi.login(identifier.trim(), password);
      onAuthenticated(r.token, r.user, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label={t('fields.identifier')} name="identifier" icon={AtSign} placeholder={t('fields.identifierPlaceholder')} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required autoFocus />
      <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />
      {error && <p className="text-sm text-rose-600 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
      <Button type="submit" loading={busy} className="w-full" size="lg">
        {t('actions.submitLogin')}
      </Button>
      <button type="button" onClick={() => onMode('register')} className="w-full text-sm font-semibold text-brand-700 hover:underline">
        {t('actions.switchToRegister')}
      </button>
    </form>
  );
};

/* ------------------------------------------------------------------ register */
const RegisterForm = ({ onAuthenticated, onMode }: Pick<Props, 'onAuthenticated' | 'onMode'>) => {
  const { t, i18n } = useTranslation('auth');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const defaultCountry = i18n.language.startsWith('pt') && navigator.language === 'pt-PT' ? 'pt' : i18n.language.startsWith('pt') ? 'br' : ({ en: 'us', es: 'es', fr: 'fr', de: 'de', it: 'it' } as Record<string, string>)[i18n.language.slice(0, 2)] || 'br';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const r = await authApi.register(form);
      onAuthenticated(r.token, r.user, true);
    } catch (err) {
      if (err instanceof AuthApiError && err.field) setErrors({ [err.field]: err.message });
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label={t('fields.name')} name="name" icon={UserRound} placeholder={t('fields.namePlaceholder')} value={form.name} onChange={(e) => set('name')(e.target.value)} error={errors.name} autoComplete="name" required autoFocus />
      <Input label={t('fields.email')} name="email" type="email" icon={Mail} placeholder={t('fields.emailPlaceholder')} value={form.email} onChange={(e) => set('email')(e.target.value)} error={errors.email} autoComplete="email" required />
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">{t('fields.phone')}</label>
        <PhoneInput
          defaultCountry={defaultCountry}
          preferredCountries={['br', 'pt', 'us']}
          value={form.phone}
          onChange={(phone) => set('phone')(phone)}
          className={cn('opta-phone', errors.phone && 'opta-phone--error')}
          inputProps={{ name: 'phone', autoComplete: 'tel', required: true }}
        />
        {errors.phone && <p className="text-xs text-rose-600 mt-1">{errors.phone}</p>}
      </div>
      <PasswordField value={form.password} onChange={set('password')} error={errors.password} hint={t('fields.passwordHint')} autoComplete="new-password" />
      {error && <p className="text-sm text-rose-600 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
      <Button type="submit" loading={busy} className="w-full" size="lg">
        {t('actions.submitRegister')}
      </Button>
      <p className="text-[11px] text-slate-400 text-center leading-relaxed">{t('terms')}</p>
      <button type="button" onClick={() => onMode('login')} className="w-full text-sm font-semibold text-brand-700 hover:underline">
        {t('actions.switchToLogin')}
      </button>
    </form>
  );
};

/* ------------------------------------------------------------------ verify */
const ChannelRow = ({ channel, user, onUserUpdate }: { channel: Channel; user: AuthUser; onUserUpdate: (u: AuthUser) => void }) => {
  const { t } = useTranslation('auth');
  const done = channel === 'email' ? user.emailVerified : user.phoneVerified;
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await authApi.sendCode(channel);
      setSentTo(r.sentTo);
      setCooldown(60);
    } catch (err) {
      if (err instanceof AuthApiError && err.retryIn) setCooldown(err.retryIn);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await authApi.confirmCode(channel, code);
      onUserUpdate(r.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const Icon = channel === 'email' ? Mail : Smartphone;
  return (
    <div className={cn('rounded-2xl border p-4', done ? 'border-accent-200 bg-accent-50/60' : 'border-slate-200 bg-white')}>
      <div className="flex items-center gap-3">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', done ? 'bg-accent-500 text-white' : 'bg-brand-50 text-brand-700')}>{done ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900">{t(`verify.${channel}`)}</p>
          <p className="text-xs text-slate-500 truncate">{channel === 'email' ? user.email : user.phone}</p>
        </div>
        {done ? (
          <span className="text-xs font-bold text-accent-700">{t('verify.done')}</span>
        ) : !sentTo ? (
          <Button size="sm" variant="outline" onClick={send} loading={busy} disabled={cooldown > 0}>
            {cooldown > 0 ? t('actions.resendIn', { s: cooldown }) : t('actions.sendCode')}
          </Button>
        ) : null}
      </div>
      {!done && sentTo && (
        <form onSubmit={confirm} className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">{t('verify.sentTo', { to: sentTo })}</p>
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" aria-label={t('fields.code')} className="flex-1 min-w-0 h-11 rounded-xl border border-slate-200 bg-white px-3 text-center text-lg font-bold tracking-[0.5em] outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10" autoFocus />
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              {t('actions.confirm')}
            </Button>
          </div>
          <button type="button" onClick={send} disabled={cooldown > 0 || busy} className="text-xs font-semibold text-brand-700 disabled:text-slate-400">
            {cooldown > 0 ? t('actions.resendIn', { s: cooldown }) : t('actions.resend')}
          </button>
        </form>
      )}
      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
    </div>
  );
};

/* ------------------------------------------------------------------ modal */
const AuthModal = ({ state, user, config, onMode, onClose, onAuthenticated, onUserUpdate }: Props) => {
  const { t } = useTranslation('auth');
  const mode: AuthMode = state.mode === 'verify' && !user ? 'login' : state.mode;
  const channels: Channel[] = (['email', 'phone'] as Channel[]).filter((c) => config?.verification[c]);
  const reason = state.message || (state.reason && state.reason !== 'manual' ? t(`reasons.${state.reason}`) : '');

  const title = mode === 'login' ? t('modal.loginTitle') : mode === 'register' ? t('modal.registerTitle') : t('modal.verifyTitle');
  const subtitle = mode === 'login' ? t('modal.loginSubtitle') : mode === 'register' ? t('modal.registerSubtitle') : t('modal.verifySubtitle');

  return (
    <Modal open={state.open} onClose={onClose} size="sm">
      <div className="relative px-6 pt-6 pb-6">
        <button type="button" onClick={onClose} className="absolute right-3 top-3 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
        <div className="flex flex-col items-center text-center">
          {mode === 'verify' ? (
            <div className="w-12 h-12 rounded-2xl brand-gradient text-white flex items-center justify-center shadow-brand">
              <ShieldCheck className="w-6 h-6" />
            </div>
          ) : (
            <OptaMark size={48} className="drop-shadow-[0_6px_14px_rgba(95,58,226,0.35)]" />
          )}
          <h2 className="mt-3 font-display text-xl font-extrabold tracking-tight text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        {reason && mode !== 'verify' && <p className="mt-4 text-sm text-brand-800 bg-brand-50 ring-1 ring-inset ring-brand-600/10 rounded-xl px-3 py-2.5">{reason}</p>}
        <div className="mt-5">
          {mode === 'login' && <LoginForm onAuthenticated={onAuthenticated} onMode={onMode} />}
          {mode === 'register' && <RegisterForm onAuthenticated={onAuthenticated} onMode={onMode} />}
          {mode === 'verify' && user && (
            <div className="space-y-3">
              {channels.map((c) => (
                <ChannelRow key={c} channel={c} user={user} onUserUpdate={onUserUpdate} />
              ))}
              <Button variant="ghost" className="w-full" onClick={onClose}>
                {t('actions.later')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default AuthModal;
