import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wrench, PenTool, LayoutTemplate, FolderOpen, Wifi, WifiOff, Loader2, Sparkles } from 'lucide-react';
import { cn, Segmented } from '../components/ui';
import { OptaLogo } from '../components/brand/Logo';
import StudioPage from '../features/studio/StudioPage';
import WorkspacePage from '../features/workspace/WorkspacePage';
import ToolHub from '../features/easypdf/components/ToolHub';
import ToolRunner from '../features/easypdf/components/ToolRunner';
import QrStudio from '../features/easypdf/components/QrStudio';
import ImageResizeStudio from '../features/easypdf/components/ImageResizeStudio';
import VectorizeStudio from '../features/easypdf/components/VectorizeStudio';
import DocumentHistory from '../features/easypdf/components/DocumentHistory';
import { checkEngineHealth } from '../features/easypdf/engineClient';
import type { PdfTool } from '../features/easypdf/tools';
import { useAuth } from '../features/auth/context';
import { requiresAccount } from '../features/auth/premium';
import UserMenu from '../features/auth/UserMenu';
import AccountGate from '../features/auth/AccountGate';

type Tab = 'tools' | 'editor' | 'studio' | 'docs';
const TAB_KEY = 'optafiles_pdf_tab';
const VALID_TABS: Tab[] = ['tools', 'editor', 'studio', 'docs'];

const EasyPdf = () => {
  const { t } = useTranslation('pages');
  const { user, ready, requireAccount } = useAuth();
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as Tab | null;
      return saved && VALID_TABS.includes(saved) ? saved : 'tools';
    } catch {
      return 'tools';
    }
  });
  const [activeTool, setActiveToolState] = useState<PdfTool | null>(null);
  const [chainFiles, setChainFiles] = useState<File[] | undefined>();
  const [health, setHealth] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // ignore
    }
  }, [tab]);

  const probe = useCallback(async () => {
    const h = await checkEngineHealth();
    setHealth(h.ok);
  }, []);
  useEffect(() => {
    const first = window.setTimeout(probe, 0);
    const id = window.setInterval(probe, 30000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [probe]);

  const [studioFile, setStudioFile] = useState<File | null>(null);
  const openInEditor = useCallback((file: File) => {
    setStudioFile(file);
    setTab('editor');
  }, []);

  const pickTool = (tool: PdfTool, files?: File[]) => {
    // Heavy tools come with the free account — ask before the customer uploads anything.
    if (requiresAccount(tool) && !requireAccount('tool')) return;
    setActiveToolState(tool);
    setChainFiles(files);
    setTab('tools');
  };

  const tabs = [
    { value: 'tools' as Tab, label: t('easyPdf.tabs.tools'), icon: Wrench },
    { value: 'editor' as Tab, label: t('easyPdf.tabs.editor'), icon: PenTool },
    { value: 'studio' as Tab, label: t('easyPdf.tabs.studio'), icon: LayoutTemplate },
    { value: 'docs' as Tab, label: t('easyPdf.tabs.docs'), icon: FolderOpen }
  ];

  return (
    <div className="h-full flex flex-col canvas-grid overflow-hidden">
      {/* Header */}
      <header className="relative z-20 shrink-0 px-4 md:px-6 py-2.5 lg:py-0 lg:h-16 glass border-b border-slate-200/70 flex flex-wrap lg:flex-nowrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3 min-w-0 flex-1 lg:flex-none">
          <OptaLogo size={38} tagline={t('easyPdf.subtitle')} />
          <span className="hidden xl:inline-flex shrink-0 items-center gap-1 h-6 px-2 rounded-full brand-gradient text-white text-[10px] font-bold uppercase tracking-[0.14em] shadow-brand">
            <Sparkles className="w-3 h-3" /> {t('easyPdf.badgePro')}
          </span>
        </div>

        <button onClick={probe} aria-label={t('easyPdf.status.tooltip')} className={cn('order-2 lg:order-none shrink-0 inline-flex items-center gap-2 h-8 w-8 justify-center sm:w-auto sm:justify-start sm:pl-2.5 sm:pr-3 rounded-full text-[11px] font-bold ring-1 ring-inset transition-colors', health ? 'bg-accent-50 text-accent-700 ring-accent-600/15 hover:bg-accent-100' : health === false ? 'bg-gold-50 text-gold-700 ring-gold-600/15 hover:bg-gold-100' : 'bg-slate-100 text-slate-500 ring-slate-500/10')} title={t('easyPdf.status.tooltip')}>
          <span className={cn('relative hidden sm:flex w-2 h-2', health && 'animate-[pulse-dot_2s_ease-in-out_infinite]')}>
            <span className={cn('absolute inset-0 rounded-full', health ? 'bg-accent-500' : health === false ? 'bg-gold-500' : 'bg-slate-400')} />
          </span>
          {health ? <Wifi className="w-3.5 h-3.5 shrink-0" /> : health === false ? <WifiOff className="w-3.5 h-3.5 shrink-0" /> : <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />}
          <span className="hidden md:inline whitespace-nowrap">
            {t('easyPdf.status.brand')} {health ? t('easyPdf.status.online') : health === false ? t('easyPdf.status.offline') : t('easyPdf.status.checking')}
          </span>
        </button>

        {/* Seletor de abas: linha própria (com rolagem horizontal) até lg, inline a partir de lg */}
        <div className="order-last lg:order-none w-full lg:w-auto min-w-0 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-0.5 lg:mx-0 lg:px-0 lg:pb-0 lg:overflow-visible">
          <Segmented value={tab} onChange={(v) => { setTab(v); if (v !== 'tools') setActiveToolState(null); }} options={tabs} size="sm" className="w-max min-w-full lg:min-w-0 justify-between lg:justify-start bg-slate-100/80 ring-1 ring-inset ring-slate-200/70" />
        </div>

        <div className="order-3 lg:order-none shrink-0">
          <UserMenu />
        </div>

        <div className="brand-hairline absolute left-0 right-0 -bottom-px pointer-events-none" />
      </header>

      {/* Body: acima do header (z-20) para que o modo tela cheia do Design Studio,
          que e `fixed inset-0`, nao fique preso abaixo da barra do app. */}
      <div className="flex-1 min-h-0 relative z-30">
        {tab === 'tools' && (activeTool ? (activeTool.local === 'qr' ? <QrStudio tool={activeTool} onBack={() => setActiveToolState(null)} /> : activeTool.local === 'resize' ? <ImageResizeStudio tool={activeTool} onBack={() => setActiveToolState(null)} /> : activeTool.local === 'vectorize' ? <VectorizeStudio tool={activeTool} onBack={() => setActiveToolState(null)} /> : <ToolRunner tool={activeTool} initialFiles={chainFiles} onBack={() => setActiveToolState(null)} onChain={(t, f) => pickTool(t, f)} onOpenInEditor={openInEditor} />) : <ToolHub onPick={(t) => pickTool(t)} onOpenEditor={() => setTab('editor')} engineOk={health} onRetry={probe} />)}
        {tab === 'studio' && (user || !ready ? <WorkspacePage engineOk={health} onRetry={probe} onOpenInEditor={openInEditor} /> : <AccountGate area="studio" />)}
        {tab === 'docs' && <DocumentHistory onOpenInEditor={openInEditor} onUseInTool={(t, f) => pickTool(t, f)} />}
        {tab === 'editor' && (user || !ready ? <StudioPage initialFile={studioFile} onConsumedInitialFile={() => setStudioFile(null)} /> : <AccountGate area="editor" />)}
      </div>
    </div>
  );
};

export default EasyPdf;
