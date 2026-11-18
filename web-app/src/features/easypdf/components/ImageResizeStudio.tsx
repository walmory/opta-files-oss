/**
 * Redimensionador de imagens — no espírito da caixa "Tamanho da imagem" do Photoshop:
 * dimensões em px / % / cm / polegadas, proporção travada, modo de encaixe, formato e
 * qualidade de saída. A pré-visualização é o próprio arquivo final (mesmo pipeline do
 * download), então o que aparece na tela é exatamente o que o usuário recebe.
 *
 * Tudo roda no canvas do navegador: nenhum byte sai do dispositivo.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Download, Save, UploadCloud, Trash2, Link2, Unlink, Loader2, ImageDown, RotateCcw, Images, Plus
} from 'lucide-react';
import { cn, Button, Input, Select, Badge, Switch, Segmented, useToast } from '../../../components/ui';
import { saveDocument, downloadBlob, pushRecentTool, humanSize } from '../history';
import { createZip } from '../zip';
import type { PdfTool } from '../tools';

interface Props {
  tool: PdfTool;
  onBack: () => void;
}

type Unit = 'px' | 'percent' | 'cm' | 'in';
type Fit = 'exact' | 'contain' | 'cover';
type Format = 'auto' | 'png' | 'jpeg' | 'webp';
type Resample = 'smooth' | 'pixel';

interface Item {
  id: string;
  file: File;
  url: string;
  w: number;
  h: number;
}

interface RenderOpts {
  fit: Fit;
  bg: string;
  transparent: boolean;
  noUpscale: boolean;
  format: Format;
  quality: number;
  resample: Resample;
}

const CM_PER_IN = 2.54;

/** Presets rápidos: `pct` escala relativa, `w`/`h` em pixels (um deles pode faltar = mantém proporção). */
const PRESETS: { label: string; hint: string; pct?: number; w?: number; h?: number }[] = [
  { label: 'Original', hint: '100%', pct: 100 },
  { label: '50%', hint: 'metade', pct: 50 },
  { label: '25%', hint: 'um quarto', pct: 25 },
  { label: 'Web', hint: '1200 px de largura', w: 1200 },
  { label: 'Full HD', hint: '1920 × 1080', w: 1920, h: 1080 },
  { label: '4K', hint: '3840 × 2160', w: 3840, h: 2160 },
  { label: 'Instagram', hint: '1080 × 1080', w: 1080, h: 1080 },
  { label: 'Story', hint: '1080 × 1920', w: 1080, h: 1920 },
  { label: 'A4 300 dpi', hint: '2480 × 3508', w: 2480, h: 3508 },
  { label: 'Miniatura', hint: '400 px de largura', w: 400 }
];

const FITS: { value: Fit; label: string; help: string }[] = [
  { value: 'exact', label: 'Esticar', help: 'Usa exatamente a medida informada, mesmo que distorça a imagem.' },
  { value: 'contain', label: 'Caber dentro', help: 'Mantém a proporção e completa o espaço que sobra com a cor de fundo.' },
  { value: 'cover', label: 'Preencher e cortar', help: 'Mantém a proporção, preenche toda a área e corta o excesso pelo centro.' }
];

const makeCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
};

/**
 * Redução em etapas (halving): reduzir de uma vez só num canvas produz serrilhado,
 * porque o navegador amostra poucos pixels de origem. Cortar pela metade até chegar
 * perto do alvo é o truque clássico para uma redução limpa.
 */
const stepDown = (src: CanvasImageSource, sw: number, sh: number, dw: number, dh: number) => {
  let cur = src;
  let cw = sw;
  let ch = sh;
  while (cw > dw * 2 && ch > dh * 2) {
    const nw = Math.max(dw, Math.round(cw / 2));
    const nh = Math.max(dh, Math.round(ch / 2));
    const c = makeCanvas(nw, nh);
    const ctx = c.getContext('2d');
    if (!ctx) break;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    cur = c;
    cw = nw;
    ch = nh;
  }
  return { src: cur, w: cw, h: ch };
};

