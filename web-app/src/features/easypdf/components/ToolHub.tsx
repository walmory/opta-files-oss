import { useMemo, useState } from 'react';
import { Search, Star, Clock, Sparkles, PenTool, Lock } from 'lucide-react';
import { cn, Badge } from '../../../components/ui';
import { PDF_TOOLS, TOOL_GROUPS, type PdfTool, type ToolGroup } from '../tools';
import { useAuth } from '../../auth/context';
import { requiresAccount } from '../../auth/premium';
import { useTranslation } from 'react-i18next';

const FAV_KEY = 'optafiles_pdf_favs';
const RECENT_KEY = 'optafiles_pdf_recent';

const load = (k: string): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(k) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const ToolHub = ({ onPick, onOpenEditor, engineOk, onRetry }: { onPick: (tool: PdfTool) => void; onOpenEditor: () => void; engineOk: boolean | null; onRetry?: () => void }) => {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<ToolGroup | 'all' | 'popular'>('popular');
  const [favs, setFavs] = useState<string[]>(() => load(FAV_KEY));
  const recents = useMemo(() => load(RECENT_KEY), []);
  const { user } = useAuth();
  const { t } = useTranslation('auth');

  const toggleFav = (id: string) => {
    const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
    setFavs(next);
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
  };

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    let list = PDF_TOOLS;
    if (q) list = list.filter((t) => normalize(`${t.name} ${t.description} ${(t.keywords || []).join(' ')} ${t.id}`).includes(q));
    else if (group === 'popular') list = list.filter((t) => t.popular || favs.includes(t.id));
    else if (group !== 'all') list = list.filter((t) => t.group === group);
    return list;
  }, [query, group, favs]);

  const ToolCard = ({ tool }: { tool: PdfTool }) => (
    <div role="button" tabIndex={0} onClick={() => onPick(tool)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick(tool)} className="group relative surface sheen p-4 text-left hover:border-brand-300 hover:shadow-float hover:-translate-y-0.5 transition-all duration-200 h-full flex flex-col cursor-pointer">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-400/0 to-transparent group-hover:via-brand-400/70 transition-all" />
      <div className="flex items-start justify-between gap-2">
        <div className="w-11 h-11 rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/10 flex items-center justify-center group-hover:bg-brand-600 group-hover:text-white group-hover:shadow-brand group-hover:ring-white/20 transition-all">
          <tool.icon className="w-5 h-5" />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleFav(tool.id);
          }}
          className={cn('p-1.5 rounded-lg transition-colors', favs.includes(tool.id) ? 'text-gold-500' : 'text-slate-300 hover:text-gold-500 opacity-0 group-hover:opacity-100')}
          aria-label="Favoritar"
        >
          <Star className={cn('w-4 h-4', favs.includes(tool.id) && 'fill-current')} />
        </button>
      </div>
      <p className="mt-3 text-sm font-bold text-slate-900 font-display tracking-tight">{tool.name}</p>
      <p className="mt-1 text-xs text-slate-500 leading-relaxed flex-1">{tool.description}</p>
      <div className="mt-3 flex items-center gap-1.5">
        <Badge tone="neutral" className="capitalize">
          {TOOL_GROUPS.find((g) => g.id === tool.group)?.label}
        </Badge>
        {tool.multiFile && <Badge tone="info">vários arquivos</Badge>}
        {!user && requiresAccount(tool) && (
          <Badge tone="brand">
            <Lock className="w-3 h-3" /> {t('badge')}
          </Badge>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-6 animate-[fade-in-up_.45s_ease-out_both]">
        {/* Hero */}
        <div className="text-center max-w-2xl mx-auto pt-2">
          <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/15 text-[10px] font-bold uppercase tracking-[0.16em]">
            <Sparkles className="w-3 h-3" /> Suite completa de PDF
          </span>
          <h1 className="font-display mt-3 text-3xl md:text-[40px] font-extrabold tracking-[-0.03em] text-slate-900 leading-[1.05] text-balance">
            Tudo que você precisa fazer com um <span className="text-gradient">PDF</span>, num só lugar.
          </h1>
          <p className="mt-3 text-sm md:text-[15px] text-slate-500 text-balance">Juntar, dividir, comprimir, converter, assinar e editar — rápido, seguro e sem complicação.</p>
        </div>

        {/* Search + groups */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-5 h-5 text-brand-500 absolute left-4 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar ferramenta: juntar, comprimir, assinar, OCR, converter…" className="w-full h-13 pl-12 pr-4 rounded-2xl border border-slate-200/80 bg-white/90 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/12 shadow-float transition-shadow" autoFocus />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
            {[{ id: 'popular', label: 'Populares' }, { id: 'all', label: 'Todas' }, ...TOOL_GROUPS.map((g) => ({ id: g.id, label: g.label }))].map((g) => (
              <button key={g.id} onClick={() => { setGroup(g.id as ToolGroup | 'all' | 'popular'); setQuery(''); }} className={cn('h-9 px-4 rounded-full text-xs font-bold whitespace-nowrap transition-all', group === g.id && !query ? 'brand-gradient text-white shadow-brand' : 'bg-white/80 border border-slate-200/80 text-slate-600 hover:border-brand-300 hover:text-brand-700 hover:bg-white')}>
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {/* Editor + status row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button onClick={onOpenEditor} className="group md:col-span-2 relative overflow-hidden rounded-2xl bg-slate-950 text-white p-5 text-left transition-all hover:shadow-brand ring-1 ring-inset ring-white/10">
            <div className="absolute inset-0 brand-gradient opacity-90" />
            <div className="absolute -right-10 -top-16 w-64 h-64 rounded-full bg-accent-400/35 blur-3xl group-hover:bg-accent-400/50 transition-colors" />
            <div className="absolute -left-10 -bottom-20 w-56 h-56 rounded-full bg-white/15 blur-3xl" />
            <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
            <div className="relative flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/15 ring-1 ring-inset ring-white/25 backdrop-blur flex items-center justify-center shadow-lg shadow-brand-900/30">
                <PenTool className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <p className="font-display text-lg font-extrabold tracking-tight">Editor visual</p>
                <p className="text-sm text-white/80">Abra um PDF, adicione textos, imagens, formas e assinaturas página a página.</p>
              </div>
              <span className="ml-auto hidden sm:inline-flex items-center h-8 px-3 rounded-full bg-white text-brand-700 text-xs font-bold shadow-sm group-hover:translate-x-0.5 transition-transform">Abrir →</span>
            </div>
          </button>
          <div className={cn('surface sheen p-5', engineOk === false && 'bg-gold-50 border-gold-200')}>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Opta Cloud</p>
            <div className="mt-2 flex items-center gap-2">
              <span className={cn('relative flex w-2.5 h-2.5', engineOk && 'animate-[pulse-dot_2s_ease-in-out_infinite]')}>
                <span className={cn('absolute inset-0 rounded-full', engineOk ? 'bg-accent-500' : engineOk === false ? 'bg-gold-500' : 'bg-slate-400')} />
              </span>
              <p className={cn('text-sm font-bold', engineOk ? 'text-accent-700' : engineOk === false ? 'text-gold-700' : 'text-slate-500')}>{engineOk ? 'Tudo pronto · 50+ ferramentas' : engineOk === false ? 'Serviço em manutenção' : 'Conectando…'}</p>
            </div>
            <p className="mt-2 text-xs text-slate-500 leading-relaxed">
              {engineOk ? 'Seus arquivos são processados com segurança e apagados após o uso.' : engineOk === false ? 'Estamos restabelecendo o serviço. O editor visual continua disponível.' : 'Preparando suas ferramentas.'}
            </p>
            {engineOk === false && onRetry && (
              <button onClick={onRetry} className="mt-3 inline-flex items-center h-8 px-3 rounded-full bg-white text-gold-700 text-xs font-bold ring-1 ring-inset ring-gold-600/20 hover:bg-gold-100 transition-colors">
                Tentar novamente
              </button>
            )}
          </div>
        </div>

        {/* Recents */}
        {!query && group === 'popular' && recents.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-2 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Usadas recentemente
            </p>
            <div className="flex flex-wrap gap-2">
              {recents.map((id) => PDF_TOOLS.find((t) => t.id === id)).filter((t): t is PdfTool => Boolean(t)).map((t) => (
                <button key={t.id} onClick={() => onPick(t)} className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-white/90 border border-slate-200/80 text-sm font-semibold text-slate-700 hover:border-brand-300 hover:text-brand-700 hover:shadow-card transition-all">
                  <t.icon className="w-4 h-4" /> {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Grid */}
        {group === 'popular' && !query && (
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Populares & favoritas
          </p>
        )}
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-16">Nenhuma ferramenta encontrada para “{query}”.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((t) => (
              <ToolCard key={t.id} tool={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolHub;
