import { cn, Input, Select, Switch, Textarea } from '../../../components/ui';
import type { PdfTool, ToolOption } from '../tools';

/** Some options only make sense for a given mode of the same tool. */
export const isOptionVisible = (tool: PdfTool, opt: ToolOption, values: Record<string, unknown>) => {
  if ((opt.key === 'watermarkImage' && values.watermarkType !== 'image') || (opt.key === 'watermarkText' && values.watermarkType === 'image')) return false;
  if ((opt.key === 'stampImage' && values.stampType !== 'image') || (opt.key === 'stampText' && values.stampType === 'image')) return false;
  if (tool.id === 'cert-sign') {
    const ct = values.certType;
    if (opt.key === 'p12File' && ct !== 'PKCS12') return false;
    if ((opt.key === 'privateKeyFile' || opt.key === 'certFile') && ct !== 'PEM') return false;
    if (opt.key === 'jksFile' && ct !== 'JKS') return false;
  }
  if (tool.id === 'invert') {
    const mode = values.replaceAndInvertOption;
    if (opt.key === 'highContrastColorCombination' && mode !== 'HIGH_CONTRAST_COLOR') return false;
    if ((opt.key === 'backGroundColor' || opt.key === 'textColor') && mode !== 'CUSTOM_COLOR') return false;
  }
  return true;
};

export const defaultValues = (tool: PdfTool) => Object.fromEntries(tool.options.filter((o) => o.default !== undefined).map((o) => [o.key, o.default]));

export const isRequiredSatisfied = (tool: PdfTool, values: Record<string, unknown>) =>
  tool.options
    .filter((o) => o.required && isOptionVisible(tool, o, values))
    .every((o) => {
      const v = values[o.key];
      return v instanceof File || (Array.isArray(v) && v.length) || (typeof v === 'string' && v.trim()) || typeof v === 'number';
    });

interface Props {
  tool: PdfTool;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  className?: string;
}

/** Renders the option form for any tool of the registry. */
const OptionFields = ({ tool, values, onChange, className }: Props) => {
  const render = (opt: ToolOption) => {
    if (!isOptionVisible(tool, opt, values)) return null;
    const v = values[opt.key];
    const set = (nv: unknown) => onChange(opt.key, nv);
    switch (opt.type) {
      case 'boolean':
        return <Switch key={opt.key} checked={Boolean(v)} onChange={set} label={opt.label} description={opt.help} />;
      case 'select':
        if (opt.multiple) {
          const arr = Array.isArray(v) ? (v as string[]) : [];
          return (
            <div key={opt.key}>
              <p className="text-xs font-semibold text-slate-600 mb-1.5">{opt.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {opt.options?.map((o) => (
                  <button key={o.value} type="button" onClick={() => set(arr.includes(o.value) ? arr.filter((x) => x !== o.value) : [...arr, o.value])} className={cn('h-8 px-3 rounded-full text-xs font-semibold border transition-colors', arr.includes(o.value) ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300')}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          );
        }
        return (
          <Select key={opt.key} label={opt.label} value={String(v ?? '')} onChange={(e) => set(e.target.value)}>
            {opt.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        );
      case 'textarea':
        return <Textarea key={opt.key} label={opt.label} value={String(v ?? '')} onChange={(e) => set(e.target.value)} placeholder={opt.help} />;
      case 'file':
        return (
          <div key={opt.key}>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              {opt.label} {opt.required && <span className="text-rose-500">*</span>}
            </label>
            <input type="file" accept={opt.accept} multiple={opt.multiple} onChange={(e) => set(opt.multiple ? Array.from(e.target.files || []) : e.target.files?.[0] || null)} className="block w-full text-xs text-slate-600 file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:font-semibold hover:file:bg-slate-200" />
          </div>
        );
      case 'color':
        return (
          <div key={opt.key}>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">{opt.label}</label>
            <div className="flex items-center gap-2">
              <input type="color" value={String(v ?? '#000000')} onChange={(e) => set(e.target.value)} className="h-10 w-14 rounded-lg border border-slate-200 bg-white p-1 cursor-pointer" />
              <Input value={String(v ?? '')} onChange={(e) => set(e.target.value)} className="font-mono" />
            </div>
          </div>
        );
      case 'number':
        return <Input key={opt.key} type="number" label={opt.label} hint={opt.help} value={v === undefined || v === null ? '' : String(v)} min={opt.min} max={opt.max} step={opt.step} onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))} />;
      case 'password':
        return <Input key={opt.key} type="password" label={`${opt.label}${opt.required ? ' *' : ''}`} hint={opt.help} value={String(v ?? '')} onChange={(e) => set(e.target.value)} autoComplete="new-password" />;
      default:
        return <Input key={opt.key} label={`${opt.label}${opt.required ? ' *' : ''}`} hint={opt.help} value={String(v ?? '')} onChange={(e) => set(e.target.value)} />;
    }
  };
  return <div className={cn('space-y-4', className)}>{tool.options.map(render)}</div>;
};

export default OptionFields;