const mimeOf = (format: Format, file: File) =>
  format === 'auto'
    ? (['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ? file.type : 'image/png')
    : `image/${format}`;

const extOf = (mime: string) => (mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] || 'png');

const baseName = (name: string) => name.replace(/\.[^./\\]+$/, '') || 'imagem';

/** Aplica o "não aumentar" encolhendo o alvo proporcionalmente, nunca só um dos lados. */
const clampTarget = (item: Item, target: { w: number; h: number }, noUpscale: boolean) => {
  let w = Math.max(1, Math.round(target.w));
  let h = Math.max(1, Math.round(target.h));
  if (noUpscale) {
    const k = Math.min(1, item.w / w, item.h / h);
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
  }
  return { w, h };
};

const renderItem = async (item: Item, target: { w: number; h: number }, o: RenderOpts) => {
  const { w: tw, h: th } = clampTarget(item, target, o.noUpscale);
  const bmp = await createImageBitmap(item.file);
  const mime = mimeOf(o.format, item.file);
  const opaque = mime === 'image/jpeg' || !o.transparent;

  // recorte na origem (só o "preencher e cortar" descarta pixels)
  let sx = 0;
  let sy = 0;
  let sw = bmp.width;
  let sh = bmp.height;
  if (o.fit === 'cover') {
    const scale = Math.max(tw / bmp.width, th / bmp.height);
    sw = Math.min(bmp.width, Math.round(tw / scale));
    sh = Math.min(bmp.height, Math.round(th / scale));
    sx = Math.round((bmp.width - sw) / 2);
    sy = Math.round((bmp.height - sh) / 2);
  }

  // área de destino dentro do canvas final
  let dw = tw;
  let dh = th;
  let dx = 0;
  let dy = 0;
  if (o.fit === 'contain') {
    const scale = Math.min(tw / sw, th / sh);
    dw = Math.max(1, Math.round(sw * scale));
    dh = Math.max(1, Math.round(sh * scale));
    dx = Math.round((tw - dw) / 2);
    dy = Math.round((th - dh) / 2);
  }

  let source: CanvasImageSource = bmp;
  let srcW = sw;
  let srcH = sh;
  if (sx || sy || sw !== bmp.width || sh !== bmp.height) {
    const crop = makeCanvas(sw, sh);
    const cctx = crop.getContext('2d');
    if (cctx) {
      cctx.imageSmoothingEnabled = true;
      cctx.imageSmoothingQuality = 'high';
      cctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
      source = crop;
    }
  }
  if (o.resample === 'smooth') {
    const stepped = stepDown(source, srcW, srcH, dw, dh);
    source = stepped.src;
    srcW = stepped.w;
    srcH = stepped.h;
  }

  const out = makeCanvas(tw, th);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível neste navegador');
  if (opaque) {
    ctx.fillStyle = o.bg;
    ctx.fillRect(0, 0, tw, th);
  }
  ctx.imageSmoothingEnabled = o.resample === 'smooth';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, srcW, srcH, dx, dy, dw, dh);
  bmp.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    out.toBlob(resolve, mime, mime === 'image/png' ? undefined : o.quality)
  );
  if (!blob) throw new Error('Falha ao gerar a imagem');
  return { blob, w: tw, h: th, name: `${baseName(item.file.name)}-${tw}x${th}.${extOf(mime)}`, mime };
};

