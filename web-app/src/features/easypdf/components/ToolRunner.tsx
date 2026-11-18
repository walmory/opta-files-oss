import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, UploadCloud, X, Play, Download, Save, FileText, GripVertical, CheckCircle2, AlertCircle, Loader2, RotateCcw, PenTool, ArrowRight, Eye, ShieldCheck, Sparkles, Trash2, Move, Scissors, Layers } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn, Button, Input, Select, Switch, Textarea, Badge, useToast } from '../../../components/ui';
import { runTool, type ToolResult } from '../engineClient';
import { buildSplitZip, partFileName, type SplitSegment } from '../splitPlan';
import SplitStudio, { type SplitDraft } from './SplitStudio';
import { SignatureReport } from './SignatureReport';
import { saveDocument, downloadBlob, humanSize, renderPdfThumbnail } from '../history';
import { pushRecentTool } from '../history';
import { PDF_TOOLS, type PdfTool, type ToolOption } from '../tools';
import SignatureStudio, { type SignatureBundle } from './SignatureStudio';
import { applyOverlayToPdf, generateIdentity, type PdfOverlay } from '../signatureKit';
import PlacementStudio from './PlacementStudio';
import { DEFAULT_PLACEMENT, describePlacements, type Placement, type PlacementOverlay } from '../placement';

interface Props {
  tool: PdfTool;
  initialFiles?: File[];
  onBack: () => void;
  onChain: (tool: PdfTool, files: File[]) => void;
  onOpenInEditor: (file: File) => void;
}

interface InputFile {
  id: string;
  file: File;
  thumb?: string;
  pages?: number;
}

/** Ferramentas cuja posição é escolhida visualmente no PlacementStudio (aplicadas localmente com pdf-lib). */
/** mesmas cores do editor visual, para o preview do card bater com a tela de cortes */
const SPLIT_BARS = ['bg-brand-500', 'bg-emerald-500', 'bg-amber-500', 'bg-sky-500', 'bg-violet-500', 'bg-rose-500'];

const PLACEMENT_TOOLS = new Set(['cert-sign', 'stamp', 'add-image']);
/** Campos substituídos pelo posicionamento visual. */
const PLACEMENT_HIDDEN: Record<string, string[]> = {
  stamp: ['pageNumbers', 'position', 'fontSize', 'rotation', 'opacity', 'customMargin', 'alphabet'],
  'add-image': ['x', 'y', 'everyPage'],
  'cert-sign': ['pageNumber']
};
const isPdfFile = (f?: File) => !!f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));

const defaultsFor = (tool: PdfTool) => Object.fromEntries(tool.options.map((o) => [o.key, o.multiple && typeof o.default === 'string' ? [o.default] : o.default]));

