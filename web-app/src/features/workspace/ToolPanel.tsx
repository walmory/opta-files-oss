import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Download, Loader2, Play, Search, WifiOff, CheckCircle2, AlertTriangle, FileText } from 'lucide-react';
import { Badge, Button, cn, Input, useToast } from '../../components/ui';
import { EDITOR_TOOL_ID, PDF_TOOLS, TOOL_GROUPS, type PdfTool, type ToolGroup } from '../easypdf/tools';
import { ENGINE_OFFLINE_MESSAGE, runTool, type ToolResult } from '../easypdf/engineClient';
import { downloadBlob, humanSize, pushRecentTool, saveDocument } from '../easypdf/history';
import OptionFields, { defaultValues, isRequiredSatisfied } from '../easypdf/components/OptionFields';

interface Props {
  engineOk: boolean | null;
  hasDocument: boolean;
  docName?: string;
  /** Materialises the active document (current page arrangement). */
  getActiveFile: () => Promise<File | null>;
  /** Materialises every open document, active first (multi-file tools). */
  getAllFiles: () => Promise<File[]>;
  /** A PDF result replaces the active document. */
  onPdfResult: (file: File, toolName: string) => Promise<void>;
  /** A PDF produced from non-PDF inputs opens as a new document. */
  onNewPdf: (file: File, toolName: string) => Promise<void>;
  /** Externally requested tool (e.g. from a quick action). */
  requestedToolId?: string | null;
  onConsumedRequest?: () => void;
}

const GROUP_TONE: Record<ToolGroup, string> = {
  organizar: 'bg-brand-50 text-brand-700',
  editar: 'bg-accent-50 text-accent-700',
  converter: 'bg-sky-50 text-sky-700',
  seguranca: 'bg-rose-50 text-rose-700',
  avancado: 'bg-gold-50 text-gold-700',
  utilidades: 'bg-violet-50 text-violet-700'
};

const inputKind = (tool: PdfTool): 'pdf' | 'other' | 'none' => (tool.accept === '' ? 'none' : tool.accept && tool.accept !== 'application/pdf' ? 'other' : 'pdf');

