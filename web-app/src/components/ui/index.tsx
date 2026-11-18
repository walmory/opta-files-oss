/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, AlertTriangle, Info, XCircle, Loader2, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const cn = (...inputs: (string | false | null | undefined)[]) => twMerge(clsx(inputs));

/* ------------------------------------------------------------------ Button */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'outline';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'brand-gradient text-white hover:brightness-110 shadow-brand ring-1 ring-inset ring-white/15 disabled:opacity-60',
  accent: 'bg-accent-500 text-white hover:bg-accent-600 shadow-sm shadow-accent-500/25 disabled:bg-accent-200',
  secondary: 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm disabled:bg-slate-400',
  outline: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-brand-300 hover:text-brand-700 sheen',
  ghost: 'text-slate-600 hover:bg-brand-50 hover:text-brand-700',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm disabled:bg-rose-300'
};

const buttonSizes: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-lg',
  sm: 'h-8 px-3 text-sm gap-2 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-base gap-2.5 rounded-xl',
  icon: 'h-9 w-9 rounded-xl'
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, icon: Icon, iconRight: IconRight, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-semibold whitespace-nowrap transition-all duration-150 select-none',
        'disabled:cursor-not-allowed disabled:opacity-80 active:scale-[0.98]',
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : Icon ? <Icon className={size === 'xs' ? 'w-3.5 h-3.5' : 'w-4 h-4'} /> : null}
      {children}
      {IconRight && !loading && <IconRight className="w-4 h-4" />}
    </button>
  )
);
Button.displayName = 'Button';

/* ------------------------------------------------------------------ Badge */
type Tone = 'neutral' | 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
const badgeTones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-600/10',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/15',
  accent: 'bg-accent-50 text-accent-700 ring-accent-600/15',
  success: 'bg-accent-50 text-accent-700 ring-accent-600/15',
  warning: 'bg-gold-50 text-gold-700 ring-gold-600/15',
  danger: 'bg-rose-50 text-rose-700 ring-rose-600/10',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/10'
};

export const Badge = ({ tone = 'neutral', dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) => (
  <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset', badgeTones[tone], className)}>
    {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />}
    {children}
  </span>
);

/* ------------------------------------------------------------------ Card */
export const Card = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('surface', className)} {...props}>
    {children}
  </div>
);

export const CardHeader = ({ title, subtitle, action, className }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; className?: string }) => (
  <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 pb-3', className)}>
    <div className="min-w-0">
      <h3 className="text-sm font-bold text-slate-900 tracking-tight truncate">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
    {action}
  </div>
);

/* ------------------------------------------------------------------ Stat */
export const Stat = ({ label, value, hint, icon: Icon, tone = 'brand', trend }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: LucideIcon; tone?: Tone; trend?: { value: number; label?: string } }) => (
  <Card className="p-5 flex items-start gap-4">
    {Icon && (
      <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center shrink-0', badgeTones[tone])}>
        <Icon className="w-5 h-5" />
      </div>
    )}
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-extrabold text-slate-900 tracking-tight mt-1 truncate">{value}</p>
      {(hint || trend) && (
        <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
          {trend && (
            <span className={cn('font-bold', trend.value >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
              {trend.value >= 0 ? '+' : ''}
              {trend.value}%
            </span>
          )}
          {trend?.label || hint}
        </p>
      )}
    </div>
  </Card>
);

/* ------------------------------------------------------------------ Inputs */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { icon?: LucideIcon; label?: string; hint?: string; error?: string }>(
  ({ className, icon: Icon, label, hint, error, id, ...props }, ref) => {
    const inputId = id || props.name;
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-semibold text-slate-600 mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {Icon && <Icon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full h-10 rounded-xl border bg-white text-sm text-slate-900 placeholder:text-slate-400 transition-colors',
              'focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 outline-none',
              Icon ? 'pl-9 pr-3' : 'px-3',
              error ? 'border-rose-300' : 'border-slate-200',
              className
            )}
            {...props}
          />
        </div>
        {error ? <p className="text-xs text-rose-600 mt-1">{error}</p> : hint ? <p className="text-xs text-slate-400 mt-1">{hint}</p> : null}
      </div>
    );
  }
);
Input.displayName = 'Input';

