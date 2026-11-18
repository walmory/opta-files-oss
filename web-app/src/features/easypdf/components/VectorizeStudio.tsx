/**
 * Vetorizador de imagens — converte PNG/JPG/WebP em SVG de verdade (curvas, nao imagem
 * embutida), com pre-visualizacao lado a lado e os parametros do VTracer expostos em
 * linguagem de usuario. Motor: VTracer (MIT/Apache-2.0) em WebAssembly, dentro de um
 * Web Worker — nenhum byte sai do dispositivo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, Save, UploadCloud, Trash2, Loader2, Plus, RotateCcw, Copy, Check, Images } from 'lucide-react';
import { cn, Button, Select, Badge, Segmented, useToast } from '../../../components/ui';
import { saveDocument, downloadBlob, pushRecentTool, humanSize } from '../history';
import { createZip } from '../zip';
import { VECTOR_PRESETS, svgName, svgStats, toRgba, vectorize, type VectorizeOptions } from '../vectorize';
import type { PdfTool } from '../tools';

interface Props {
  tool: PdfTool;
  onBack: () => void;
}

interface Item {
  id: string;
  file: File;
  url: string;
  w: number;
  h: number;
}

type View = 'split' | 'vector' | 'original';

/** Resolucao de analise: reduzir antes de tracar e o que separa 1 s de 30 s. */
// Tamanho (lado maior) em que a imagem e tracada. Imagens menores sao AMPLIADAS com
// suavizacao antes de tracar: e o que deixa retas retas e curvas lisas em vez de escadinha.
const DETAIL_LEVELS = [
  { value: '1200', label: 'Rapida — 1200 px' },
  { value: '2400', label: 'Alta — 2400 px' },
  { value: '3600', label: 'Maxima — 3600 px' },
  { value: '0', label: 'Resolucao original (sem reamostrar)' }
];

