import { X, Sparkles, FileUp } from 'lucide-react';
import { cn, Switch } from '../../../components/ui';
import { PAGE_SIZES, MARGIN_PRESETS, PT_PER_MM } from '../../../types/pdfEditor';
import { STUDIO_ICONS } from '../icons';
import { STUDIO_TEMPLATES } from '../templates';
import type { StudioApi } from '../useStudio';
import type { DrawerPanel } from './Ribbon';

const SWATCHES = ['#ffffff', '#f8fafc', '#f1f5f9', '#e2e2ec', '#5f3ae2', '#7655f3', '#12b886', '#191929', '#fff8e8', '#e9e5ff', '#d1fae9', '#fee2e2'];
const BRAND_ASSETS = [
  { label: 'Logo Opta Files', src: '/opta-files-wordmark.svg' },
  { label: 'Logo (compacto)', src: '/opta-files.svg' }
];

/** Slide-in drawer next to the pages column: templates, icon library, page setup */
const AssetDrawer = ({ api, panel, onClose }: { api: StudioApi; panel: DrawerPanel; onClose: () => void }) => {
  const { addElement, page, updatePage, newDocument, addPage, doc, showRulers, setShowRulers, showMargins, setShowMargins } = api;
  if (!panel) return null;

  const addIcon = (id: string) => {
    const ic = STUDIO_ICONS.find((i) => i.id === id);
    if (!ic) return;
    const size = 96;
    addElement({ type: 'path', x: NaN, y: NaN, width: size, height: size, content: ic.data, scaleX: size / 24, scaleY: size / 24, fill: ic.filled ? '#5f3ae2' : 'transparent', stroke: ic.filled ? 'transparent' : '#5f3ae2', strokeWidth: 2, name: ic.label });
  };
  const placeImage = (src: string) => {
    const img = new Image();
    img.onload = () => {
      const maxW = (page?.width || 595) * 0.4;
      const scale = Math.min(1, maxW / img.naturalWidth);
      addElement({ type: 'image', content: src, x: NaN, y: NaN, width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale), name: 'Logo' });
    };
    img.src = src;
  };

  const title = panel === 'templates' ? 'Modelos' : panel === 'icons' ? 'Ícones e marca' : 'Configuração da página';

  return (
    <div className="w-[300px] shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
      <div className="h-11 px-4 flex items-center justify-between border-b border-slate-100 shrink-0">
        <p className="text-sm font-bold text-slate-800">{title}</p>
        <button onClick={onClose} className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-5">
        {panel === 'templates' && (
          <>
            <p className="text-xs text-slate-500">Modelos Opta Files prontos. Substitua o documento ou adicione como nova página.</p>
            {STUDIO_TEMPLATES.map((t) => (
              <div key={t.id} className="surface p-3">
                <p className="text-sm font-bold text-slate-800">{t.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{t.description}</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => { if (doc.pages.some((p) => p.elements.length) && !confirm('Substituir o documento atual?')) return; newDocument({ templateId: t.id }); }} className="flex-1 h-8 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-brand-700">Usar modelo</button>
                  <button onClick={() => addPage(t.id)} className="h-8 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">+ Página</button>
                </div>
              </div>
            ))}
          </>
        )}

        {panel === 'icons' && (
          <>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-2">Marca Opta Files</p>
              <div className="grid grid-cols-2 gap-2">
                {BRAND_ASSETS.map((a) => (
                  <button key={a.src} draggable onDragStart={(e) => e.dataTransfer.setData('application/x-studio-image', a.src)} onClick={() => placeImage(a.src)} className="surface p-3 flex items-center justify-center h-20 hover:border-brand-300 cursor-grab active:cursor-grabbing">
                    <img src={a.src} alt={a.label} className="max-h-full max-w-full object-contain" />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-2">Ícones vetoriais</p>
              <div className="grid grid-cols-5 gap-2">
                {STUDIO_ICONS.map((ic) => (
                  <button key={ic.id} title={ic.label} onClick={() => addIcon(ic.id)} className="aspect-square rounded-xl bg-slate-100 hover:bg-brand-50 flex items-center justify-center text-slate-700 hover:text-brand-700 transition-colors">
                    <svg viewBox="0 0 24 24" className="w-6 h-6" fill={ic.filled ? 'currentColor' : 'none'} stroke={ic.filled ? 'none' : 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d={ic.data} />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {panel === 'background' && page && (
          <>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-2">Margens (mm)</p>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                {MARGIN_PRESETS.map((mp) => {
                  const active = page.margins && Object.entries(mp.margins).every(([k, v]) => Math.abs((page.margins as Record<string, number>)[k] - v) < 0.5);
                  return (
                    <button key={mp.id} onClick={() => updatePage({ margins: mp.margins })} className={cn('h-8 px-2 rounded-lg border text-[11px] font-semibold text-left truncate', active ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}>
                      {mp.label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                  <label key={side} className="text-[10px] text-slate-500">
                    {side === 'top' ? 'Sup.' : side === 'right' ? 'Dir.' : side === 'bottom' ? 'Inf.' : 'Esq.'}
                    <input type="number" min={0} max={200} step={1} value={Math.round(((page.margins?.[side] ?? 72) / PT_PER_MM) * 10) / 10} onChange={(e) => updatePage({ margins: { top: 72, right: 72, bottom: 72, left: 72, ...(page.margins || {}), [side]: Math.max(0, Number(e.target.value)) * PT_PER_MM } }, { history: false })} onBlur={() => api.commit()} className="mt-0.5 w-full h-8 rounded-lg border border-slate-200 px-1.5 text-xs text-center outline-none focus:border-brand-400" />
                  </label>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                <Switch checked={showMargins} onChange={setShowMargins} label="Mostrar guias de margem" description="Elementos encostam nas margens ao arrastar" />
                <Switch checked={showRulers} onChange={setShowRulers} label="Mostrar réguas" />
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-2">Cor de fundo</p>
              <div className="grid grid-cols-6 gap-2">
                {SWATCHES.map((c) => (
                  <button key={c} onClick={() => updatePage({ backgroundColor: c })} className={cn('aspect-square rounded-lg border', page.backgroundColor === c ? 'ring-2 ring-brand-500 border-transparent' : 'border-slate-200')} style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input type="color" value={page.backgroundColor || '#ffffff'} onChange={(e) => updatePage({ backgroundColor: e.target.value }, { history: false })} onBlur={() => api.commit()} className="h-9 w-12 rounded-lg border border-slate-200 p-1" />
                <span className="text-xs font-mono text-slate-500">{page.backgroundColor}</span>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-2">Tamanho da página</p>
              <div className="space-y-1.5">
                {PAGE_SIZES.map((s) => (
                  <button key={s.id} onClick={() => updatePage({ width: s.width, height: s.height })} className={cn('w-full flex items-center justify-between h-9 px-3 rounded-lg border text-xs font-semibold', page.width === s.width && page.height === s.height ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}>
                    {s.label} <span className="text-slate-400 font-normal">{s.width}×{s.height}</span>
                  </button>
                ))}
              </div>
            </div>
            {page.imageUrl && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800 flex gap-2">
                <FileUp className="w-4 h-4 shrink-0" /> Página importada de PDF: a camada vetorial original é preservada; textos e imagens viraram elementos editáveis.
              </div>
            )}
            <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-500 flex gap-2">
              <Sparkles className="w-4 h-4 shrink-0 text-amber-500" /> Atalhos: ⌘Z desfazer · ⌘D duplicar · ⌘C/⌘V · setas mover · ⌘0 ajustar · Espaço arrastar.
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AssetDrawer;