export const Select = ({ className, label, hint, children, id, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: string }) => (
  <div className="w-full">
    {label && (
      <label htmlFor={id} className="block text-xs font-semibold text-slate-600 mb-1.5">
        {label}
      </label>
    )}
    <select
      id={id}
      className={cn(
        'w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none',
        'focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10',
        className
      )}
      {...props}
    >
      {children}
    </select>
    {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
  </div>
);

export const Textarea = ({ className, label, hint, id, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string }) => (
  <div className="w-full">
    {label && (
      <label htmlFor={id} className="block text-xs font-semibold text-slate-600 mb-1.5">
        {label}
      </label>
    )}
    <textarea
      id={id}
      className={cn(
        'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none resize-y min-h-[88px]',
        'focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10',
        className
      )}
      {...props}
    />
    {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
  </div>
);

export const Switch = ({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label?: string; description?: string }) => (
  <label className="flex items-start gap-3 cursor-pointer select-none">
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn('relative w-10 h-6 rounded-full transition-colors shrink-0 mt-0.5', checked ? 'bg-brand-600' : 'bg-slate-300')}
    >
      <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
    </button>
    {(label || description) && (
      <span className="min-w-0">
        {label && <span className="block text-sm font-semibold text-slate-800">{label}</span>}
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    )}
  </label>
);

/* ------------------------------------------------------------------ Segmented */
export const Segmented = <T extends string>({ value, onChange, options, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; icon?: LucideIcon }[]; className?: string; size?: 'sm' | 'md' }) => (
  <div role="tablist" className={cn('inline-flex items-center bg-slate-100 p-1 rounded-xl', className)}>
    {options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        role="tab"
        aria-selected={value === opt.value}
        onClick={() => onChange(opt.value)}
        className={cn(
          'relative z-10 flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors',
          size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
          value === opt.value ? 'text-brand-700' : 'text-slate-500 hover:text-slate-700'
        )}
      >
        {value === opt.value && <motion.span layoutId={`seg-${options.map((o) => o.value).join('-')}`} className="absolute inset-0 bg-white rounded-lg shadow-[0_1px_2px_rgba(25,25,41,0.08),0_0_0_1px_rgba(95,58,226,0.14)] -z-10" transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }} />}
        {opt.icon && <opt.icon className="w-3.5 h-3.5" />}
        {opt.label}
      </button>
    ))}
  </div>
);