const ImageResizeStudio = ({ tool, onBack }: Props) => {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string>('');

  const [items, setItems] = useState<Item[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'after' | 'before'>('after');

  const [unit, setUnit] = useState<Unit>('px');
  const [dpi, setDpi] = useState(300);
  const [pct, setPct] = useState(100);
  const [target, setTarget] = useState({ w: 0, h: 0 });
  const [wText, setWText] = useState('');
  const [hText, setHText] = useState('');
  const [lock, setLock] = useState(true);

  const [fit, setFit] = useState<Fit>('exact');
  const [bg, setBg] = useState('#ffffff');
  const [transparent, setTransparent] = useState(true);
  const [noUpscale, setNoUpscale] = useState(false);
  const [format, setFormat] = useState<Format>('auto');
  const [quality, setQuality] = useState(0.9);
  const [resample, setResample] = useState<Resample>('smooth');

  const [preview, setPreview] = useState<{ url: string; size: number; w: number; h: number } | null>(null);
  const [rendering, setRendering] = useState(false);

  const active = useMemo(() => items.find((i) => i.id === activeId) || items[0] || null, [items, activeId]);
  const opts = useMemo<RenderOpts>(
    () => ({ fit, bg, transparent, noUpscale, format, quality, resample }),
    [fit, bg, transparent, noUpscale, format, quality, resample]
  );

  /** Alvo em pixels de um item — em % cada imagem escala em relação a si mesma. */
  const targetFor = (item: Item) =>
    unit === 'percent' ? { w: (item.w * pct) / 100, h: (item.h * pct) / 100 } : target;
  const finalFor = (item: Item) => clampTarget(item, targetFor(item), noUpscale);

  const fmt = (px: number, u: Unit, res: number) => {
    if (u === 'cm') return ((px / res) * CM_PER_IN).toFixed(2);
    if (u === 'in') return (px / res).toFixed(2);
    return String(Math.round(px));
  };
  const toPx = (value: number, u: Unit, res: number) => {
    if (u === 'cm') return (value / CM_PER_IN) * res;
    if (u === 'in') return value * res;
    return value;
  };

  const applyTarget = (w: number, h: number, u: Unit = unit, res: number = dpi) => {
    const W = Math.max(1, Math.round(w));
    const H = Math.max(1, Math.round(h));
    setTarget({ w: W, h: H });
    setWText(fmt(W, u, res));
    setHText(fmt(H, u, res));
  };

  const ratio = active ? active.w / active.h : 1;

  const onWidth = (text: string) => {
    setWText(text);
    const value = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return;
    const w = Math.max(1, Math.round(toPx(value, unit, dpi)));
    if (lock) {
      const h = Math.max(1, Math.round(w / ratio));
      setTarget({ w, h });
      setHText(fmt(h, unit, dpi));
    } else {
      setTarget((t) => ({ ...t, w }));
    }
  };

  const onHeight = (text: string) => {
    setHText(text);
    const value = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return;
    const h = Math.max(1, Math.round(toPx(value, unit, dpi)));
    if (lock) {
      const w = Math.max(1, Math.round(h * ratio));
      setTarget({ w, h });
      setWText(fmt(w, unit, dpi));
    } else {
      setTarget((t) => ({ ...t, h }));
    }
  };

  const changeUnit = (u: Unit) => {
    // sair de % congela o resultado atual em pixels, para não perder o que já foi escolhido
    if (unit === 'percent' && u !== 'percent' && active) {
      const t = targetFor(active);
      setUnit(u);
      applyTarget(t.w, t.h, u, dpi);
      return;
    }
    setUnit(u);
    if (u !== 'percent') {
      setWText(fmt(target.w, u, dpi));
      setHText(fmt(target.h, u, dpi));
    }
  };

  const changeDpi = (value: number) => {
    const res = Math.min(1200, Math.max(1, Math.round(value) || 300));
    setDpi(res);
    if (unit === 'cm' || unit === 'in') {
      setWText(fmt(target.w, unit, res));
      setHText(fmt(target.h, unit, res));
    }
  };

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    if (p.pct != null) {
      setUnit('percent');
      setPct(p.pct);
      return;
    }
    if (unit === 'percent') setUnit('px');
    const u: Unit = unit === 'percent' ? 'px' : unit;
    const w = p.w ?? Math.round((p.h as number) * ratio);
    const h = p.h ?? Math.round((p.w as number) / ratio);
    applyTarget(w, h, u, dpi);
  };

  const addFiles = async (list: FileList | File[]) => {
    const files = [...list].filter((f) => f.type.startsWith('image/'));
    if (!files.length) {
      toast.error('Selecione arquivos de imagem (JPG, PNG, WEBP…)');
      return;
    }
    const loaded: Item[] = [];
    for (const file of files) {
      try {
        const bmp = await createImageBitmap(file);
        loaded.push({
          id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          url: URL.createObjectURL(file),
          w: bmp.width,
          h: bmp.height
        });
        bmp.close();
      } catch {
        toast.error(`Não consegui abrir ${file.name}`);
      }
    }
    if (!loaded.length) return;
    const first = items.length === 0;
    setItems((prev) => [...prev, ...loaded]);
    if (first) {
      setActiveId(loaded[0].id);
      applyTarget(loaded[0].w, loaded[0].h);
    }
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const gone = prev.find((i) => i.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((i) => i.id !== id);
    });
    setActiveId((prev) => (prev === id ? null : prev));
  };

  const resetToOriginal = () => {
    if (!active) return;
    if (unit === 'percent') setPct(100);
    else applyTarget(active.w, active.h);
  };

  const process = async (mode: 'download' | 'save') => {
    if (!items.length) return;
    setBusy(true);
    try {
      const results = [];
      for (const item of items) results.push(await renderItem(item, targetFor(item), opts));
      pushRecentTool(tool.id);
      if (results.length === 1) {
        const r = results[0];
        if (mode === 'download') downloadBlob(r.blob, r.name);
        else await saveDocument(r.blob, { name: r.name, contentType: r.mime, kind: 'image', source: 'tool', toolId: tool.id, toolName: tool.name });
      } else {
        const zip = await createZip(results.map((r) => ({ name: r.name, blob: r.blob })));
        const name = `imagens-redimensionadas-${results.length}.zip`;
        if (mode === 'download') downloadBlob(zip, name);
        else await saveDocument(zip, { name, contentType: 'application/zip', kind: 'zip', source: 'tool', toolId: tool.id, toolName: tool.name });
      }
      toast.success(mode === 'download' ? 'Pronto! Download iniciado' : 'Salvo em Documentos');
    } catch (e) {
      toast.error('Falha ao redimensionar', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  // pré-visualização = arquivo final de verdade, com um respiro para não renderizar a cada tecla
  useEffect(() => {
    if (!active) return;
    let dead = false;
    const timer = setTimeout(() => {
      setRendering(true);
      renderItem(active, targetFor(active), opts)
        .then((r) => {
          if (dead) return;
          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = URL.createObjectURL(r.blob);
          setPreview({ url: previewUrlRef.current, size: r.blob.size, w: r.w, h: r.h });
        })
        .catch(() => undefined)
        .finally(() => {
          if (!dead) setRendering(false);
        });
    }, 220);
    return () => {
      dead = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, target.w, target.h, unit, pct, opts]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    []
  );

  const out = active ? finalFor(active) : null;
  const delta = preview && active ? preview.size - active.file.size : 0;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-10 h-10 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:text-slate-900 hover:border-slate-300 transition-colors" aria-label="Voltar">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-11 h-11 rounded-xl bg-brand-600 text-white flex items-center justify-center shadow-md shadow-brand-600/25">
            <tool.icon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              {tool.name} <Badge tone="brand">100% no navegador</Badge>
            </h2>
            <p className="text-xs text-slate-500 truncate">Dimensões em px, %, cm ou polegadas, proporção travada, encaixe, formato e qualidade — com prévia do arquivo final.</p>
          </div>
          <Button variant="outline" icon={Save} loading={busy} disabled={!items.length} onClick={() => void process('save')}>
            Salvar
          </Button>
          <Button icon={Download} loading={busy} disabled={!items.length} onClick={() => void process('download')}>
            {items.length > 1 ? `Baixar ZIP (${items.length})` : 'Baixar'}
          </Button>
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
            <p className="text-base font-bold text-slate-900">Arraste suas imagens aqui</p>
            <p className="text-sm text-slate-500 mt-1">JPG, PNG, WEBP, GIF ou BMP · várias de uma vez, com as mesmas medidas</p>
            <Button className="mt-5" icon={Images} onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
              Escolher imagens
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_320px] gap-5 items-start">
            {/* Lista de arquivos */}
            <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-slate-700">Imagens ({items.length})</span>
                <button onClick={() => fileRef.current?.click()} className="text-xs font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Adicionar
                </button>
              </div>
              <div className="space-y-1.5 max-h-[520px] overflow-y-auto custom-scrollbar">
                {items.map((item) => {
                  const f = finalFor(item);
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveId(item.id)}
                      className={cn(
                        'w-full flex items-center gap-2.5 p-2 rounded-xl border text-left transition-colors group',
                        active?.id === item.id ? 'border-brand-400 bg-brand-50/60' : 'border-transparent hover:bg-slate-50'
                      )}
                    >
                      <img src={item.url} alt="" className="w-10 h-10 rounded-lg object-cover bg-slate-100 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-slate-800 truncate">{item.file.name}</span>
                        <span className="block text-[11px] text-slate-500 font-mono">
                          {item.w}×{item.h} → {f.w}×{f.h}
                        </span>
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); removeItem(item.id); } }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all"
                        title="Remover da lista"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <Segmented
                  size="sm"
                  value={view}
                  onChange={setView}
                  options={[{ value: 'after', label: 'Depois' }, { value: 'before', label: 'Antes' }]}
                />
                {rendering && <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> gerando prévia…</span>}
                <span className="ml-auto text-xs font-mono text-slate-500">
                  {active && (view === 'before' ? `${active.w}×${active.h} · ${humanSize(active.file.size)}` : preview ? `${preview.w}×${preview.h} · ${humanSize(preview.size)}` : '—')}
                </span>
              </div>
              <div
                className="rounded-xl border border-slate-200 min-h-[300px] grid place-items-center p-4 overflow-hidden"
                style={{
                  backgroundImage:
                    'linear-gradient(45deg,#f1f5f9 25%,transparent 25%),linear-gradient(-45deg,#f1f5f9 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f1f5f9 75%),linear-gradient(-45deg,transparent 75%,#f1f5f9 75%)',
                  backgroundSize: '16px 16px',
                  backgroundPosition: '0 0,0 8px,8px -8px,-8px 0'
                }}
              >
                {active && (view === 'before' || !preview) ? (
                  <img src={active.url} alt="" className="max-h-[440px] max-w-full object-contain shadow-sm" />
                ) : preview ? (
                  <img src={preview.url} alt="" className="max-h-[440px] max-w-full object-contain shadow-sm" />
                ) : null}
              </div>
              {active && preview && (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <ImageDown className="w-4 h-4 text-slate-400" />
                  <span>
                    {active.w}×{active.h} · {humanSize(active.file.size)} → <b className="text-slate-900">{preview.w}×{preview.h} · {humanSize(preview.size)}</b>
                  </span>
                  <span className={cn('font-semibold', delta <= 0 ? 'text-emerald-600' : 'text-amber-600')}>
                    {delta <= 0 ? `−${humanSize(Math.abs(delta))}` : `+${humanSize(delta)}`}
                  </span>
                  {items.length > 1 && <span className="ml-auto text-slate-400">prévia da imagem selecionada · as mesmas medidas valem para as {items.length}</span>}
                </div>
              )}
            </div>

            {/* Painel de ajustes */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-extrabold text-slate-900">Tamanho da imagem</span>
                <button onClick={resetToOriginal} className="text-xs font-semibold text-slate-500 hover:text-slate-900 inline-flex items-center gap-1">
                  <RotateCcw className="w-3.5 h-3.5" /> Original
                </button>
              </div>

              <Select label="Unidade" value={unit} onChange={(e) => changeUnit(e.target.value as Unit)}>
                <option value="px">Pixels</option>
                <option value="percent">Porcentagem</option>
                <option value="cm">Centímetros</option>
                <option value="in">Polegadas</option>
              </Select>

              {unit === 'percent' ? (
                <div className="space-y-2">
                  <Input
                    label="Escala (%)"
                    type="number"
                    min={1}
                    max={800}
                    value={pct}
                    onChange={(e) => setPct(Math.min(800, Math.max(1, Number(e.target.value) || 1)))}
                  />
                  <input
                    type="range"
                    min={1}
                    max={400}
                    value={Math.min(400, pct)}
                    onChange={(e) => setPct(Number(e.target.value))}
                    className="w-full accent-brand-600"
                  />
                  <p className="text-xs text-slate-500">Cada imagem escala em relação ao próprio tamanho — útil para lotes com dimensões diferentes.</p>
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <Input label="Largura" value={wText} onChange={(e) => onWidth(e.target.value)} inputMode="decimal" />
                  <button
                    onClick={() => setLock((v) => !v)}
                    title={lock ? 'Proporção travada' : 'Proporção livre'}
                    className={cn(
                      'h-10 w-10 shrink-0 rounded-xl border grid place-items-center transition-colors',
                      lock ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-400 hover:text-slate-700'
                    )}
                  >
                    {lock ? <Link2 className="w-4 h-4" /> : <Unlink className="w-4 h-4" />}
                  </button>
                  <Input label="Altura" value={hText} onChange={(e) => onHeight(e.target.value)} inputMode="decimal" />
                </div>
              )}

              {(unit === 'cm' || unit === 'in') && (
                <Input
                  label="Resolução (dpi)"
                  type="number"
                  min={1}
                  max={1200}
                  value={dpi}
                  onChange={(e) => changeDpi(Number(e.target.value))}
                  hint={out ? `${out.w}×${out.h} px no arquivo final` : undefined}
                />
              )}

              <div>
                <span className="block text-xs font-semibold text-slate-600 mb-1.5">Atalhos</span>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => applyPreset(p)}
                      title={p.hint}
                      className="px-2.5 h-7 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:border-brand-300 hover:text-brand-700 transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <Select label="Se a proporção não bater" value={fit} onChange={(e) => setFit(e.target.value as Fit)} hint={FITS.find((f) => f.value === fit)?.help}>
                  {FITS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </Select>

                {fit === 'contain' && (
                  <div className="space-y-2">
                    <Switch checked={transparent} onChange={setTransparent} label="Fundo transparente" description="Só vale em PNG e WEBP; em JPG a cor abaixo é usada." />
                    {(!transparent || format === 'jpeg') && (
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                        Cor de fundo
                        <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-8 w-12 rounded-lg border border-slate-200 bg-white p-0.5" />
                      </label>
                    )}
                  </div>
                )}

                <Select label="Formato de saída" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                  <option value="auto">Manter o original</option>
                  <option value="jpeg">JPG (menor arquivo)</option>
                  <option value="png">PNG (sem perdas)</option>
                  <option value="webp">WEBP (moderno)</option>
                </Select>

                {format !== 'png' && (
                  <div>
                    <span className="flex items-center justify-between text-xs font-semibold text-slate-600 mb-1.5">
                      Qualidade <span className="font-mono text-slate-500">{Math.round(quality * 100)}%</span>
                    </span>
                    <input type="range" min={30} max={100} value={Math.round(quality * 100)} onChange={(e) => setQuality(Number(e.target.value) / 100)} className="w-full accent-brand-600" />
                  </div>
                )}

                <Select label="Reamostragem" value={resample} onChange={(e) => setResample(e.target.value as Resample)} hint={resample === 'smooth' ? 'Redução em etapas: bordas limpas em fotos.' : 'Sem suavização: preserva pixels duros (pixel art, prints).'}>
                  <option value="smooth">Suave (fotos)</option>
                  <option value="pixel">Nítida (pixel art)</option>
                </Select>

                <Switch checked={noUpscale} onChange={setNoUpscale} label="Não aumentar" description="Imagens menores que o alvo ficam no tamanho original, sem esticar." />
              </div>
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
};

export default ImageResizeStudio;