const ToolRunner = ({ tool, initialFiles, onBack, onChain, onOpenInEditor }: Props) => {
  const toast = useToast();
  const [files, setFiles] = useState<InputFile[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>(() => defaultsFor(tool));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [resultThumb, setResultThumb] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const needsFile = tool.accept !== '';

  const [splitOpen, setSplitOpen] = useState(false);
  const [splitPlan, setSplitPlan] = useState<SplitSegment[] | null>(null);
  const [splitDraft, setSplitDraft] = useState<SplitDraft | null>(null);
  const splitKept = (splitPlan ?? []).filter((s) => s.keep !== false);
  const splitDropped = (splitPlan ?? []).length - splitKept.length;

  const handlePlanChange = useCallback((segments: SplitSegment[], draft: SplitDraft) => {
    setSplitPlan(segments);
    setSplitDraft(draft);
  }, []);

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      const arr = Array.from(list);
      const items: InputFile[] = arr.map((file) => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 6)}`, file }));
      setFiles((prev) => (tool.multiFile ? [...prev, ...items] : items.slice(0, 1)));
      // dividir: o editor visual É a ferramenta, então abre assim que o PDF entra
      if (tool.id === 'split' && items.some((it) => it.file.type === 'application/pdf')) {
        setSplitPlan(null);
        setSplitDraft(null);
        setSplitOpen(true);
      }
      items.forEach(async (it) => {
        if (it.file.type === 'application/pdf') {
          const { thumbnail, pages } = await renderPdfThumbnail(it.file, 160);
          setFiles((prev) => prev.map((f) => (f.id === it.id ? { ...f, thumb: thumbnail, pages } : f)));
        } else if (it.file.type.startsWith('image/')) {
          const url = URL.createObjectURL(it.file);
          setFiles((prev) => prev.map((f) => (f.id === it.id ? { ...f, thumb: url } : f)));
        }
      });
    },
    [tool.multiFile, tool.id]
  );

  useEffect(() => {
    setValues(defaultsFor(tool));
    setResult(null);
    setError(null);
    setFiles([]);
    if (initialFiles?.length) void addFiles(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.id]);

  useEffect(() => {
    if (!result) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(result.blob);
    setPreviewUrl(url);
    if (result.kind === 'pdf') renderPdfThumbnail(result.blob, 320).then((r) => setResultThumb(r.thumbnail));
    else if (result.kind === 'image') setResultThumb(url);
    else setResultThumb(undefined);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  const move = (from: number, to: number) => {
    setFiles((prev) => {
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  };

  const canRun = useMemo(() => {
    if (needsFile && files.length < (tool.minFiles || 1)) return false;
    return tool.options.filter((o) => o.required).every((o) => {
      const v = values[o.key];
      return v instanceof File || (Array.isArray(v) && v.length) || (typeof v === 'string' && v.trim()) || typeof v === 'number';
    });
  }, [files.length, needsFile, tool, values]);

  const [sigOpen, setSigOpen] = useState(false);
  const [sigVisual, setSigVisual] = useState<{ file: File; url: string } | null>(null);
  const [sigCertLabel, setSigCertLabel] = useState<string | null>(null);
  const [placement, setPlacement] = useState<Placement[]>([DEFAULT_PLACEMENT]);
  const [placed, setPlaced] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [runAfterPlace, setRunAfterPlace] = useState(false);
  const pdfInput = files.find((f) => isPdfFile(f.file))?.file;

  /** Elemento a posicionar, conforme a ferramenta. */
  const overlaySource: PdfOverlay | null = useMemo(() => {
    if (tool.id === 'cert-sign') return sigVisual ? { kind: 'image', file: sigVisual.file } : null;
    if (tool.id === 'add-image') return values.imageFile instanceof File ? { kind: 'image', file: values.imageFile } : null;
    if (tool.id === 'stamp') {
      if (values.stampType === 'image') return values.stampImage instanceof File ? { kind: 'image', file: values.stampImage } : null;
      const text = String(values.stampText ?? '').trim();
      return text ? { kind: 'text', text, color: String(values.customColor || '#2e8b3d') } : null;
    }
    return null;
  }, [tool.id, sigVisual, values.imageFile, values.stampType, values.stampImage, values.stampText, values.customColor]);

  const overlayUrl = useMemo(() => (overlaySource?.kind === 'image' ? URL.createObjectURL(overlaySource.file) : null), [overlaySource]);
  useEffect(() => () => { if (overlayUrl) URL.revokeObjectURL(overlayUrl); }, [overlayUrl]);

  const previewOverlay: PlacementOverlay | null = useMemo(() => (overlaySource ? (overlaySource.kind === 'image' ? (overlayUrl ? { kind: 'image', url: overlayUrl } : null) : overlaySource) : null), [overlaySource, overlayUrl]);

  // troca de ferramenta → posição volta ao padrão (estado derivado da prop, sem efeito)
  const [placeTool, setPlaceTool] = useState(tool.id);
  if (placeTool !== tool.id) {
    setPlaceTool(tool.id);
    setPlacement([{ ...DEFAULT_PLACEMENT, widthPct: tool.id === 'stamp' ? 22 : 28, opacity: tool.id === 'stamp' ? 0.7 : 1 }]);
    setPlaced(false);
    setPlaceOpen(false);
  }

  // assim que existir PDF + elemento e ainda não foi posicionado, abre o posicionador
  const autoOpenKey = overlaySource && pdfInput ? `${tool.id}:${overlaySource.kind === 'image' ? (overlaySource.file instanceof File ? overlaySource.file.name : 'blob') + overlaySource.file.size : 'text'}` : null;
  const lastAutoKey = useRef<string | null>(null);
  useEffect(() => {
    if (!autoOpenKey || !previewOverlay || placed) return;
    if (overlaySource?.kind === 'text') return; // texto: abre ao executar (evita abrir a cada letra digitada)
    if (lastAutoKey.current === autoOpenKey) return;
    lastAutoKey.current = autoOpenKey;
    setPlaceOpen(true);
  }, [autoOpenKey, previewOverlay, placed, overlaySource]);

  const applyPlacement = (list: Placement[]) => {
    const p = list.length ? list : [DEFAULT_PLACEMENT];
    setPlacement(p);
    setPlaced(true);
    setPlaceOpen(false);
    if (tool.id === 'cert-sign') setValues((prev) => ({ ...prev, pageNumber: Math.max(1, p[0].page) }));
    toast.success('Posição definida', describePlacements(p));
    if (runAfterPlace) {
      setRunAfterPlace(false);
      void run(p);
    }
  };

  const applySignatureBundle = (bundle: SignatureBundle) => {
    const { identity, visual } = bundle;
    if (identity) {
      setValues((prev) => ({
        ...prev,
        certType: identity.format,
        p12File: identity.p12File ?? null,
        certFile: identity.certFile ?? null,
        privateKeyFile: identity.keyFile ?? null,
        jksFile: null,
        password: identity.password,
        name: identity.subject.commonName,
        location: identity.subject.locality || prev.location
      }));
      setSigCertLabel(identity.format === 'PKCS12' ? `${identity.p12File?.name} aplicado` : `${identity.certFile?.name} + chave aplicados`);
    }
    if (visual) {
      // URL própria: o estúdio revoga a dele ao regerar a assinatura
      if (sigVisual) URL.revokeObjectURL(sigVisual.url);
      setSigVisual({ file: visual.file, url: URL.createObjectURL(visual.file) });
    }
    toast.success('Assinatura pronta', identity && visual ? 'Certificado e carimbo visual aplicados' : identity ? 'Certificado aplicado nos campos' : 'Carimbo visual aplicado');
  };

  /**
   * O motor exige um certificado coerente com `certType`:
   *  - PKCS12: arquivo .p12/.pfx + senha
   *  - PEM: certificado + chave PKCS#1 ("BEGIN RSA PRIVATE KEY") + senha NÃO vazia (senha vazia derruba o motor)
   *  - JKS: keystore .jks + senha
   * Quem só desenhou/digitou a assinatura não tem certificado nenhum: geramos um autoassinado na hora.
   */
  const prepareCertSign = async (vals: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const has = (k: string) => vals[k] instanceof File;
    const next = { ...vals };
    // corrige o tipo quando o usuário trocou o select depois de anexar/gerar os arquivos
    if (!has('p12File') && has('certFile') && has('privateKeyFile')) next.certType = 'PEM';
    else if (!has('p12File') && !has('certFile') && has('jksFile')) next.certType = 'JKS';
    else if (has('p12File')) next.certType = 'PKCS12';

    const type = String(next.certType || 'PKCS12');
    const complete = type === 'PKCS12' ? has('p12File') : type === 'JKS' ? has('jksFile') : has('certFile') && has('privateKeyFile');
    if (complete) {
      if (type === 'PEM' && !String(next.password || '').trim()) {
        // chave sem senha: o motor precisa de algo no campo mesmo assim
        next.password = 'opta-files';
      }
      return next;
    }
    if (type === 'PEM' && (has('certFile') !== has('privateKeyFile'))) {
      throw new Error('Para o formato PEM envie o certificado (.crt/.pem) e a chave privada (.key/.pem). Se preferir, clique em "Gerar formato exigido".');
    }

    // nada anexado: cria uma identidade autoassinada no formato mais compatível (PKCS#12)
    setProgress(5);
    const name = String(next.name || '').trim() || 'Opta Files';
    const password = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const identity = await generateIdentity('PKCS12', { commonName: name, locality: String(next.location || '') || undefined, keySize: 2048, validityYears: 2, password });
    setValues((prev) => ({ ...prev, certType: 'PKCS12', p12File: identity.p12File ?? null, certFile: null, privateKeyFile: null, jksFile: null, password }));
    setSigCertLabel(`${identity.p12File?.name} (autoassinado) aplicado`);
    toast.info('Certificado gerado', `Nenhum certificado foi anexado: criamos um autoassinado em nome de "${name}".`);
    return { ...next, certType: 'PKCS12', p12File: identity.p12File ?? null, certFile: null, privateKeyFile: null, jksFile: null, password };
  };

  const run = async (placeOverride?: Placement[], planOverride?: SplitSegment[]) => {
    const place = placeOverride ?? placement;
    // divisão visual: abre o editor para o usuário ver as páginas e marcar os cortes
    if (tool.id === 'split' && pdfInput && !planOverride) {
      setSplitOpen(true);
      return;
    }
    // ferramentas de posicionamento: abre o posicionador antes de executar, se ainda não foi escolhido o lugar
    if (PLACEMENT_TOOLS.has(tool.id) && overlaySource && pdfInput && !placed && !placeOverride) {
      setRunAfterPlace(true);
      setPlaceOpen(true);
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(0);
    try {
      let inputs = files.map((f) => f.file);
      let vals: Record<string, unknown> = values;
      if (tool.id === 'cert-sign') {
        if (inputs[0] && inputs[0].type !== 'application/pdf' && !/\.pdf$/i.test(inputs[0].name)) throw new Error('A assinatura digital só funciona em arquivos PDF. Converta o documento primeiro.');
        vals = await prepareCertSign(values);
        if (overlaySource && inputs[0]) {
          // carimba a assinatura visual no PDF antes de assinar, para que a marca fique dentro do documento assinado
          inputs = [await applyOverlayToPdf(inputs[0], overlaySource, place), ...inputs.slice(1)];
          vals = { ...vals, pageNumber: Math.max(1, place[0]?.page ?? 1) };
        }
      }
      let res: ToolResult;
      if (tool.id === 'split') {
        // recorte local, exatamente como o usuário montou no editor
        const plan = planOverride ?? splitPlan;
        if (!isPdfFile(inputs[0])) throw new Error('Esta ferramenta só funciona em arquivos PDF. Converta o documento primeiro.');
        if (!plan?.length) throw new Error('Marque os cortes no editor visual antes de gerar os arquivos.');
        const t0 = performance.now();
        const { zip, parts } = await buildSplitZip(inputs[0], plan, setProgress);
        const base = inputs[0].name.replace(/\.pdf$/i, '');
        res = { blob: zip, fileName: `${base}-dividido.zip`, contentType: 'application/zip', kind: 'zip', durationMs: performance.now() - t0 };
        toast.success(`${parts.length} ${parts.length === 1 ? 'arquivo gerado' : 'arquivos gerados'}`, parts.slice(0, 4).map((x) => x.name).join(', ') + (parts.length > 4 ? '…' : ''));
      } else if (tool.id === 'stamp' || tool.id === 'add-image') {
        // aplicado localmente, exatamente como visto no posicionador
        if (!isPdfFile(inputs[0])) throw new Error('Esta ferramenta só funciona em arquivos PDF. Converta o documento primeiro.');
        if (!overlaySource) throw new Error(tool.id === 'stamp' ? 'Informe o texto ou a imagem do carimbo.' : 'Escolha a imagem a inserir.');
        const t0 = performance.now();
        setProgress(30);
        const out = await applyOverlayToPdf(inputs[0], overlaySource, place);
        setProgress(100);
        const base = inputs[0].name.replace(/\.pdf$/i, '');
        res = { blob: out, fileName: `${base}-${tool.id === 'stamp' ? 'carimbado' : 'imagem'}.pdf`, contentType: 'application/pdf', kind: 'pdf', durationMs: performance.now() - t0 };
      } else {
        res = await runTool(tool, inputs, vals, setProgress);
      }
      setResult(res);
      pushRecentTool(tool.id);
      if (res.kind !== 'json') {
        await saveDocument(res.blob, { name: res.fileName, contentType: res.contentType, kind: res.kind, source: 'tool', toolId: tool.id, toolName: tool.name });
      }
      toast.success(`${tool.name} concluído`, `${res.fileName} · ${humanSize(res.blob.size)} · ${(res.durationMs / 1000).toFixed(1)}s`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      setError(msg);
      toast.error('Falha na ferramenta', msg);
    } finally {
      setRunning(false);
    }
  };

  const resultAsFile = () => (result ? new File([result.blob], result.fileName, { type: result.contentType }) : null);

  const chainable = PDF_TOOLS.filter((t) => t.id !== tool.id && (t.accept === undefined || t.accept === 'application/pdf') && t.popular).slice(0, 6);

  const renderOption = (opt: ToolOption) => {
    const v = values[opt.key];
    const set = (nv: unknown) => setValues((p) => ({ ...p, [opt.key]: nv }));
    // conditional visibility for type-dependent fields
    if (opt.showIf && !opt.showIf.equals.includes(String(values[opt.showIf.key] ?? ''))) return null;
    if ((opt.key === 'watermarkImage' && values.watermarkType !== 'image') || (opt.key === 'watermarkText' && values.watermarkType === 'image')) return null;
    if ((opt.key === 'stampImage' && values.stampType !== 'image') || (opt.key === 'stampText' && values.stampType === 'image')) return null;
    if (PLACEMENT_HIDDEN[tool.id]?.includes(opt.key)) return null;
    if (tool.id === 'cert-sign') {
      const ct = values.certType;
      if (opt.key === 'p12File' && ct !== 'PKCS12') return null;
      if ((opt.key === 'privateKeyFile' || opt.key === 'certFile') && ct !== 'PEM') return null;
      if (opt.key === 'jksFile' && ct !== 'JKS') return null;
    }
    if (tool.id === 'invert') {
      const mode = values.replaceAndInvertOption;
      if (opt.key === 'highContrastColorCombination' && mode !== 'HIGH_CONTRAST_COLOR') return null;
      if ((opt.key === 'backGroundColor' || opt.key === 'textColor') && mode !== 'CUSTOM_COLOR') return null;
    }
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

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Tool header */}
      <div className="px-6 py-4 border-b border-slate-200/80 bg-white flex items-center gap-4 shrink-0">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Voltar">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center">
          <tool.icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-extrabold text-slate-900 leading-tight">{tool.name}</p>
          <p className="text-xs text-slate-500 truncate">{tool.description}</p>
        </div>
        <Button onClick={() => run()} disabled={!canRun} loading={running} icon={Play} size="lg">
          {running ? (progress < 100 ? `Enviando ${progress}%` : 'Processando…') : 'Executar'}
        </Button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_360px_1fr] overflow-hidden">
        {/* Files */}
        <div className="border-r border-slate-200/80 bg-slate-50/60 overflow-y-auto custom-scrollbar p-5 space-y-3">
          {needsFile ? (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void addFiles(e.dataTransfer.files);
                }}
                onClick={() => inputRef.current?.click()}
                className={cn('rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors', dragOver ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white hover:border-brand-300')}
              >
                <input ref={inputRef} type="file" className="hidden" accept={tool.accept ?? 'application/pdf'} multiple={tool.multiFile} onChange={(e) => e.target.files && void addFiles(e.target.files)} />
                <UploadCloud className="w-10 h-10 text-brand-500 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-800">Arraste {tool.inputLabel || (tool.multiFile ? 'os PDFs' : 'o PDF')} aqui</p>
                <p className="text-xs text-slate-500 mt-1">ou clique para selecionar{tool.multiFile ? ' (vários arquivos)' : ''}</p>
              </div>
              <AnimatePresence>
                {files.map((f, i) => (
                  <motion.div key={f.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} className="surface p-2.5 flex items-center gap-3">
                    {tool.multiFile && (
                      <div className="flex flex-col">
                        <button onClick={() => i > 0 && move(i, i - 1)} className="text-slate-300 hover:text-slate-600 leading-none" aria-label="Subir">▲</button>
                        <GripVertical className="w-4 h-4 text-slate-300" />
                        <button onClick={() => i < files.length - 1 && move(i, i + 1)} className="text-slate-300 hover:text-slate-600 leading-none" aria-label="Descer">▼</button>
                      </div>
                    )}
                    <div className="w-12 h-14 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center shrink-0 border border-slate-200">
                      {f.thumb ? <img src={f.thumb} alt="" className="w-full h-full object-cover" /> : <FileText className="w-5 h-5 text-slate-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 truncate">{f.file.name}</p>
                      <p className="text-xs text-slate-500">{humanSize(f.file.size)}{f.pages ? ` · ${f.pages} pág.` : ''}</p>
                    </div>
                    <button onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))} className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50" aria-label="Remover">
                      <X className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
              {tool.minFiles && files.length < tool.minFiles && <p className="text-xs text-amber-700">Adicione pelo menos {tool.minFiles} arquivos.</p>}
            </>
          ) : (
            <div className="surface p-5 text-sm text-slate-600">Esta ferramenta não precisa de arquivo de entrada. Preencha os parâmetros e execute.</div>
          )}
        </div>

        {/* Options */}
        <div className="border-r border-slate-200/80 bg-white overflow-y-auto custom-scrollbar p-5 space-y-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Parâmetros</p>
          {tool.id === 'cert-sign' && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3.5 space-y-3">
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800">Não tem certificado?</p>
                  <p className="text-[11px] text-slate-600 leading-snug">Gere aqui o arquivo no formato exigido e a assinatura visual — os campos abaixo são preenchidos sozinhos.</p>
                </div>
              </div>
              <Button size="sm" icon={Sparkles} onClick={() => setSigOpen(true)} className="w-full">Gerar formato exigido</Button>
              {(sigCertLabel || sigVisual) && (
                <div className="space-y-2">
                  {sigCertLabel && (
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-700 bg-white rounded-lg px-2.5 py-1.5 border border-emerald-200">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{sigCertLabel}</span>
                    </div>
                  )}
                  {sigVisual && (
                    <div className="rounded-lg bg-white border border-slate-200 p-2.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <img src={sigVisual.url} alt="Assinatura" className="h-8 object-contain" />
                        <button type="button" onClick={() => { URL.revokeObjectURL(sigVisual.url); setSigVisual(null); }} className="ml-auto text-slate-400 hover:text-rose-600" title="Remover assinatura visual">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {PLACEMENT_TOOLS.has(tool.id) && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
              <div className="flex items-start gap-2">
                <Move className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-800">Posição no documento</p>
                  <p className="text-[11px] text-slate-600 leading-snug">
                    {!pdfInput ? 'Envie um PDF para posicionar.' : !overlaySource ? (tool.id === 'cert-sign' ? 'Gere a assinatura visual para posicionar.' : tool.id === 'stamp' ? 'Escreva o texto ou escolha a imagem do carimbo.' : 'Escolha a imagem.') : placed ? `${describePlacements(placement)}${placement.length === 1 ? ` · X ${Math.round(placement[0].x)}% · Y ${Math.round(placement[0].y)}%` : ''}${overlaySource.kind === 'image' ? ` · ${Math.round(placement[0].widthPct)}%` : ` · ${placement[0].fontSize}pt`}` : 'O posicionador abre antes de executar.'}
                  </p>
                </div>
              </div>
              <Button size="sm" variant={placed ? 'outline' : 'primary'} icon={Move} disabled={!pdfInput || !previewOverlay} onClick={() => setPlaceOpen(true)} className="w-full">
                {placed ? 'Ajustar posição' : 'Posicionar no documento'}
              </Button>
            </div>
          )}
          {tool.id === 'split' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-slate-400" />
                  Cortes marcados
                </p>
                {splitKept.length > 0 && (
                  <span className="text-[11px] tabular-nums text-slate-500">
                    {splitKept.length} {splitKept.length === 1 ? 'arquivo' : 'arquivos'}
                  </span>
                )}
              </div>
              {!pdfInput ? (
                <p className="text-[11px] text-slate-500 leading-snug">Anexe um PDF ao lado — as páginas abrem na hora para você marcar onde cortar.</p>
              ) : splitKept.length === 0 ? (
                <p className="text-[11px] text-slate-500 leading-snug">Nenhum corte ainda: o PDF inteiro sai como um arquivo só. Abra o editor e clique na tesoura entre as páginas.</p>
              ) : (
                <ul className="space-y-1 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                  {splitKept.map((seg, i) => (
                    <li key={seg.from} className="flex items-center gap-2 text-[11px] rounded-lg bg-slate-50 border border-slate-100 px-2 py-1.5">
                      <span className={cn('h-4 w-1 rounded-full shrink-0', SPLIT_BARS[i % SPLIT_BARS.length])} />
                      <span className="font-mono text-slate-700 truncate flex-1 min-w-0" title={partFileName(seg, i, splitKept.length, pdfInput ? pdfInput.name.replace(/\.pdf$/i, '') : 'documento')}>
                  {partFileName(seg, i, splitKept.length, pdfInput ? pdfInput.name.replace(/\.pdf$/i, '') : 'documento')}
                </span>
                          </li>
                  ))}
                </ul>
              )}
              {splitDropped > 0 && <p className="mt-1.5 text-[11px] text-amber-600">{splitDropped} bloco(s) marcados para descarte.</p>}
              <Button size="sm" variant={splitPlan ? 'outline' : 'primary'} icon={Scissors} disabled={!pdfInput} onClick={() => setSplitOpen(true)} className="w-full mt-2">
                {splitPlan && splitKept.length > 1 ? 'Ajustar cortes' : 'Abrir editor visual'}
              </Button>
            </div>
          )}
          {tool.options.length === 0 && tool.id !== 'split' && <p className="text-sm text-slate-500">Sem parâmetros — basta executar.</p>}
          {tool.options.map(renderOption)}
          {tool.options.length > 0 && (
            <button onClick={() => setValues(defaultsFor(tool))} className="text-xs text-slate-500 hover:text-brand-600 flex items-center gap-1">
              <RotateCcw className="w-3 h-3" /> Restaurar padrões
            </button>
          )}
        </div>

        {/* Result */}
        <div className="bg-slate-50/60 overflow-y-auto custom-scrollbar p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-3">Resultado</p>
          {running && (
            <div className="surface p-6 flex flex-col items-center text-center">
              <Loader2 className="w-8 h-8 text-brand-600 animate-spin mb-3" />
              <p className="text-sm font-bold text-slate-800">{progress < 100 ? `Enviando arquivos… ${progress}%` : 'Processando seu documento…'}</p>
              <div className="w-full h-1.5 bg-slate-200 rounded-full mt-3 overflow-hidden">
                <div className={cn('h-full bg-brand-600 transition-all', progress >= 100 && 'animate-pulse')} style={{ width: `${Math.max(progress, 8)}%` }} />
              </div>
            </div>
          )}
          {error && !running && (
            <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Falha ao executar</p>
                <p className="text-xs mt-1 break-words">{error}</p>
              </div>
            </div>
          )}
          {!running && !error && !result && (
            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
              O arquivo processado aparecerá aqui com pré-visualização e download.
            </div>
          )}
          {result && !running && (
            <div className="space-y-3">
              <div className="surface overflow-hidden">
                {result.kind === 'json' && tool.id === 'validate-sign' ? (
                  <SignatureReport data={result.json} />
                ) : result.kind === 'json' ? (
                  <pre className="text-[11px] p-4 max-h-[420px] overflow-auto custom-scrollbar bg-slate-900 text-slate-100">{JSON.stringify(result.json ?? {}, null, 2)}</pre>
                ) : resultThumb ? (
                  <div className="bg-slate-200 flex items-center justify-center p-3">
                    <img src={resultThumb} alt="Pré-visualização" className="max-h-[360px] rounded-lg shadow" />
                  </div>
                ) : (
                  <div className="p-8 flex flex-col items-center text-slate-500">
                    <FileText className="w-10 h-10 mb-2" />
                    <p className="text-xs">{result.kind === 'zip' ? 'Arquivo ZIP com vários resultados' : result.contentType}</p>
                  </div>
                )}
                <div className="p-3 border-t border-slate-100 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-accent-500 shrink-0" />
                  <p className="text-sm font-semibold text-slate-800 truncate flex-1">{result.fileName}</p>
                  <Badge tone="neutral">{humanSize(result.blob.size)}</Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button icon={Download} onClick={() => downloadBlob(result.blob, result.fileName)}>
                  Baixar
                </Button>
                {previewUrl && result.kind === 'pdf' && (
                  <Button variant="outline" icon={Eye} onClick={() => window.open(previewUrl, '_blank')}>
                    Abrir
                  </Button>
                )}
                {result.kind === 'pdf' && (
                  <Button variant="outline" icon={PenTool} onClick={() => { const f = resultAsFile(); if (f) onOpenInEditor(f); }}>
                    Editor visual
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-slate-500 flex items-center gap-1">
                <Save className="w-3 h-3" /> Salvo automaticamente em Documentos.
              </p>
              {result.kind === 'pdf' && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-2">Continuar com</p>
                  <div className="flex flex-wrap gap-1.5">
                    {chainable.map((t) => (
                      <button key={t.id} onClick={() => { const f = resultAsFile(); if (f) onChain(t, [f]); }} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:border-brand-300 hover:text-brand-700">
                        <t.icon className="w-3.5 h-3.5" /> {t.name} <ArrowRight className="w-3 h-3 text-slate-300" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <SignatureStudio
        open={sigOpen}
        onClose={() => setSigOpen(false)}
        defaultName={typeof values.name === 'string' ? values.name : undefined}
        onApply={applySignatureBundle}
      />
      {splitOpen && pdfInput && (
        <SplitStudio
          file={pdfInput}
          onClose={() => setSplitOpen(false)}
          initialDraft={splitDraft}
          onPlanChange={handlePlanChange}
          onApply={(segments) => {
            setSplitPlan(segments);
            setSplitOpen(false);
            void run(undefined, segments);
          }}
        />
      )}
      {placeOpen && pdfInput && previewOverlay && (
        <PlacementStudio
          onClose={() => { setPlaceOpen(false); setRunAfterPlace(false); }}
          pdf={pdfInput}
          overlay={previewOverlay}
          initial={placement}
          title={tool.id === 'cert-sign' ? 'Posicionar assinatura' : tool.id === 'stamp' ? 'Posicionar carimbo' : 'Posicionar imagem'}
          allowAllPages={tool.id !== 'cert-sign'}
          onApply={applyPlacement}
        />
      )}
    </div>
  );
};

export default ToolRunner;
