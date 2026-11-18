import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Copy, Download, FilePlus2, FileText, FolderOpen, Layers, LayoutGrid, Loader2, Merge, PenTool, Plus, RotateCcw, RotateCw, Save, Scissors, Trash2, Undo2, Redo2, X, ArrowUpDown, Eraser, ExternalLink, WifiOff, Sparkles } from 'lucide-react';
import { Button, cn, ConfirmDialog, Kbd, Modal, Tooltip, useToast } from '../../components/ui';
import { downloadBlob, humanSize, saveDocument } from '../easypdf/history';
import { ENGINE_OFFLINE_MESSAGE } from '../easypdf/engineClient';
import { materialize, splitGroups, type VirtualPage } from './engine';
import { useWorkspace } from './useWorkspace';
import PageGrid, { type SelectMode } from './PageGrid';
import PageViewer from './PageViewer';
import ToolPanel from './ToolPanel';

interface Props {
  engineOk: boolean | null;
  onRetry: () => void;
  onOpenInEditor?: (file: File) => void;
}

const ACCEPT = '.pdf,application/pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.html,.md';
const SIZES = { S: 150, M: 210, L: 300 } as const;
type SizeKey = keyof typeof SIZES;

const stripPdf = (n: string) => n.replace(/\.pdf$/i, '');