/* ------------------------------------------------------------------ PageHeader */
export const PageHeader = ({ title, subtitle, icon: Icon, actions, badge, className }: { title: string; subtitle?: string; icon?: LucideIcon; actions?: React.ReactNode; badge?: React.ReactNode; className?: string }) => (
  <div className={cn('flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6', className)}>
    <div className="flex items-center gap-4 min-w-0">
      {Icon && (
        <div className="w-12 h-12 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-lg shadow-brand-600/25 shrink-0">
          <Icon className="w-6 h-6" />
        </div>
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight truncate">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="text-sm text-slate-500 font-medium mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
  </div>
);

/* ------------------------------------------------------------------ EmptyState */
export const EmptyState = ({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode; className?: string }) => (
  <div className={cn('flex flex-col items-center justify-center text-center p-10', className)}>
    {Icon && (
      <div className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8" />
      </div>
    )}
    <h3 className="text-base font-bold text-slate-800">{title}</h3>
    {description && <p className="text-sm text-slate-500 mt-1 max-w-sm text-balance">{description}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

/* ------------------------------------------------------------------ Skeleton */
export const Skeleton = ({ className }: { className?: string }) => <div className={cn('animate-pulse bg-slate-200/70 rounded-lg', className)} />;

/* ------------------------------------------------------------------ Kbd */
export const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md border border-slate-200 bg-white text-[10px] font-bold text-slate-500 shadow-[0_1px_0_rgba(0,0,0,0.06)]">{children}</kbd>
);

/* ------------------------------------------------------------------ Modal */
export const Modal = ({ open, onClose, title, description, children, footer, size = 'md', className }: { open: boolean; onClose: () => void; title?: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'; className?: string }) => {
  const { t } = useTranslation('common');
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-[95vw] h-[92vh]' };
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onMouseDown={onClose}>
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }}
            role="dialog"
            aria-modal="true"
            className={cn('bg-white w-full rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[92vh]', sizes[size], className)}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {(title || description) && (
              <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-slate-100">
                <div className="min-w-0">
                  {title && <h2 className="text-lg font-bold text-slate-900 tracking-tight">{title}</h2>}
                  {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
                </div>
                <button onClick={onClose} className="p-2 -mr-2 -mt-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors" aria-label={t('actions.close')}>
                  <X className="w-5 h-5" />
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto custom-scrollbar">{children}</div>
            {footer && <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

/* ------------------------------------------------------------------ Confirm */
export const ConfirmDialog = ({ open, onClose, onConfirm, title, description, confirmLabel, tone = 'danger', loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; description?: string; confirmLabel?: string; tone?: 'danger' | 'primary'; loading?: boolean }) => {
  const { t } = useTranslation('common');
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel ?? t('actions.confirm')}
          </Button>
        </>
      }
    >
      <div className="px-6 py-2" />
    </Modal>
  );
};

/* ------------------------------------------------------------------ Toast */
type ToastTone = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}
interface ToastContextValue {
  toast: (t: Omit<ToastItem, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}
const ToastContext = createContext<ToastContextValue | null>(null);

const toastIcons: Record<ToastTone, { icon: LucideIcon; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'text-emerald-500' },
  error: { icon: XCircle, cls: 'text-rose-500' },
  info: { icon: Info, cls: 'text-brand-500' },
  warning: { icon: AlertTriangle, cls: 'text-amber-500' }
};

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev.slice(-4), { ...t, id }]);
      window.setTimeout(() => remove(id), t.tone === 'error' ? 7000 : 4500);
    },
    [remove]
  );
  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, tone: 'success' }),
      error: (title, description) => toast({ title, description, tone: 'error' }),
      info: (title, description) => toast({ title, description, tone: 'info' }),
      warning: (title, description) => toast({ title, description, tone: 'warning' })
    }),
    [toast]
  );
  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2rem)] pointer-events-none">
            <AnimatePresence>
              {items.map((t) => {
                const { icon: Icon, cls } = toastIcons[t.tone];
                return (
                  <motion.div key={t.id} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }} className="pointer-events-auto surface p-3.5 flex items-start gap-3 shadow-float">
                    <Icon className={cn('w-5 h-5 shrink-0 mt-0.5', cls)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900">{t.title}</p>
                      {t.description && <p className="text-xs text-slate-500 mt-0.5 break-words">{t.description}</p>}
                    </div>
                    <button onClick={() => remove(t.id)} className="text-slate-400 hover:text-slate-700 p-1 -m-1 rounded-md" aria-label="Fechar">
                      <X className="w-4 h-4" />
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Safe fallback for components rendered outside provider (tests, isolated routes)
    return {
      toast: () => undefined,
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warning: () => undefined
    } as ToastContextValue;
  }
  return ctx;
};

/* ------------------------------------------------------------------ Tooltip (lightweight, CSS only) */
export const Tooltip = ({ label, children, side = 'top' }: { label: string; children: React.ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) => {
  const pos = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2'
  }[side];
  return (
    <span className="relative group/tip inline-flex">
      {children}
      <span role="tooltip" className={cn('pointer-events-none absolute z-50 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover/tip:opacity-100', pos)}>
        {label}
      </span>
    </span>
  );
};
