import { useTranslation } from 'react-i18next';
import { Plus, Copy, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '../../../components/ui';
import type { StudioApi } from '../useStudio';

/** iLovePDF-style vertical page thumbnails */
const PagesPanel = ({ api, onGoTo }: { api: StudioApi; onGoTo: (i: number) => void }) => {
  const { t } = useTranslation('studio');
  const { doc, pageIndex, addPage, duplicatePage, deletePage, movePage } = api;
  return (
    <aside className="w-[148px] shrink-0 bg-slate-100 border-r border-slate-200 flex flex-col">
      <div className="h-11 px-3 flex items-center justify-between border-b border-slate-200 shrink-0">
        <p className="text-xs font-bold text-slate-700">{t('pagesPanel.title')}</p>
        <span className="text-[10px] text-slate-400">{doc.pages.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
        {doc.pages.map((p, i) => {
          const ratio = p.height / p.width;
          const w = 108;
          return (
            <div key={p.id} className="group relative">
              <button onClick={() => onGoTo(i)} className={cn('block w-full rounded-md overflow-hidden border-2 bg-white shadow-sm transition-all', i === pageIndex ? 'border-brand-600 ring-2 ring-brand-200' : 'border-slate-200 hover:border-brand-300')} style={{ height: Math.round(w * ratio), backgroundColor: p.backgroundColor || '#fff' }}>
                {p.thumbnail ? <img src={p.thumbnail} alt="" className="w-full h-full object-cover" draggable={false} /> : p.imageUrl ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" draggable={false} /> : null}
              </button>
              <p className={cn('mt-1 text-center text-[10px] font-bold', i === pageIndex ? 'text-brand-700' : 'text-slate-500')}>{i + 1}</p>
              <div className="absolute top-1 right-1 hidden group-hover:flex flex-col gap-0.5 bg-white/95 rounded-md shadow border border-slate-200 p-0.5">
                <button onClick={() => i > 0 && movePage(i, i - 1)} className="p-0.5 text-slate-500 hover:text-slate-800" title={t('pagesPanel.moveUp')}><ChevronUp className="w-3 h-3" /></button>
                <button onClick={() => i < doc.pages.length - 1 && movePage(i, i + 1)} className="p-0.5 text-slate-500 hover:text-slate-800" title={t('pagesPanel.moveDown')}><ChevronDown className="w-3 h-3" /></button>
                <button onClick={() => { onGoTo(i); duplicatePage(); }} className="p-0.5 text-slate-500 hover:text-slate-800" title={t('pagesPanel.duplicate')}><Copy className="w-3 h-3" /></button>
                <button onClick={() => doc.pages.length > 1 && confirm(t('pagesPanel.confirmDelete')) && deletePage(i)} className="p-0.5 text-rose-500 hover:text-rose-700" title={t('pagesPanel.delete')}><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          );
        })}
        <button onClick={() => addPage()} className="w-full h-16 rounded-md border-2 border-dashed border-slate-300 text-slate-400 hover:border-brand-400 hover:text-brand-600 flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold">
          <Plus className="w-4 h-4" /> {t('pagesPanel.newPage')}
        </button>
      </div>
    </aside>
  );
};

export default PagesPanel;