const WorkspacePage = ({ engineOk, onRetry, onOpenInEditor }: Props) => {
  const ws = useWorkspace();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [size, setSize] = useState<SizeKey>('M');
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [splitEvery, setSplitEvery] = useState<number | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [requestedTool, setRequestedTool] = useState<string | null>(null);

  const { active, docs, selection } = ws;
  const pages = useMemo(() => active?.pages ?? [], [active]);
  const order = useMemo(() => pages.map((p) => p.key), [pages]);
  const viewerIndex = viewerKey ? pages.findIndex((p) => p.key === viewerKey) : -1;
  const viewerPage: VirtualPage | null = viewerIndex >= 0 ? pages[viewerIndex] : null;
  const breakCount = pages.filter((p) => p.breakAfter).length;
  const selCount = selection.size;

  // ---------------------------------------------------------------- import
  const importFiles = useCallback(
    async (list: FileList | File[] | null) => {
      const files = Array.from(list ?? []);
      if (!files.length) return;
      const r = await ws.addFiles(files);
      if (r.failed.length) toast.error('Alguns arquivos não puderam ser abertos', r.failed.join(', '));
      else if (r.ok > 1) toast.success(`${r.ok} documentos abertos`);
    },
    [ws, toast]
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    importFiles(e.dataTransfer.files);
  };

  // ---------------------------------------------------------------- output
  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast.error('Não foi possível concluir', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const downloadAll = () =>
    withBusy('Gerando PDF…', async () => {
      const f = await ws.materializeActive();
      if (f) downloadBlob(f, f.name);
    });

  const downloadSplit = () =>
    withBusy('Dividindo…', async () => {
      if (!active) return;
      const groups = splitGroups(active.pages);
      const base = stripPdf(active.name);
      for (let i = 0; i < groups.length; i++) {
        const f = await materialize(groups[i], `${base}-${i + 1}.pdf`);
        downloadBlob(f, f.name);
        if (i < groups.length - 1) await new Promise((r) => setTimeout(r, 400));
      }
      toast.success(`${groups.length} arquivos gerados`);
    });

  const downloadSelection = () =>
    withBusy('Gerando PDF…', async () => {
      if (!active || !selCount) return;
      const f = await materialize(active.pages.filter((p) => selection.has(p.key)), `${stripPdf(active.name)}-selecao.pdf`);
      downloadBlob(f, f.name);
    });

  const saveToHistory = () =>
    withBusy('Salvando…', async () => {
      const f = await ws.materializeActive();
      if (!f) return;
      await saveDocument(f, { name: f.name, contentType: 'application/pdf', kind: 'pdf', source: 'tool', toolId: 'studio', toolName: 'Studio' });
      toast.success('Salvo em Documentos', f.name);
    });

  const openInEditor = () =>
    withBusy('Abrindo no editor…', async () => {
      const f = await ws.materializeActive();
      if (f && onOpenInEditor) onOpenInEditor(f);
    });

  const getAllFiles = useCallback(async () => {
    const ordered = active ? [active, ...docs.filter((d) => d.id !== active.id)] : docs;
    const out: File[] = [];
    for (const d of ordered) out.push(await materialize(d.pages, d.name));
    return out;
  }, [active, docs]);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (!active) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) ws.redo();
        else ws.undo();
      } else if (meta && e.key.toLowerCase() === 'a' && !viewerPage) {
        e.preventDefault();
        ws.selectAll();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selCount && !viewerPage) {
        e.preventDefault();
        ws.remove();
      } else if (e.key.toLowerCase() === 'r' && !meta) {
        if (viewerPage) ws.rotate(e.shiftKey ? -90 : 90, [viewerPage.key]);
        else if (selCount) ws.rotate(e.shiftKey ? -90 : 90);
      } else if (e.key === 'Escape') {
        if (viewerPage) setViewerKey(null);
        else ws.clearSelection();
      } else if (viewerPage && e.key === 'ArrowLeft' && viewerIndex > 0) setViewerKey(pages[viewerIndex - 1].key);
      else if (viewerPage && e.key === 'ArrowRight' && viewerIndex < pages.length - 1) setViewerKey(pages[viewerIndex + 1].key);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [ws, active, selCount, viewerPage, viewerIndex, pages]);

  const onSelect = (key: string, mode: SelectMode) => ws.select(key, mode, order);

  // ---------------------------------------------------------------- render helpers
  const startRename = () => {
    if (!active) return;
    setNameDraft(stripPdf(active.name));
    setEditingName(true);
  };
  const commitRename = () => {
    if (active) ws.renameDoc(active.id, nameDraft);
    setEditingName(false);
  };

  const emptyState = (
    <div className="flex-1 min-h-0 flex items-center justify-center p-8">
      <div className="max-w-xl w-full text-center">
        <div className="mx-auto w-16 h-16 rounded-2xl brand-gradient text-white flex items-center justify-center shadow-brand mb-5">
          <Layers className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Área de trabalho</h2>
        <p className="mt-2 text-slate-500">Abra PDFs, imagens ou documentos do Office. Organize, gire, divida e junte páginas e aplique qualquer ferramenta sem sair daqui.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button icon={FolderOpen} size="lg" onClick={() => fileInput.current?.click()} loading={ws.importing}>
            Abrir arquivos
          </Button>
          <Button
            variant="outline"
            size="lg"
            icon={FilePlus2}
            onClick={async () => {
              const blank = await materialize([{ key: 'b', src: '__blank__', index: 0, rotation: 0 }], 'Novo documento.pdf');
              await ws.openFile(blank);
            }}
          >
            Documento em branco
          </Button>
        </div>
        <p className="mt-6 text-xs text-slate-400">ou arraste os arquivos para qualquer lugar desta área</p>
      </div>
    </div>
  );

  return (
    <div
      className={cn('relative h-[calc(100vh-9.5rem)] min-h-[560px] rounded-2xl surface overflow-hidden flex flex-col', dragOver && 'ring-2 ring-brand-500')}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => importFiles(e.target.files).then(() => (e.target.value = ''))} />

      {/* ------------------------------------------------ top bar */}
      <div className="h-14 px-3 flex items-center gap-2 border-b border-slate-200/70 bg-white/80 backdrop-blur shrink-0">
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => fileInput.current?.click()} loading={ws.importing}>
          Adicionar
        </Button>
        {active && (
          <>
            <span className="h-6 w-px bg-slate-200 mx-1" />
            {editingName ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                className="h-8 px-2 rounded-lg text-sm font-semibold text-slate-900 bg-white ring-2 ring-brand-500 outline-none w-64"
              />
            ) : (
              <button onClick={startRename} title="Renomear" className="h-8 px-2 rounded-lg text-sm font-semibold text-slate-900 hover:bg-slate-100 truncate max-w-72 text-left">
                {active.name}
              </button>
            )}
            <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap hidden sm:inline">
              {pages.length} {pages.length === 1 ? 'página' : 'páginas'}
              {active.lastTool && <span className="hidden lg:inline"> · {active.lastTool}</span>}
            </span>
            <span className="h-6 w-px bg-slate-200 mx-1" />
            <Tooltip label="Desfazer (⌘Z)">
              <Button size="icon" variant="ghost" icon={Undo2} disabled={!ws.canUndo} onClick={ws.undo} aria-label="Desfazer" />
            </Tooltip>
            <Tooltip label="Refazer (⇧⌘Z)">
              <Button size="icon" variant="ghost" icon={Redo2} disabled={!ws.canRedo} onClick={ws.redo} aria-label="Refazer" />
            </Tooltip>
            <span className="h-6 w-px bg-slate-200 mx-1 hidden md:block" />
            <div className="hidden md:flex items-center rounded-lg bg-slate-100 p-0.5">
              {(Object.keys(SIZES) as SizeKey[]).map((k) => (
                <button key={k} onClick={() => setSize(k)} className={cn('h-7 w-8 rounded-md text-[11px] font-bold transition-colors', size === k ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                  {k}
                </button>
              ))}
            </div>
            <Tooltip label={viewerPage ? 'Ver grade de páginas' : 'Abrir página selecionada'}>
              <Button size="icon" variant="ghost" icon={viewerPage ? LayoutGrid : FileText} aria-label="Alternar visualização" onClick={() => setViewerKey(viewerPage ? null : (Array.from(selection)[0] ?? pages[0]?.key ?? null))} />
            </Tooltip>
          </>
        )}
        <div className="flex-1" />
        {engineOk === false && (
          <button onClick={onRetry} className="hidden lg:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full text-[11px] font-bold bg-gold-50 text-gold-700 ring-1 ring-inset ring-gold-600/15 hover:bg-gold-100" title={ENGINE_OFFLINE_MESSAGE}>
            <WifiOff className="w-3.5 h-3.5" /> Processamento offline · verificar
          </button>
        )}
        {active && (
          <>
            {onOpenInEditor && (
              <Tooltip label="Abrir no editor visual">
                <Button size="sm" variant="ghost" icon={PenTool} onClick={openInEditor} disabled={Boolean(busy)}>
                  <span className="hidden xl:inline">Editor</span>
                </Button>
              </Tooltip>
            )}
            <Button size="sm" variant="secondary" icon={Save} onClick={saveToHistory} disabled={Boolean(busy)}>
              <span className="hidden lg:inline">Salvar nos documentos</span>
              <span className="lg:hidden">Salvar</span>
            </Button>
            <div className="relative">
              <Button size="sm" icon={busy ? Loader2 : Download} iconRight={ChevronDown} onClick={() => setDownloadOpen((o) => !o)} disabled={Boolean(busy)}>
                {busy ?? 'Baixar'}
              </Button>
              <AnimatePresence>
                {downloadOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setDownloadOpen(false)} />
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }} className="absolute right-0 top-full mt-1.5 w-72 rounded-xl bg-white shadow-xl ring-1 ring-slate-900/10 p-1.5 z-40">
                      {[
                        { icon: FileText, label: 'PDF completo', hint: `${pages.length} páginas em um arquivo`, run: downloadAll, disabled: false },
                        { icon: Scissors, label: 'Separado nos marcadores', hint: breakCount ? `${breakCount + 1} arquivos` : 'Adicione marcadores de divisão entre as páginas', run: downloadSplit, disabled: !breakCount },
                        { icon: Copy, label: 'Somente a seleção', hint: selCount ? `${selCount} ${selCount === 1 ? 'página' : 'páginas'}` : 'Selecione páginas na grade', run: downloadSelection, disabled: !selCount }
                      ].map((it) => (
                        <button
                          key={it.label}
                          disabled={it.disabled}
                          onClick={() => {
                            setDownloadOpen(false);
                            it.run();
                          }}
                          className="w-full flex items-start gap-3 px-2.5 py-2 rounded-lg text-left hover:bg-brand-50 disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          <it.icon className="w-4 h-4 mt-0.5 text-brand-600 shrink-0" />
                          <span>
                            <span className="block text-sm font-semibold text-slate-800">{it.label}</span>
                            <span className="block text-[11px] text-slate-500">{it.hint}</span>
                          </span>
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>

      {/* ------------------------------------------------ body */}
      <div className="flex-1 min-h-0 flex">
        {/* files */}
        <aside className="w-60 shrink-0 border-r border-slate-200/70 bg-slate-50/60 flex flex-col min-h-0">
          <div className="px-3 h-10 flex items-center justify-between shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Arquivos · {docs.length}</span>
            {docs.length > 1 && (
              <Tooltip label="Juntar todos no documento ativo">
                <button onClick={ws.mergeAll} className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-500 hover:bg-white hover:text-brand-700 hover:shadow-sm" aria-label="Juntar todos">
                  <Merge className="w-4 h-4" />
                </button>
              </Tooltip>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-1">
            {docs.map((d) => {
              const isActive = d.id === ws.activeId;
              return (
                <div key={d.id} className={cn('group relative rounded-xl px-2.5 py-2 cursor-pointer transition-all', isActive ? 'bg-white shadow-sm ring-1 ring-brand-500/40' : 'hover:bg-white/70')} onClick={() => ws.activate(d.id)}>
                  <div className="flex items-center gap-2">
                    <span className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', isActive ? 'brand-gradient text-white' : 'bg-slate-200/70 text-slate-500')}>
                      <FileText className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-xs font-semibold truncate', isActive ? 'text-slate-900' : 'text-slate-700')}>{d.name}</p>
                      <p className="text-[10px] text-slate-400 tabular-nums">
                        {d.pages.length} pág. {d.size ? `· ${humanSize(d.size)}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (d.past.length) setClosing(d.id);
                        else ws.closeDoc(d.id);
                      }}
                      className="h-6 w-6 rounded-md flex items-center justify-center text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600"
                      aria-label="Fechar"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {!isActive && active && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        ws.appendDoc(d.id);
                        toast.success('Páginas adicionadas', `${d.pages.length} páginas de ${d.name}`);
                      }}
                      className="mt-1 w-full h-6 rounded-md text-[10px] font-semibold text-brand-700 bg-brand-50 opacity-0 group-hover:opacity-100 hover:bg-brand-100 transition-opacity"
                    >
                      Adicionar ao documento ativo
                    </button>
                  )}
                </div>
              );
            })}
            {!docs.length && <p className="px-2 pt-2 text-[11px] text-slate-400">Nenhum arquivo aberto.</p>}
          </div>
          {active && (
            <div className="p-2 border-t border-slate-200/70 space-y-1 shrink-0">
              <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Ações rápidas</p>
              {[
                { icon: ArrowUpDown, label: 'Inverter ordem', run: ws.reverse },
                { icon: FilePlus2, label: 'Página em branco no fim', run: () => ws.insertBlank() },
                { icon: Scissors, label: 'Dividir a cada N páginas', run: () => setSplitEvery(2) },
                { icon: Eraser, label: 'Limpar marcadores', run: ws.clearBreaks, disabled: !breakCount },
                { icon: Sparkles, label: 'Selecionar pares / ímpares', run: () => ws.selectByPredicate((_, i) => i % 2 === 1) }
              ].map((a) => (
                <button key={a.label} onClick={a.run} disabled={a.disabled} className="w-full flex items-center gap-2 h-8 px-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-white hover:text-brand-700 hover:shadow-sm disabled:opacity-40 disabled:hover:bg-transparent">
                  <a.icon className="w-3.5 h-3.5" /> {a.label}
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* canvas */}
        <main className="flex-1 min-w-0 min-h-0 relative canvas-grid flex flex-col">
          {!active ? (
            emptyState
          ) : viewerPage ? (
            <PageViewer
              page={viewerPage}
              number={viewerIndex + 1}
              total={pages.length}
              zoom={zoom}
              onZoom={setZoom}
              onPrev={() => viewerIndex > 0 && setViewerKey(pages[viewerIndex - 1].key)}
              onNext={() => viewerIndex < pages.length - 1 && setViewerKey(pages[viewerIndex + 1].key)}
              onRotate={(d) => ws.rotate(d, [viewerPage.key])}
              onBackToGrid={() => setViewerKey(null)}
            />
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto" onClick={(e) => e.target === e.currentTarget && ws.clearSelection()}>
              <PageGrid
                pages={pages}
                selection={selection}
                thumbWidth={SIZES[size]}
                onSelect={onSelect}
                onMove={ws.move}
                onOpen={(k) => {
                  setViewerKey(k);
                  ws.select(k, 'single', order);
                }}
                onRotate={(k, d) => ws.rotate(d, selection.has(k) ? undefined : [k])}
                onRemove={(k) => ws.remove(selection.has(k) ? undefined : [k])}
                onToggleBreak={(k) => ws.toggleBreak([k])}
                onInsertBlank={(k) => ws.insertBlank(k)}
              />
            </div>
          )}

          {/* selection bar */}
          <AnimatePresence>
            {active && !viewerPage && selCount > 0 && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.16 }} className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20">
                <div className="glass rounded-2xl shadow-2xl ring-1 ring-slate-900/10 px-2 py-1.5 flex items-center gap-1 whitespace-nowrap">
                  <span className="px-2 text-xs font-bold text-slate-800 tabular-nums">
                    {selCount} {selCount === 1 ? 'página' : 'páginas'}
                  </span>
                  <span className="h-5 w-px bg-slate-200" />
                  <Tooltip label="Girar à esquerda (⇧R)">
                    <Button size="icon" variant="ghost" icon={RotateCcw} onClick={() => ws.rotate(-90)} aria-label="Girar à esquerda" />
                  </Tooltip>
                  <Tooltip label="Girar à direita (R)">
                    <Button size="icon" variant="ghost" icon={RotateCw} onClick={() => ws.rotate(90)} aria-label="Girar à direita" />
                  </Tooltip>
                  <Button size="sm" variant="ghost" icon={Copy} onClick={() => ws.duplicate()}>
                    Duplicar
                  </Button>
                  <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => ws.extractSelection(true)}>
                    Extrair
                  </Button>
                  <Button size="sm" variant="ghost" icon={Scissors} onClick={() => ws.toggleBreak()}>
                    Dividir
                  </Button>
                  <Button size="sm" variant="ghost" icon={Trash2} className="text-rose-600 hover:bg-rose-50" onClick={() => ws.remove()} disabled={selCount >= pages.length}>
                    Excluir
                  </Button>
                  <span className="h-5 w-px bg-slate-200" />
                  <Tooltip label="Limpar seleção (Esc)">
                    <Button size="icon" variant="ghost" icon={X} onClick={ws.clearSelection} aria-label="Limpar seleção" />
                  </Tooltip>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {active && !viewerPage && selCount === 0 && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 hidden xl:flex items-center gap-3 text-[11px] text-slate-400">
              <span>
                <Kbd>clique</Kbd> selecionar
              </span>
              <span>
                <Kbd>⇧</Kbd> intervalo
              </span>
              <span>
                <Kbd>⌘</Kbd> vários
              </span>
              <span>arraste para reordenar</span>
              <span>
                <Kbd>duplo clique</Kbd> abrir
              </span>
            </div>
          )}
        </main>

        {/* tools */}
        <aside className="w-80 shrink-0 border-l border-slate-200/70 bg-white flex flex-col min-h-0">
          <ToolPanel
            engineOk={engineOk}
            hasDocument={Boolean(active)}
            docName={active?.name}
            getActiveFile={ws.materializeActive}
            getAllFiles={getAllFiles}
            onPdfResult={ws.replaceActive}
            onNewPdf={async (f, tool) => {
              await ws.openFile(f, { lastTool: tool });
            }}
            requestedToolId={requestedTool}
            onConsumedRequest={() => setRequestedTool(null)}
          />
        </aside>
      </div>

      {/* drag overlay */}
      <AnimatePresence>
        {dragOver && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 bg-brand-600/10 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
            <div className="rounded-2xl bg-white shadow-2xl px-8 py-6 text-center ring-2 ring-brand-500 ring-dashed">
              <FolderOpen className="w-8 h-8 text-brand-600 mx-auto mb-2" />
              <p className="font-bold text-slate-900">Solte para abrir</p>
              <p className="text-xs text-slate-500">PDF, imagens ou documentos do Office</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* split every N */}
      <Modal
        open={splitEvery !== null}
        onClose={() => setSplitEvery(null)}
        title="Dividir a cada N páginas"
        description="Coloca um marcador de divisão a cada N páginas. Depois, baixe com “Separado nos marcadores”."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSplitEvery(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (splitEvery && splitEvery > 0) ws.breakEvery(splitEvery);
                setSplitEvery(null);
              }}
            >
              Aplicar
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-3">
          <input type="number" min={1} max={Math.max(1, pages.length - 1)} value={splitEvery ?? 2} onChange={(e) => setSplitEvery(Math.max(1, Number(e.target.value) || 1))} className="h-10 w-24 px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-brand-500 outline-none text-sm font-semibold" />
          <span className="text-sm text-slate-500">
            páginas → {splitEvery ? Math.ceil(pages.length / splitEvery) : 0} arquivos
          </span>
        </div>
      </Modal>

      <ConfirmDialog open={Boolean(closing)} onClose={() => setClosing(null)} onConfirm={() => closing && (ws.closeDoc(closing), setClosing(null))} title="Fechar documento?" description="As alterações feitas aqui serão perdidas se você não baixou ou salvou o arquivo." confirmLabel="Fechar" />
    </div>
  );
};

export default WorkspacePage;
