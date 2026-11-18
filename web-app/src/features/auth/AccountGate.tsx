import { useTranslation } from 'react-i18next';
import { Check, Lock } from 'lucide-react';
import { Button } from '../../components/ui';
import { useAuth } from './context';

/** Shown in place of a members-only area (Editor, Studio) for anonymous visitors. */
const AccountGate = ({ area }: { area: 'editor' | 'studio' }) => {
  const { t } = useTranslation('auth');
  const { openAuth, config } = useAuth();
  const perks = [t('gate.perkEditor'), t('gate.perkStudio'), t('gate.perkHeavy')];
  if (config?.limits.free) perks.push(t('gate.perkQuota', { n: config.limits.free }));

  return (
    <div className="h-full overflow-y-auto custom-scrollbar flex items-center justify-center px-6 py-10">
      <div className="max-w-md w-full surface sheen p-7 text-center animate-[fade-in-up_.45s_ease-out_both]">
        <div className="mx-auto w-14 h-14 rounded-2xl brand-gradient text-white flex items-center justify-center shadow-brand">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-slate-900 text-balance">{area === 'editor' ? t('gate.editorTitle') : t('gate.studioTitle')}</h2>
        <p className="mt-2 text-sm text-slate-500">{t('gate.subtitle')}</p>
        <ul className="mt-5 space-y-2 text-left">
          {perks.map((p) => (
            <li key={p} className="flex items-start gap-2.5 text-sm text-slate-700">
              <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-accent-50 text-accent-700 flex items-center justify-center">
                <Check className="w-3.5 h-3.5" />
              </span>
              {p}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col gap-2">
          <Button size="lg" onClick={() => openAuth('register', area)}>
            {t('signUp')}
          </Button>
          <Button variant="ghost" onClick={() => openAuth('login', area)}>
            {t('actions.switchToLogin')}
          </Button>
        </div>
        <p className="mt-4 text-[11px] text-slate-400">{t('gate.note')}</p>
      </div>
    </div>
  );
};

export default AccountGate;
