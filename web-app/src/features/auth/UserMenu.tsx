import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Crown, LogIn, LogOut, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button, cn } from '../../components/ui';
import { useAuth } from './context';

const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Header slot: "Entrar / Criar conta" for visitors, avatar menu for customers. */
const UserMenu = () => {
  const { t } = useTranslation('auth');
  const { user, usage, config, ready, openAuth, logout, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!ready) return <div className="w-9 h-9 rounded-full bg-slate-100 animate-pulse" />;

  if (!user) {
    return (
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" icon={LogIn} onClick={() => openAuth('login', 'manual')} className="hidden sm:inline-flex">
          {t('signIn')}
        </Button>
        <Button size="sm" onClick={() => openAuth('register', 'manual')}>
          <span className="sm:hidden">{t('signIn')}</span>
          <span className="hidden sm:inline">{t('signUp')}</span>
        </Button>
      </div>
    );
  }

  const verifyEnabled = Boolean(config?.verification.email || config?.verification.phone);
  const pct = usage?.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void refresh();
        }}
        className="flex items-center gap-1.5 h-9 pl-1 pr-2 rounded-full hover:bg-slate-100 transition-colors"
        aria-label={t('account')}
        aria-expanded={open}
      >
        <span className="relative w-8 h-8 rounded-full brand-gradient text-white text-xs font-bold flex items-center justify-center shadow-brand">
          {initials(user.name)}
          {verifyEnabled && !user.verified && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-gold-500 ring-2 ring-white" />}
        </span>
        <ChevronDown className={cn('w-3.5 h-3.5 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-72 surface-raised rounded-2xl bg-white border border-slate-200/80 p-2 z-50 animate-[fade-in-up_.18s_ease-out_both]">
          <div className="px-3 py-2.5">
            <p className="text-sm font-bold text-slate-900 truncate">{user.name}</p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
            <span className={cn('mt-2 inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10px] font-bold uppercase tracking-wider', user.plan === 'pro' ? 'brand-gradient text-white' : 'bg-slate-100 text-slate-600')}>
              {user.plan === 'pro' && <Crown className="w-3 h-3" />}
              {user.plan === 'pro' ? t('menu.planPro') : t('menu.planFree')}
            </span>
          </div>
          {usage && (
            <div className="px-3 pb-3">
              <p className="text-xs text-slate-500">{usage.limit ? t('menu.usage', { used: usage.used, limit: usage.limit }) : t('menu.usageUnlimited')}</p>
              {usage.limit && (
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-gold-500' : 'brand-gradient')} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          )}
          <div className="border-t border-slate-100 pt-1">
            {verifyEnabled &&
              (user.verified ? (
                <p className="flex items-center gap-2 px-3 h-9 text-sm text-accent-700">
                  <ShieldCheck className="w-4 h-4" /> {t('verify.done')}
                </p>
              ) : (
                <button onClick={() => { setOpen(false); openAuth('verify'); }} className="w-full flex items-center gap-2 px-3 h-9 rounded-lg text-sm font-semibold text-gold-700 hover:bg-gold-50">
                  <ShieldAlert className="w-4 h-4" /> {t('menu.verifyNow')}
                </button>
              ))}
            <button onClick={() => { setOpen(false); void logout(); }} className="w-full flex items-center gap-2 px-3 h-9 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100">
              <LogOut className="w-4 h-4" /> {t('signOut')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserMenu;
