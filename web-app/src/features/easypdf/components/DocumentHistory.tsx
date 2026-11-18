import { useEffect, useMemo, useState } from 'react';
import { Search, Download, Trash2, FileText, Wrench, PenTool, Upload, Eye, Clock, LayoutGrid, List, CheckSquare, Square, X } from 'lucide-react';
import { cn, Button, EmptyState, Badge, Modal, useToast, Segmented, ConfirmDialog } from '../../../components/ui';
import { listDocuments, getDocumentBlob, deleteDocument, downloadBlob, humanSize, saveDocument, type StoredDocument } from '../history';
import { PDF_TOOLS, type PdfTool } from '../tools';

interface Props {
  onOpenInEditor: (file: File) => void;
  onUseInTool: (tool: PdfTool, files: File[]) => void;
}

const DocumentHistory = ({ onOpenInEditor, onUseInTool }: Props) => {
  const toast = useToast();
  const [docs, setDocs] = useState<StoredDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [toolFor, setToolFor] = useState<StoredDocument | null>(null);
  const [toDelete, setToDelete] = useState<StoredDocument | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    setDocs(await listDocuments());
    setSelected(new Set());
    setLoading(false);
  };
  useEffect(() => {
    void reload();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? docs.filter((d) => `${d.name} ${d.toolName || ''}`.toLowerCase().includes(q)) : docs;
  }, [docs, query]);

  const toFile = async (d: StoredDocument) => {
    const blob = await getDocumentBlob(d.id);
    if (!blob) throw new Error('Arquivo não encontrado no armazenamento local');
    return new File([blob], d.name, { type: d.contentType });
  };

  const download = async (d: StoredDocument) => {
    try {
      const blob = await getDocumentBlob(d.id);
      if (blob) downloadBlob(blob, d.name);
    } catch (e) {
      toast.error('Falha ao baixar', e instanceof Error ? e.message : undefined);
    }
  };
  const remove = async (d: StoredDocument) => {
    await deleteDocument(d.id);
    setToDelete(null);
    toast.success('Documento removido');
    void reload();
  };
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  /** marca/desmarca tudo o que está visível agora (respeita a busca) */
  const toggleAll = () => setSelected((prev) => (filtered.every((d) => prev.has(d.id)) ? new Set() : new Set(filtered.map((d) => d.id))));
  const removeSelected = async () => {
    setBulkBusy(true);
    const ids = [...selected];
    try {
      for (const id of ids) await deleteDocument(id);
      toast.success(ids.length === 1 ? 'Documento removido' : `${ids.length} documentos removidos`);
    } catch (e) {
      toast.error('Falha ao excluir', e instanceof Error ? e.message : undefined);
    } finally {
      setBulkBusy(false);
      setBulkOpen(false);
      void reload();
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      await saveDocument(f, { name: f.name, contentType: f.type || 'application/octet-stream', kind: f.type.includes('pdf') ? 'pdf' : f.type.startsWith('image/') ? 'image' : 'other', source: 'upload' });
    }
    toast.success(files.length === 1 ? 'Arquivo adicionado' : `${files.length} arquivos adicionados`);
    void reload();
  };

  const allSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));
  const someSelected = selected.size > 0;

  const sourceIcon: Partial<Record<StoredDocument['source'], typeof Wrench>> = { tool: Wrench, editor: PenTool, upload: Upload };
  const sourceLabel: Partial<Record<StoredDocument['source'], string>> = { tool: 'Ferramenta', editor: 'Editor visual', upload: 'Enviado' };
  const fmtDate = (ts: number, long = false) => new Date(ts).toLocaleString(undefined, long ? undefined : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar documento ou ferramenta…" className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10" />
          </div>
          <Segmented value={view} onChange={setView} size="sm" options={[{ value: 'grid', label: 'Grade', icon: LayoutGrid }, { value: 'list', label: 'Lista', icon: List }]} />
          <label className="inline-flex">
            <input type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} accept="application/pdf,image/*" />
            <span className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-brand-600 text-white text-sm font-semibold cursor-pointer hover:bg-brand-700">
              <Upload className="w-4 h-4" /> Adicionar arquivos
            </span>
          </label>
        </div>

        {!loading && filtered.length > 0 && (
          <div className={cn('flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 transition-colors', someSelected ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white')}>
            <button
              type="button"
              onClick={toggleAll}
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-brand-700"
            >
              {allSelected ? <CheckSquare className="w-4 h-4 text-brand-600" /> : <Square className="w-4 h-4 text-slate-400" />}
              {allSelected ? 'Desmarcar tudo' : query.trim() ? `Selecionar os ${filtered.length} filtrados` : `Selecionar tudo (${filtered.length})`}
            </button>
            {someSelected && (
              <>
                <span className="text-xs text-slate-500 tabular-nums">{selected.size} selecionado{selected.size > 1 ? 's' : ''}</span>
                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="ghost" icon={X} onClick={() => setSelected(new Set())}>Limpar</Button>
                  <Button size="sm" variant="danger" icon={Trash2} onClick={() => setBulkOpen(true)}>Excluir selecionados</Button>
                </div>
              </>
            )}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-500 py-10 text-center">Carregando…</p>
        ) : filtered.length === 0 ? (
          <EmptyState icon={FileText} title={query ? 'Nada encontrado' : 'Nenhum documento ainda'} description="Resultados das ferramentas, PDFs do editor e arquivos enviados ficam guardados aqui, só no seu dispositivo." />
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filtered.map((d) => {
              const Icon = sourceIcon[d.source] || FileText;
              return (
                <div key={d.id} className={cn('surface overflow-hidden group flex flex-col transition-shadow', selected.has(d.id) && 'ring-2 ring-brand-500 ring-offset-1')}>
                  <div className="aspect-[3/4] bg-slate-100 relative overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleOne(d.id)}
                      className={cn(
                        'absolute top-2 left-2 z-10 grid place-items-center h-7 w-7 rounded-lg border shadow-sm transition-opacity',
                        selected.has(d.id) ? 'bg-brand-600 border-brand-600 text-white opacity-100' : 'bg-white/95 border-slate-300 text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100'
                      )}
                      aria-label={selected.has(d.id) ? `Desmarcar ${d.name}` : `Selecionar ${d.name}`}
                      aria-pressed={selected.has(d.id)}
                    >
                      {selected.has(d.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>
                    {d.thumbnail ? <img src={d.thumbnail} alt="" className="w-full h-full object-cover object-top" /> : <div className="w-full h-full flex items-center justify-center text-slate-300"><FileText className="w-12 h-12" /></div>}
                    <div className="absolute inset-0 bg-slate-900/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                      <button onClick={() => void download(d)} className="p-2 rounded-lg bg-white text-slate-800 hover:bg-slate-100" title="Baixar"><Download className="w-4 h-4" /></button>
                      {d.kind === 'pdf' && <button onClick={() => setToolFor(d)} className="p-2 rounded-lg bg-white text-slate-800 hover:bg-slate-100" title="Usar em ferramenta"><Wrench className="w-4 h-4" /></button>}
                      {d.kind === 'pdf' && <button onClick={() => toFile(d).then(onOpenInEditor).catch((e) => toast.error('Erro', e.message))} className="p-2 rounded-lg bg-white text-slate-800 hover:bg-slate-100" title="Editor visual"><PenTool className="w-4 h-4" /></button>}
                      <button onClick={() => setToDelete(d)} className="p-2 rounded-lg bg-rose-500 text-white hover:bg-rose-600" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-semibold text-slate-800 truncate" title={d.name}>{d.name}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                      <Icon className="w-3 h-3" /> {d.toolName || sourceLabel[d.source] || 'Documento'} · {humanSize(d.size)}{d.pages ? ` · ${d.pages} pág.` : ''}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtDate(d.createdAt)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="surface overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 w-10">
                    <button type="button" onClick={toggleAll} aria-label={allSelected ? 'Desmarcar tudo' : 'Selecionar tudo'} className="align-middle">
                      {allSelected ? <CheckSquare className="w-4 h-4 text-brand-600" /> : <Square className="w-4 h-4 text-slate-400" />}
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5">Documento</th>
                  <th className="text-left px-4 py-2.5">Origem</th>
                  <th className="text-left px-4 py-2.5">Tamanho</th>
                  <th className="text-left px-4 py-2.5">Data</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((d) => (
                  <tr key={d.id} className={cn('hover:bg-slate-50/60', selected.has(d.id) && 'bg-brand-50/60')}>
                    <td className="px-4 py-2.5">
                      <button type="button" onClick={() => toggleOne(d.id)} aria-label={selected.has(d.id) ? `Desmarcar ${d.name}` : `Selecionar ${d.name}`} aria-pressed={selected.has(d.id)} className="align-middle">
                        {selected.has(d.id) ? <CheckSquare className="w-4 h-4 text-brand-600" /> : <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800 truncate max-w-[360px]">{d.name}</td>
                    <td className="px-4 py-2.5"><Badge tone="neutral">{d.toolName || sourceLabel[d.source] || 'Documento'}</Badge></td>
                    <td className="px-4 py-2.5 text-slate-500">{humanSize(d.size)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{fmtDate(d.createdAt, true)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => void download(d)} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100" title="Baixar"><Download className="w-4 h-4" /></button>
                        {d.kind === 'pdf' && <button onClick={() => setToolFor(d)} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100" title="Usar em ferramenta"><Wrench className="w-4 h-4" /></button>}
                        {d.kind === 'pdf' && <button onClick={() => getDocumentBlob(d.id).then((b) => b && window.open(URL.createObjectURL(b), '_blank'))} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100" title="Visualizar"><Eye className="w-4 h-4" /></button>}
                        <button onClick={() => setToDelete(d)} className="p-1.5 rounded-md text-rose-500 hover:bg-rose-50" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={Boolean(toolFor)} onClose={() => setToolFor(null)} title="Usar em ferramenta" description={toolFor?.name} size="md">
        <div className="p-4 grid grid-cols-2 gap-2">
          {PDF_TOOLS.filter((t) => t.accept === undefined || t.accept === 'application/pdf').map((t) => (
            <button key={t.id} onClick={() => toolFor && toFile(toolFor).then((f) => { onUseInTool(t, [f]); setToolFor(null); }).catch((e) => toast.error('Erro', e.message))} className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 hover:border-brand-300 hover:bg-brand-50 text-left')}>
              <t.icon className="w-4 h-4 text-brand-600 shrink-0" />
              <span className="text-sm font-semibold text-slate-800 truncate">{t.name}</span>
            </button>
          ))}
        </div>
        <div className="px-4 pb-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setToolFor(null)}>Cancelar</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onConfirm={() => void removeSelected()}
        loading={bulkBusy}
        title={selected.size === 1 ? 'Excluir documento?' : `Excluir ${selected.size} documentos?`}
        description={`${selected.size === 1 ? 'O arquivo selecionado será removido' : 'Os arquivos selecionados serão removidos'} do seu histórico neste dispositivo. Esta ação não pode ser desfeita.`}
        confirmLabel={selected.size === 1 ? 'Excluir' : `Excluir ${selected.size}`}
        tone="danger"
      />

      <ConfirmDialog open={Boolean(toDelete)} onClose={() => setToDelete(null)} onConfirm={() => toDelete && void remove(toDelete)} title="Excluir documento?" description={toDelete ? `“${toDelete.name}” será removido do seu histórico. Esta ação não pode ser desfeita.` : undefined} confirmLabel="Excluir" tone="danger" />
    </div>
  );
};

export default DocumentHistory;