const ToolPanel = ({ engineOk, hasDocument, docName, getActiveFile, getAllFiles, onPdfResult, onNewPdf, requestedToolId, onConsumedRequest }: Props) => {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [tool, setTool] = useState<PdfTool | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ToolResult | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const pick = (t: PdfTool | null) => {
    setTool(t);
    setValues(t ? defaultValues(t) : {});
    setExtraFiles([]);
    setError(null);
    setResult(null);
    setProgress(0);
  };

  // external "open this tool" request: applied during render, acknowledged after commit
  const [consumed, setConsumed] = useState<string | null>(null);
  if (requestedToolId && requestedToolId !== consumed) {
    setConsumed(requestedToolId);
    const t = PDF_TOOLS.find((x) => x.id === requestedToolId);
    if (t) pick(t);
  }
  useEffect(() => {
    if (requestedToolId) onConsumedRequest?.();
  }, [requestedToolId, onConsumedRequest]);

  const tools = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PDF_TOOLS.filter((t) => t.id !== EDITOR_TOOL_ID).filter((t) => !q || [t.name, t.description, ...(t.keywords ?? [])].some((s) => s.toLowerCase().includes(q)));
  }, [query]);

  const kind = tool ? inputKind(tool) : 'pdf';
  const canRun = Boolean(tool) && !running && engineOk !== false && isRequiredSatisfied(tool!, values) && (kind === 'none' || (kind === 'pdf' ? hasDocument : extraFiles.length > 0));

  const run = async () => {
    if (!tool) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(0);
    try {
      let files: File[] = [];
      if (kind === 'pdf') {
        files = tool.multiFile ? await getAllFiles() : [await getActiveFile()].filter((f): f is File => Boolean(f));
        if (!files.length) throw new Error('Abra um documento primeiro.');
        if (tool.minFiles && files.length < tool.minFiles) throw new Error(`Esta ferramenta precisa de pelo menos ${tool.minFiles} documentos abertos.`);
      } else if (kind === 'other') files = extraFiles;
      const res = await runTool(tool, files, values, setProgress);
      pushRecentTool(tool.id);
      if (res.kind === 'pdf') {
        const f = new File([res.blob], kind === 'pdf' && docName ? docName : res.fileName, { type: 'application/pdf' });
        if (kind === 'pdf') await onPdfResult(f, tool.name);
        else await onNewPdf(f, tool.name);
        toast.success(`${tool.name} aplicado`, `${humanSize(res.blob.size)} · ${(res.durationMs / 1000).toFixed(1)}s${kind === 'pdf' ? ' · Desfazer disponível' : ''}`);
        setResult(null);
      } else {
        if (res.kind !== 'json') await saveDocument(res.blob, { name: res.fileName, contentType: res.contentType, kind: res.kind, source: 'tool', toolId: tool.id, toolName: tool.name });
        setResult(res);
        toast.success(`${tool.name} concluído`, `${res.fileName} · ${humanSize(res.blob.size)}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      setError(msg);
    } finally {
      setRunning(false);
    }
  };

  // ------------------------------------------------------------------ list
  if (!tool) {
    return (
      <div className="h-full flex flex-col min-h-0">
        <div className="p-3 border-b border-slate-200/70 shrink-0">
          <Input icon={Search} placeholder="Buscar ferramenta…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-9" />
        </div>
        {engineOk === false && (
          <div className="mx-3 mt-3 rounded-xl bg-gold-50 text-gold-800 ring-1 ring-gold-600/15 p-3 text-xs flex gap-2">
            <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {ENGINE_OFFLINE_MESSAGE}
              <br />
              <span className="text-gold-700/80">Organizar, girar, dividir e juntar páginas continuam funcionando.</span>
            </span>
          </div>
        )}
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto p-2">
          {TOOL_GROUPS.map((g) => {
            const items = tools.filter((t) => t.group === g.id);
            if (!items.length) return null;
            return (
              <div key={g.id} className="mb-3">
                <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{g.label}</p>
                {items.map((t) => (
                  <button key={t.id} onClick={() => pick(t)} className="w-full flex items-center gap-3 px-2 py-2 rounded-xl text-left hover:bg-white hover:shadow-sm ring-1 ring-transparent hover:ring-slate-200 transition-all group">
                    <span className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', GROUP_TONE[t.group])}>
                      <t.icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-800 truncate">{t.name}</span>
                      <span className="block text-[11px] text-slate-500 truncate">{t.description}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-500 shrink-0" />
                  </button>
                ))}
              </div>
            );
          })}
          {!tools.length && <p className="p-6 text-center text-sm text-slate-400">Nenhuma ferramenta encontrada.</p>}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ tool form
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="p-3 border-b border-slate-200/70 flex items-center gap-2 shrink-0">
        <button onClick={() => pick(null)} className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100" aria-label="Voltar">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', GROUP_TONE[tool.group])}>
          <tool.icon className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate">{tool.name}</p>
          <p className="text-[11px] text-slate-500 truncate">{tool.description}</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {kind === 'pdf' && (
          <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200/80 p-3 text-xs text-slate-600 flex items-start gap-2">
            <FileText className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
            <span>
              {tool.multiFile ? (
                <>
                  Usa <b>todos os documentos abertos</b>, na ordem da lista à esquerda.
                </>
              ) : (
                <>
                  Aplica em <b className="text-slate-800">{docName ?? 'documento ativo'}</b> com as páginas como estão organizadas agora. O resultado substitui o documento e pode ser desfeito.
                </>
              )}
            </span>
          </div>
        )}
        {kind === 'other' && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">{tool.inputLabel ?? 'Arquivo de entrada'} *</label>
            <input type="file" accept={tool.accept} multiple={tool.multiFile} onChange={(e) => setExtraFiles(Array.from(e.target.files ?? []))} className="block w-full text-xs text-slate-600 file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:font-semibold hover:file:bg-slate-200" />
            <p className="mt-1 text-[11px] text-slate-400">O PDF gerado abre como um novo documento no Studio.</p>
          </div>
        )}

        <OptionFields tool={tool} values={values} onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))} />

        {error && (
          <div className="rounded-xl bg-rose-50 text-rose-700 ring-1 ring-rose-600/15 p-3 text-xs flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {result && (
          <div className="rounded-xl bg-accent-50 ring-1 ring-accent-600/15 p-3 text-xs space-y-2">
            <div className="flex items-center gap-2 text-accent-800 font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Pronto
              <Badge tone="neutral" className="ml-auto">
                {result.kind.toUpperCase()}
              </Badge>
            </div>
            <p className="text-slate-600 truncate">
              {result.fileName} · {humanSize(result.blob.size)}
            </p>
            {result.kind === 'json' && <pre className="max-h-48 overflow-auto rounded-lg bg-white p-2 text-[11px] text-slate-700 ring-1 ring-slate-200">{JSON.stringify(result.json, null, 2)}</pre>}
            <Button size="sm" variant="outline" icon={Download} onClick={() => downloadBlob(result.blob, result.fileName)} className="w-full">
              Baixar
            </Button>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-slate-200/70 shrink-0 space-y-2">
        {running && (
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full brand-gradient transition-all" style={{ width: `${Math.max(8, progress)}%` }} />
          </div>
        )}
        <Button className="w-full" icon={running ? Loader2 : Play} disabled={!canRun} onClick={run}>
          {running ? 'Processando…' : 'Aplicar'}
        </Button>
        {engineOk === false && <p className="text-[11px] text-center text-gold-700">{ENGINE_OFFLINE_MESSAGE}</p>}
      </div>
    </div>
  );
};

export default ToolPanel;
