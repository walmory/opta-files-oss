import { useId } from 'react';
import { cn } from '../ui';

/** Símbolo Opta Files — documento com canto dobrado + anel "O" em gradiente. */
export const OptaMark = ({ size = 36, className }: { size?: number; className?: string }) => {
  const id = useId().replace(/:/g, '');
  const g = `opta-g-${id}`;
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={cn('shrink-0', className)} aria-hidden="true">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7b5cff" />
          <stop offset="0.55" stopColor="#5f3ae2" />
          <stop offset="1" stopColor="#4a25d0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13.5" fill={`url(#${g})`} />
      <path d="M16 8h12l8 8v20a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" fill="#fff" />
      <path d="M28 8l8 8h-6a2 2 0 0 1-2-2V8z" fill="#c9bcff" />
      <circle cx="24" cy="26" r="6" fill="none" stroke={`url(#${g})`} strokeWidth="3.4" />
    </svg>
  );
};

/** Logotipo completo: símbolo + wordmark tipográfico. */
export const OptaLogo = ({ size = 36, className, tagline }: { size?: number; className?: string; tagline?: string }) => (
  <div className={cn('flex items-center gap-3 min-w-0', className)}>
    <OptaMark size={size} className="drop-shadow-[0_6px_14px_rgba(95,58,226,0.35)]" />
    <div className="min-w-0 leading-none">
      <p className="font-display text-[19px] font-extrabold tracking-[-0.03em] text-slate-900 leading-none">
        Opta<span className="font-medium text-brand-600">Files</span>
      </p>
      {tagline && <p className="text-[11px] text-slate-500 font-medium truncate mt-1">{tagline}</p>}
    </div>
  </div>
);