const loadItem = (file: File) =>
  new Promise<Item>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, url, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Nao foi possivel ler ${file.name}`));
    };
    img.src = url;
  });

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao decodificar a imagem'));
    img.src = url;
  });

const Slider = ({ label, hint, value, min, max, step = 1, onChange, suffix, format }: { label: string; hint?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string; format?: (v: number) => string }) => (
  <label className="block">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      <span className="text-xs font-mono text-slate-500 tabular-nums">
        {format ? format(value) : value}
        {format ? null : suffix}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full mt-1.5 accent-brand-600 cursor-pointer"
    />
    {hint && <span className="block text-[11px] leading-tight text-slate-400 mt-0.5">{hint}</span>}
  </label>
);

const VectorizeStudio = ({ tool, onBack }: Props) => {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [presetId, setPresetId] = useState('logo');
  const [opts, setOpts] = useState<VectorizeOptions>(VECTOR_PRESETS[0].options);
  const [detail, setDetail] = useState('2400');
  const [view, setView] = useState<View>('split');
  const [svg, setSvg] = useState<string | null>(null);
  const [tracing, setTracing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = useMemo(() => items.find((i) => i.id === activeId) ?? null, [items, activeId]);
  const svgUrl = useMemo(() => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null), [svg]);
  const stats = useMemo(() => (svg ? svgStats(svg) : null), [svg]);
  const svgBytes = useMemo(() => (svg ? new Blob([svg]).size : 0), [svg]);

  const addFiles = useCallback(
    async (list: FileList | null) => {
      if (!list?.length) return;
      const images = [...list].filter((f) => f.type.startsWith('image/') && !f.type.includes('svg'));
      if (!images.length) {
        toast.error('Envie imagens', 'Formatos aceitos: PNG, JPG, WebP, GIF ou BMP.');
        return;
      }
      const loaded: Item[] = [];
      for (const file of images) {
        try {
          loaded.push(await loadItem(file));
        } catch {
          toast.error(`Falha ao abrir ${file.name}`);
        }
      }
      if (!loaded.length) return;
      setItems((prev) => [...prev, ...loaded]);
      setActiveId((prev) => prev ?? loaded[0].id);
    },
    [toast]
  );

  const removeItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.url);
      const next = prev.filter((i) => i.id !== id);
      setActiveId((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
      return next;
    });
  };

  const applyPreset = (id: string) => {
    const preset = VECTOR_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setPresetId(id);
    setOpts(preset.options);
  };

  /** Qualquer ajuste manual tira o preset do estado "puro" — o rotulo passa a Personalizado. */
  const patch = (part: Partial<VectorizeOptions>) => {
    setOpts((prev) => ({ ...prev, ...part }));
    setPresetId('custom');
  };

  const run = useCallback(
    async (item: Item, options: VectorizeOptions) => {
      const img = await loadImage(item.url);
      return vectorize(toRgba(img, item.w, item.h, Number(detail), options), options);
    },
    [detail]
  );

  // Pre-visualizacao com respiro: arrastar um slider dispara uma unica passada, no fim.
  useEffect(() => {
    // Sem imagem ativa nao ha o que tracar; o SVG antigo fica fora de tela (a lista vazia
    // volta para o dropzone) e e sobrescrito assim que outro item vira ativo.
    if (!active) return;
    let dead = false;
    const timer = setTimeout(() => {
      setTracing(true);
      setError(null);
      const started = performance.now();
      run(active, opts)
        .then((out) => {
          if (dead) return;
          setSvg(out);
          setElapsed(Math.round(performance.now() - started));
        })
        .catch((e: unknown) => {
          if (dead) return;
          setSvg(null);
          setError(e instanceof Error ? e.message : 'Falha ao vetorizar');
        })
        .finally(() => {
          if (!dead) setTracing(false);
        });
    }, 280);
    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [active, opts, run]);

  useEffect(() => {
    const urls = items.map((i) => i.url);
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
    // Limpeza so no desmonte: `removeItem` ja revoga o item que sai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copySvg = async () => {
    if (!svg) return;
    try {
      await navigator.clipboard.writeText(svg);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Nao foi possivel copiar');
    }
  };

  const process = async (mode: 'download' | 'save') => {
    if (!items.length) return;
    setBusy(true);
    try {
      const results: { name: string; blob: Blob }[] = [];
      for (const item of items) {
        // O item aberto ja tem SVG pronto na tela; os demais sao tracados agora.
        const out = item.id === active?.id && svg ? svg : await run(item, opts);
        results.push({ name: svgName(item.file.name), blob: new Blob([out], { type: 'image/svg+xml' }) });
      }
      pushRecentTool(tool.id);
      if (results.length === 1) {
        const [only] = results;
        if (mode === 'download') downloadBlob(only.blob, only.name);
        else await saveDocument(only.blob, { name: only.name, contentType: 'image/svg+xml', kind: 'image', source: 'tool', toolId: tool.id, toolName: tool.name });
      } else {
        const zip = await createZip(results);
        const name = `vetorizadas-${results.length}-imagens.zip`;
        if (mode === 'download') downloadBlob(zip, name);
        else await saveDocument(zip, { name, contentType: 'application/zip', kind: 'zip', source: 'tool', toolId: tool.id, toolName: tool.name });
      }
      toast.success(mode === 'download' ? 'Pronto! Download iniciado' : 'Salvo em Documentos');
    } catch (e) {
      toast.error('Falha ao vetorizar', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const delta = active && svgBytes ? svgBytes - active.file.size : 0;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onBack} className="w-10 h-10 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:text-slate-900 hover:border-slate-300 transition-colors" aria-label="Voltar">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-11 h-11 rounded-xl bg-brand-600 text-white flex items-center justify-center shadow-md shadow-brand-600/25">
            <tool.icon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex flex-wrap items-center gap-2">
              {tool.name} <Badge tone="brand">100% no navegador</Badge>
            </h2>
            <p className="text-xs text-slate-500 truncate hidden sm:block">Converte a imagem em curvas SVG de verdade — escala sem perder qualidade, edita no Illustrator, Figma ou Inkscape.</p>
          </div>
          {/* Em telas estreitas os botoes descem para a linha de baixo, alinhados a direita. */}
          <div className="flex items-center gap-2 ml-auto w-full sm:w-auto justify-end">
            <Button variant="outline" icon={Save} loading={busy} disabled={!items.length} onClick={() => void process('save')}>
              Salvar
            </Button>
            <Button icon={Download} loading={busy} disabled={!items.length} onClick={() => void process('download')}>
              {items.length > 1 ? `Baixar ZIP (${items.length})` : 'Baixar SVG'}
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addFiles(e.dataTransfer.files);
            }}
            onClick={() => fileRef.current?.click()}
            className={cn(
              'rounded-3xl border-2 border-dashed bg-white p-12 text-center cursor-pointer transition-colors',
              dragging ? 'border-brand-500 bg-brand-50/60' : 'border-slate-200 hover:border-brand-300'
            )}
          >
            <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto mb-4">
              <UploadCloud className="w-7 h-7" />
            </div>
            <p className="font-bold text-slate-900">Solte as imagens aqui</p>
            <p className="text-sm text-slate-500 mt-1">PNG, JPG, WebP, GIF ou BMP — logos e desenhos com poucas cores dao o melhor resultado.</p>
            <Button className="mt-5" icon={Images} onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
              Escolher imagens
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-5 items-start">
            {/* Painel de controles */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Tipo de imagem</span>
                  {presetId === 'custom' && (
                    <button onClick={() => applyPreset('logo')} className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
                      <RotateCcw className="w-3 h-3" /> Restaurar
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {VECTOR_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => applyPreset(p.id)}
                      className={cn(
                        'rounded-xl border p-2.5 text-left transition-colors',
                        presetId === p.id ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500/30' : 'border-slate-200 hover:border-brand-300'
                      )}
                    >
                      <span className="block text-xs font-bold text-slate-900">{p.label}</span>
                      <span className="block text-[11px] leading-tight text-slate-500 mt-0.5">{p.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
                <div>
                  <span className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">Cor</span>
                  <Segmented
                    size="sm"
                    value={opts.colorMode}
                    onChange={(v) => patch({ colorMode: v })}
                    options={[
                      { value: 'color', label: 'Colorido' },
                      { value: 'bw', label: 'Preto e branco' }
                    ]}
                  />
                </div>
                <div>
                  <span className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">Contorno</span>
                  <Segmented
                    size="sm"
                    value={opts.pathMode}
                    onChange={(v) => patch({ pathMode: v })}
                    options={[
                      { value: 'spline', label: 'Curvas' },
                      { value: 'polygon', label: 'Retas' },
                      { value: 'pixel', label: 'Pixel' }
                    ]}
                  />
                </div>
                <Select label="Qualidade do tracado" value={detail} onChange={(e) => setDetail(e.target.value)} hint="Imagens pequenas sao ampliadas com suavizacao antes de tracar: bordas retas e curvas lisas. Maior = mais lento.">
                  {DETAIL_LEVELS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
                <span className="block text-xs font-bold uppercase tracking-wide text-slate-500">Ajuste fino</span>
                <Slider label="Remover manchas" hint="Ignora respingos menores que isso (ruido de JPEG)." value={opts.filterSpeckle} min={0} max={64} onChange={(v) => patch({ filterSpeckle: v })} suffix=" px" />
                {opts.colorMode === 'color' && (
                  <Segmented
                    value={opts.quantize ? 'palette' : 'auto'}
                    onChange={(v) => patch({ quantize: v === 'palette' })}
                    options={[
                      { value: 'palette', label: 'Paleta fixa' },
                      { value: 'auto', label: 'Cores livres' }
                    ]}
                  />
                )}
                {opts.colorMode === 'color' && opts.quantize && (
                  <Slider label="Cores na paleta" hint="Reduz a imagem a N cores exatas antes de tracar (como o Image Trace). Auto detecta." value={opts.palette} min={0} max={32} onChange={(v) => patch({ palette: v })} format={(v) => (v === 0 ? 'Auto' : String(v))} />
                )}
                {opts.colorMode === 'color' && !opts.quantize && (
                  <>
                    <Slider label="Riqueza de cores" hint="Bits por canal: mais cores, arquivo maior." value={opts.colorPrecision} min={1} max={8} onChange={(v) => patch({ colorPrecision: v })} />
                    <Slider label="Separacao de camadas" hint="Diferenca minima de cor para criar uma camada nova." value={opts.layerDifference} min={0} max={64} onChange={(v) => patch({ layerDifference: v })} />
                  </>
                )}
                <Slider label="Cantos vivos" hint="Angulo a partir do qual o canto nao e arredondado." value={opts.cornerThreshold} min={0} max={180} onChange={(v) => patch({ cornerThreshold: v })} suffix="°" />
                <Slider label="Precisao das coordenadas" hint="Menos casas decimais deixam o SVG mais leve." value={opts.pathPrecision} min={0} max={8} onChange={(v) => patch({ pathPrecision: v })} />
              </div>
            </div>

            {/* Pre-visualizacao */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 flex-wrap">
                  <Segmented
                    size="sm"
                    value={view}
                    onChange={setView}
                    options={[
                      { value: 'split', label: 'Lado a lado' },
                      { value: 'vector', label: 'SVG' },
                      { value: 'original', label: 'Original' }
                    ]}
                  />
                  <div className="flex-1" />
                  {tracing && (
                    <span className="text-xs text-slate-500 inline-flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Tracando…
                    </span>
                  )}
                  {!tracing && stats && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge tone="neutral">{stats.paths} caminhos</Badge>
                      {opts.colorMode === 'color' && <Badge tone="neutral">{stats.colors} cores</Badge>}
                      <Badge tone={delta > 0 ? 'warning' : 'success'}>
                        {humanSize(svgBytes)} {delta > 0 ? '↑' : '↓'}
                      </Badge>
                      <Badge tone="neutral">{elapsed} ms</Badge>
                    </div>
                  )}
                  <Button variant="ghost" size="xs" icon={copied ? Check : Copy} disabled={!svg} onClick={() => void copySvg()}>
                    {copied ? 'Copiado' : 'Copiar SVG'}
                  </Button>
                </div>

                {error ? (
                  <div className="p-10 text-center text-sm text-rose-600">{error}</div>
                ) : (
                  <div className={cn('grid gap-px bg-slate-100', view === 'split' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1')}>
                    {view !== 'vector' && (
                      <figure className="bg-white p-4 min-h-[320px] flex flex-col items-center justify-center gap-2">
                        {active && <img src={active.url} alt="Original" className="max-h-[52vh] max-w-full object-contain" />}
                        <figcaption className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          Original · {active?.w} × {active?.h}
                        </figcaption>
                      </figure>
                    )}
                    {view !== 'original' && (
                      <figure
                        className="bg-white p-4 min-h-[320px] flex flex-col items-center justify-center gap-2"
                        style={{
                          backgroundImage:
                            'linear-gradient(45deg,#f1f5f9 25%,transparent 25%),linear-gradient(-45deg,#f1f5f9 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f1f5f9 75%),linear-gradient(-45deg,transparent 75%,#f1f5f9 75%)',
                          backgroundSize: '16px 16px',
                          backgroundPosition: '0 0,0 8px,8px -8px,-8px 0'
                        }}
                      >
                        {svgUrl ? (
                          <img src={svgUrl} alt="Vetor" className="max-h-[52vh] max-w-full object-contain" />
                        ) : (
                          <span className="text-sm text-slate-400">{tracing ? 'Gerando vetor…' : 'Sem resultado'}</span>
                        )}
                        <figcaption className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">SVG · escala infinita</figcaption>
                      </figure>
                    )}
                  </div>
                )}
              </div>

              {/* Fila de imagens */}
              <div className="flex items-center gap-2 flex-wrap">
                {items.map((item) => (
                  <div key={item.id} className="group relative">
                    <button
                      onClick={() => setActiveId(item.id)}
                      className={cn(
                        'w-20 h-20 rounded-xl border-2 overflow-hidden bg-white transition-colors',
                        item.id === activeId ? 'border-brand-500' : 'border-slate-200 hover:border-brand-300'
                      )}
                      title={item.file.name}
                    >
                      <img src={item.url} alt={item.file.name} className="w-full h-full object-contain" />
                    </button>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      aria-label={`Remover ${item.file.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-200 hover:border-brand-300 text-slate-400 hover:text-brand-600 flex flex-col items-center justify-center gap-1 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                  <span className="text-[10px] font-semibold">Adicionar</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
      </div>
    </div>
  );
};

export default VectorizeStudio;
