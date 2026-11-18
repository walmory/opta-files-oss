import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Download, Save, FileText, Trash2, UploadCloud, Copy, Check, AlertCircle, Sparkles, Palette, Loader2,
  ClipboardCopy, Bookmark, BookmarkPlus, Frame as FrameIcon, Gauge, Ruler, Layers, X, CheckCircle2, AlertTriangle, Archive
} from 'lucide-react';
import QRCodeStyling, { type Options as QrStyleOptions, type DotType, type CornerSquareType, type CornerDotType, type Gradient } from 'qr-code-styling';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { cn, Button, Input, Select, Textarea, Badge, Switch, useToast } from '../../../components/ui';
import { saveDocument, downloadBlob, pushRecentTool } from '../history';
import { QR_TYPES, buildQrValue, findQrType, qrFileName, type QrType } from '../qr';
import { extractPalette, contrastRatio, ensureScannable, type Swatch } from '../logoPalette';
import { composeLogoBadge, DEFAULT_LOGO_BADGE, type LogoShape } from '../logoBadge';
import { analyzeQr, scoreTone, scoreLabel, type IssueTone } from '../qrDiagnostics';
import { FRAMES, DEFAULT_CAPTION, frameLayout, renderFramedPng, renderFramedSvg, type FrameId } from '../qrFrame';
import { createZip } from '../zip';
import type { PdfTool } from '../tools';

interface Props {
  tool: PdfTool;
  onBack: () => void;
}

type Level = 'L' | 'M' | 'Q' | 'H';
type FillMode = 'solid' | 'linear' | 'radial';

/** Module (dot) patterns exposed to the user, in the order they read best. */
const PATTERNS: { id: DotType; label: string }[] = [
  { id: 'square', label: 'Quadrado' },
  { id: 'rounded', label: 'Arredondado' },
  { id: 'extra-rounded', label: 'Suave' },
  { id: 'dots', label: 'Bolinhas' },
  { id: 'classy', label: 'Clássico' },
  { id: 'classy-rounded', label: 'Clássico suave' }
];

const EYE_FRAMES: { id: CornerSquareType; label: string }[] = [
  { id: 'square', label: 'Quadrado' },
  { id: 'extra-rounded', label: 'Arredondado' },
  { id: 'dot', label: 'Círculo' }
];

const EYE_BALLS: { id: CornerDotType; label: string }[] = [
  { id: 'square', label: 'Quadrado' },
  { id: 'dot', label: 'Círculo' },
  { id: 'rounded', label: 'Suave' }
];

/** Everything a preset stores — the payload is deliberately left out. */
interface StyleState {
  fg: string;
  fg2: string;
  fill: FillMode;
  bg: string;
  transparent: boolean;
  eye: string;
  eyeBall: string;
  pattern: DotType;
  frame: CornerSquareType;
  ball: CornerDotType;
  round: number;
  level: Level;
  margin: number;
  frameId: FrameId;
  caption: string;
  frameColor: string;
}

interface Theme extends Pick<StyleState, 'fg' | 'fg2' | 'fill' | 'bg' | 'eye' | 'eyeBall' | 'pattern' | 'frame' | 'ball' | 'round'> {
  label: string;
}

const THEMES: Theme[] = [
  { label: 'Papel', fg: '#1a1a1a', fg2: '#1a1a1a', fill: 'solid', bg: '#faf7f0', eye: '#1a1a1a', eyeBall: '#1a1a1a', pattern: 'extra-rounded', frame: 'dot', ball: 'dot', round: 0 },
  { label: 'Meia-noite', fg: '#f8fafc', fg2: '#a5b4fc', fill: 'linear', bg: '#0b1120', eye: '#818cf8', eyeBall: '#f8fafc', pattern: 'rounded', frame: 'extra-rounded', ball: 'dot', round: 0.15 },
  { label: 'Marca', fg: '#1d4ed8', fg2: '#0ea5e9', fill: 'linear', bg: '#ffffff', eye: '#0f172a', eyeBall: '#1d4ed8', pattern: 'classy-rounded', frame: 'extra-rounded', ball: 'dot', round: 0 },
  { label: 'Pastel', fg: '#7c3aed', fg2: '#db2777', fill: 'radial', bg: '#fdf4ff', eye: '#7c3aed', eyeBall: '#db2777', pattern: 'dots', frame: 'dot', ball: 'dot', round: 0.3 },
  { label: 'Esmeralda', fg: '#047857', fg2: '#0f766e', fill: 'linear', bg: '#ecfdf5', eye: '#064e3b', eyeBall: '#047857', pattern: 'rounded', frame: 'extra-rounded', ball: 'square', round: 0.1 },
  { label: 'Clássico', fg: '#000000', fg2: '#000000', fill: 'solid', bg: '#ffffff', eye: '#000000', eyeBall: '#000000', pattern: 'square', frame: 'square', ball: 'square', round: 0 }
];

const SIZES = [
  { id: 512, label: 'Social', hint: '512 px' },
  { id: 1024, label: 'Cartão', hint: '1024 px' },
  { id: 2048, label: 'Impressão', hint: '2048 px' }
];

const PREVIEW_SIZE = 300;
const PREVIEW_BOX = 288;
const PRESET_KEY = 'opta_qr_presets';
const BATCH_LIMIT = 200;

/** Printed size of an export at the usual 300 DPI press resolution. */
const mmAt300 = (px: number) => Math.round((px / 300) * 25.4 * 10) / 10;

const slugLine = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'qrcode';

/** Small visual sample of a module pattern, drawn with plain divs (cheap, no QR instance). */
const PatternIcon = ({ type, color }: { type: DotType; color: string }) => {
  const cls =
    type === 'dots'
      ? 'rounded-full'
      : type === 'rounded'
        ? 'rounded-[3px]'
        : type === 'extra-rounded'
          ? 'rounded-[5px]'
          : type === 'classy' || type === 'classy-rounded'
            ? 'rounded-tl-full rounded-br-full'
            : '';
  return (
    <div className="grid grid-cols-3 gap-[2px]">
      {[1, 1, 0, 1, 1, 1, 0, 1, 1].map((on, i) => (
        <span key={i} className={cn('w-[7px] h-[7px]', cls)} style={{ background: on ? color : 'transparent' }} />
      ))}
    </div>
  );
};

const ColorField = ({ label, color, onChange }: { label: string; color: string; onChange: (v: string) => void }) => (
  <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 h-11 cursor-pointer hover:border-slate-300 transition-colors">
    <input type="color" value={color} onChange={(e) => onChange(e.target.value)} className="w-6 h-6 rounded-md border-0 bg-transparent p-0 cursor-pointer" aria-label={label} />
    <span className="text-xs font-semibold text-slate-600 flex-1 truncate">{label}</span>
    <span className="text-[10px] font-mono text-slate-400 uppercase">{color}</span>
  </label>
);

/** Badge shapes, in the order the market generators present them (bare → fully rounded). */
const LOGO_SHAPES: { id: LogoShape; label: string; radius: string }[] = [
  { id: 'none', label: 'Sem fundo', radius: '0' },
  { id: 'square', label: 'Quadrado', radius: '0' },
  { id: 'rounded', label: 'Suave', radius: '22%' },
  { id: 'squircle', label: 'Squircle', radius: '34%' },
  { id: 'circle', label: 'Círculo', radius: '50%' }
];

const gradientOf = (mode: FillMode, from: string, to: string): Gradient | undefined =>
  mode === 'solid' ? undefined : { type: mode === 'radial' ? 'radial' : 'linear', rotation: mode === 'linear' ? Math.PI / 4 : 0, colorStops: [{ offset: 0, color: from }, { offset: 1, color: to }] };

const TONE_STYLE: Record<IssueTone, { ring: string; text: string; chip: string }> = {
  ok: { ring: '#059669', text: 'text-emerald-700', chip: 'bg-emerald-50 border-emerald-200' },
  warn: { ring: '#d97706', text: 'text-amber-700', chip: 'bg-amber-50 border-amber-200' },
  error: { ring: '#e11d48', text: 'text-rose-700', chip: 'bg-rose-50 border-rose-200' }
};

const ToneIcon = ({ tone }: { tone: IssueTone }) => {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'warn' ? AlertTriangle : AlertCircle;
  return <Icon className={cn('w-3.5 h-3.5 shrink-0 mt-px', TONE_STYLE[tone].text)} />;
};

/** Score dial — a single SVG arc, no chart dependency. */
const ScoreRing = ({ score }: { score: number }) => {
  const tone = scoreTone(score);
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0">
      <circle cx="32" cy="32" r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke={TONE_STYLE[tone].ring}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${(c * score) / 100} ${c}`}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="37" textAnchor="middle" fontSize="17" fontWeight="800" fill="#0f172a">
        {score}
      </text>
    </svg>
  );
};

const QrStudio = ({ tool, onBack }: Props) => {
  const toast = useToast();

  const [type, setType] = useState<QrType>('url');
  const [values, setValues] = useState<Record<QrType, Record<string, string>>>(() => {
    const seed = {} as Record<QrType, Record<string, string>>;
    QR_TYPES.forEach((t) => {
      seed[t.id] = {};
      t.fields.forEach((f) => {
        if (f.type === 'select' && f.options?.length) seed[t.id][f.key] = f.options[0].value;
      });
    });
    return seed;
  });

  // style
  const [fg, setFg] = useState('#1d4ed8');
  const [fg2, setFg2] = useState('#0ea5e9');
  const [fill, setFill] = useState<FillMode>('linear');
  const [bg, setBg] = useState('#ffffff');
  const [transparent, setTransparent] = useState(false);
  const [eye, setEye] = useState('#0f172a');
  const [eyeBall, setEyeBall] = useState('#1d4ed8');
  const [pattern, setPattern] = useState<DotType>('classy-rounded');
  const [frame, setFrame] = useState<CornerSquareType>('extra-rounded');
  const [ball, setBall] = useState<CornerDotType>('dot');
  const [round, setRound] = useState(0);
  const [level, setLevel] = useState<Level>('H');
  const [margin, setMargin] = useState(4);
  const [size, setSize] = useState(1024);

  // call-to-action frame
  const [frameId, setFrameId] = useState<FrameId>('none');
  const [caption, setCaption] = useState(DEFAULT_CAPTION);
  const [frameColor, setFrameColor] = useState('#1d4ed8');

  // logo
  const [logo, setLogo] = useState<string | null>(null);
  const [logoName, setLogoName] = useState('');
  const [logoSize, setLogoSize] = useState(30);
  const [palette, setPalette] = useState<Swatch[]>([]);
  const [scanningLogo, setScanningLogo] = useState(false);
  const [dragging, setDragging] = useState(false);
  // logo badge (shape / padding / backdrop / ring) — composed into a single image
  const [logoShape, setLogoShape] = useState<LogoShape>(DEFAULT_LOGO_BADGE.shape);
  const [logoPad, setLogoPad] = useState(DEFAULT_LOGO_BADGE.padding);
  const [logoBackdrop, setLogoBackdrop] = useState(DEFAULT_LOGO_BADGE.backdrop);
  const [logoRing, setLogoRing] = useState(DEFAULT_LOGO_BADGE.ring);
  const [logoRingColor, setLogoRingColor] = useState('#1d4ed8');
  const [logoShadow, setLogoShadow] = useState(false);
  const [logoTrim, setLogoTrim] = useState(true);
  /** the composed badge actually stamped into the QR (falls back to the raw upload) */
  const [logoBadge, setLogoBadge] = useState<{ src: string; key: string } | null>(null);

  // presets
  const [presets, setPresets] = useState<{ id: string; name: string; style: StyleState }[]>(() => {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [presetName, setPresetName] = useState('');

  // batch
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchProgress, setBatchProgress] = useState(0);

  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const previewRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<QRCodeStyling | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const def = findQrType(type);
  const current = values[type];
  const value = useMemo(() => buildQrValue(type, current), [type, current]);
  const missing = def.fields.filter((f) => f.required && !(current[f.key] || '').trim()).map((f) => f.label);

  const bgColor = transparent ? 'rgba(0,0,0,0)' : bg;

  const diag = useMemo(
    () => analyzeQr({ value, level, margin, logoSize, hasLogo: Boolean(logo), fg, bg, transparent }),
    [value, level, margin, logoSize, logo, fg, bg, transparent]
  );

  // Re-compose the badge whenever the artwork or its styling changes. The result is a
  // plain square PNG, so every export path keeps rendering exactly what the preview shows.
  const badgeKey = `${logoShape}|${logoPad}|${logoBackdrop}|${logoRing}|${logoRingColor}|${logoShadow}|${logoTrim}`;
  useEffect(() => {
    if (!logo) return;
    let alive = true;
    composeLogoBadge(logo, { shape: logoShape, padding: logoPad, backdrop: logoBackdrop, ring: logoRing, ringColor: logoRingColor, shadow: logoShadow, trim: logoTrim })
      .then((src) => alive && setLogoBadge({ src, key: `${logo}|${badgeKey}` }))
      .catch(() => alive && setLogoBadge({ src: logo, key: `${logo}|${badgeKey}` }));
    return () => {
      alive = false;
    };
  }, [logo, badgeKey, logoShape, logoPad, logoBackdrop, logoRing, logoRingColor, logoShadow, logoTrim]);

  // While a new badge is being composed the raw upload is used, so the QR never goes blank.
  const composedBadge = logo && logoBadge?.key === `${logo}|${badgeKey}` ? logoBadge.src : null;
  const logoImage = composedBadge || logo;
  /** A shaped badge already carries its own padding; only a bare logo needs the library gap. */
  const badgeGap = logoShape === 'none' ? 0.012 : 0;
  /** With a circle the punched-out square would leave four empty corners — keep the dots there. */
  const keepDotsAroundBadge = logoShape === 'circle' && logoBackdrop !== 'transparent';

  /** One options object, parameterized by output size so preview and export stay identical. */
  const buildOptions = useCallback(
    (px: number, drawType: 'canvas' | 'svg', data?: string): QrStyleOptions => ({
      type: drawType,
      shape: 'square',
      width: px,
      height: px,
      margin: Math.round((px * margin) / 40),
      data: data || value || ' ',
      image: logoImage || undefined,
      qrOptions: { errorCorrectionLevel: level },
      imageOptions: { imageSize: logoSize / 100, margin: Math.round(px * badgeGap), hideBackgroundDots: !keepDotsAroundBadge, crossOrigin: 'anonymous' },
      dotsOptions: { type: pattern, color: fg, gradient: gradientOf(fill, fg, fg2) },
      cornersSquareOptions: { type: frame, color: eye },
      cornersDotOptions: { type: ball, color: eyeBall },
      backgroundOptions: { color: bgColor, round }
    }),
    [value, logoImage, badgeGap, keepDotsAroundBadge, logoSize, level, margin, pattern, fg, fg2, fill, frame, eye, ball, eyeBall, bgColor, round]
  );

  // Mount the live preview once, then patch it on every change.
  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    const qr = new QRCodeStyling(buildOptions(PREVIEW_SIZE, 'canvas'));
    qr.append(host);
    qrRef.current = qr;
    return () => {
      host.innerHTML = '';
      qrRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    qrRef.current?.update(buildOptions(PREVIEW_SIZE, 'canvas'));
  }, [buildOptions]);

  useEffect(() => {
    pushRecentTool(tool.id);
  }, [tool.id]);

  const setField = (key: string, v: string) => setValues((prev) => ({ ...prev, [type]: { ...prev[type], [key]: v } }));

  const applyTheme = (t: Theme) => {
    setFg(t.fg);
    setFg2(t.fg2);
    setFill(t.fill);
    setBg(t.bg);
    setTransparent(false);
    setEye(t.eye);
    setEyeBall(t.eyeBall);
    setPattern(t.pattern);
    setFrame(t.frame);
    setBall(t.ball);
    setRound(t.round);
    setFrameColor(t.fill === 'solid' ? t.fg : t.fg2);
  };

  // ------------------------------------------------------------------ logo

  const onLogo = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Arquivo inválido', 'Envie uma imagem PNG, SVG ou JPG.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error('Logo muito grande', 'Use uma imagem de até 4 MB.');
      return;
    }
    setScanningLogo(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const src = String(reader.result);
      setLogo(src);
      setLogoName(file.name);
      setLevel('H'); // a logo covers modules — max redundancy keeps it scannable
      const colors = await extractPalette(src);
      setPalette(colors);
      setScanningLogo(false);
      if (colors.length) toast.success('Cores da logo detectadas', 'Use “Aplicar cores da logo” para gerar o QR na identidade da marca.');
    };
    reader.onerror = () => {
      setScanningLogo(false);
      toast.error('Não foi possível ler a imagem');
    };
    reader.readAsDataURL(file);
  };

  /** Builds a QR "in the shape of" the uploaded logo: brand gradient + matching eyes. */
  const applyBrandColors = () => {
    if (!palette.length) return;
    const tooLight = contrastRatio(palette[0].hex, '#ffffff') < 2.2;
    const base = tooLight ? '#0f172a' : palette[0].hex;
    const second = palette[1]?.hex || palette[0].hex;
    setTransparent(false);
    setBg('#ffffff');
    setFg(ensureScannable(base, '#ffffff'));
    setFg2(ensureScannable(second, '#ffffff', 4));
    setFill(palette.length > 1 ? 'linear' : 'solid');
    setEye(ensureScannable(second, '#ffffff'));
    setEyeBall(ensureScannable(base, '#ffffff'));
    setFrameColor(ensureScannable(base, '#ffffff'));
  };

  const removeLogo = () => {
    setLogo(null);
    setLogoName('');
    setPalette([]);
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  // --------------------------------------------------------------- presets

  const persistPresets = (next: { id: string; name: string; style: StyleState }[]) => {
    setPresets(next);
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(next));
    } catch {
      toast.error('Não foi possível salvar o preset', 'O armazenamento do navegador está cheio ou bloqueado.');
    }
  };

  const currentStyle = (): StyleState => ({ fg, fg2, fill, bg, transparent, eye, eyeBall, pattern, frame, ball, round, level, margin, frameId, caption, frameColor });

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) {
      toast.error('Dê um nome ao preset');
      return;
    }
    const next = [...presets.filter((p) => p.name.toLowerCase() !== name.toLowerCase()), { id: `${Date.now()}`, name, style: currentStyle() }].slice(-24);
    persistPresets(next);
    setPresetName('');
    toast.success('Preset salvo', `“${name}” ficou disponível neste navegador.`);
  };

  const applyPreset = (s: StyleState) => {
    setFg(s.fg);
    setFg2(s.fg2);
    setFill(s.fill);
    setBg(s.bg);
    setTransparent(s.transparent);
    setEye(s.eye);
    setEyeBall(s.eyeBall);
    setPattern(s.pattern);
    setFrame(s.frame);
    setBall(s.ball);
    setRound(s.round);
    setLevel(s.level);
    setMargin(s.margin);
    setFrameId(s.frameId);
    setCaption(s.caption);
    setFrameColor(s.frameColor);
  };

  // --------------------------------------------------------------- exports

  const frameArgs = useCallback((px: number) => [frameId, px, caption, frameColor] as const, [frameId, caption, frameColor]);

  const exportBlob = useCallback(
    async (kind: 'png' | 'svg', data?: string): Promise<Blob> => {
      const qr = new QRCodeStyling(buildOptions(size, kind === 'svg' ? 'svg' : 'canvas', data));
      const raw = await qr.getRawData(kind);
      if (!raw) throw new Error('Falha ao gerar a imagem.');
      const blob = raw instanceof Blob ? raw : new Blob([raw as BlobPart], { type: kind === 'svg' ? 'image/svg+xml' : 'image/png' });
      const [f, px, cap, accent] = frameArgs(size);
      return kind === 'svg' ? renderFramedSvg(blob, f, px, cap, accent) : renderFramedPng(blob, f, px, cap, accent);
    },
    [buildOptions, size, frameArgs]
  );

  const pdfBlob = useCallback(async () => {
    const png = await exportBlob('png');
    const layout = frameLayout(frameId, size, caption, frameColor);
    const pdf = await PDFDocument.create();
    const W = 595.28;
    const H = 841.89; // A4
    const page = pdf.addPage([W, H]);
    const img = await pdf.embedPng(await png.arrayBuffer());
    const box = 320;
    const scale = box / Math.max(layout.width, layout.height);
    const w = layout.width * scale;
    const h = layout.height * scale;
    page.drawImage(img, { x: (W - w) / 2, y: H - 200 - h, width: w, height: h });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const text = value.length > 90 ? `${value.slice(0, 90)}…` : value;
    page.drawText(def.label, { x: 60, y: H - 120, size: 20, font: bold, color: rgb(0.06, 0.09, 0.16) });
    page.drawText(text, { x: 60, y: H - 240 - h, size: 9, font, color: rgb(0.4, 0.45, 0.5), maxWidth: 475 });
    const specs = `${size} px · ${mmAt300(size)} mm a 300 DPI · versão ${diag.version || '—'} (${diag.modules}×${diag.modules}) · correção ${level} · tamanho mínimo recomendado ${diag.minPrintMm} mm`;
    page.drawText(specs, { x: 60, y: 60, size: 8, font, color: rgb(0.55, 0.6, 0.66), maxWidth: 475 });
    const bytes = await pdf.save();
    return new Blob([bytes.slice().buffer], { type: 'application/pdf' });
  }, [exportBlob, value, def.label, frameId, size, caption, frameColor, diag, level]);

  const guardValue = () => {
    if (value) return true;
    toast.error('Preencha os dados', missing.length ? `Faltando: ${missing.join(', ')}.` : 'Informe o conteúdo do QR code.');
    return false;
  };

  const download = async (kind: 'png' | 'svg' | 'pdf') => {
    if (!guardValue()) return;
    setBusy(true);
    try {
      const blob = kind === 'pdf' ? await pdfBlob() : await exportBlob(kind);
      downloadBlob(blob, `${qrFileName(type, current)}.${kind}`);
    } catch (e) {
      toast.error('Erro ao exportar', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const saveToDocs = async (kind: 'png' | 'pdf') => {
    if (!guardValue()) return;
    setBusy(true);
    try {
      const blob = kind === 'pdf' ? await pdfBlob() : await exportBlob('png');
      await saveDocument(blob, {
        name: `${qrFileName(type, current)}.${kind}`,
        contentType: kind === 'pdf' ? 'application/pdf' : 'image/png',
        kind: kind === 'pdf' ? 'pdf' : 'image',
        source: 'tool',
        toolId: tool.id,
        toolName: tool.name
      });
      toast.success('Salvo em Documentos');
    } catch (e) {
      toast.error('Erro ao salvar', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const copyImage = async () => {
    if (!guardValue()) return;
    setBusy(true);
    try {
      const blob = await exportBlob('png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast.success('Imagem copiada', 'Cole direto no Canva, Word, Figma ou no chat.');
    } catch {
      toast.error('Não foi possível copiar', 'O navegador bloqueou o acesso à área de transferência. Baixe o PNG.');
    } finally {
      setBusy(false);
    }
  };

  const copyValue = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  // ----------------------------------------------------------------- batch

  const batchLines = useMemo(() => batchText.split('\n').map((l) => l.trim()).filter(Boolean), [batchText]);

  const runBatch = async () => {
    if (!batchLines.length) {
      toast.error('Cole ao menos uma linha', 'Um conteúdo por linha — links, códigos ou textos.');
      return;
    }
    if (batchLines.length > BATCH_LIMIT) {
      toast.error('Lista grande demais', `Máximo de ${BATCH_LIMIT} códigos por lote.`);
      return;
    }
    setBusy(true);
    setBatchProgress(0);
    try {
      const used = new Set<string>();
      const entries: { name: string; blob: Blob }[] = [];
      for (let i = 0; i < batchLines.length; i++) {
        const line = batchLines[i];
        let name = slugLine(line);
        while (used.has(name)) name = `${name}-${used.size + 1}`;
        used.add(name);
        entries.push({ name: `${name}.png`, blob: await exportBlob('png', line) });
        setBatchProgress(Math.round(((i + 1) / batchLines.length) * 100));
      }
      const zip = await createZip(entries);
      downloadBlob(zip, `qrcodes-lote-${entries.length}.zip`);
      toast.success('Lote gerado', `${entries.length} códigos no ZIP, todos com o estilo atual.`);
    } catch (e) {
      toast.error('Erro na geração em lote', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
      setBatchProgress(0);
    }
  };

  // --------------------------------------------------------------- preview

  const previewLayout = useMemo(() => frameLayout(frameId, PREVIEW_SIZE, caption, frameColor), [frameId, caption, frameColor]);
  const previewScale = PREVIEW_BOX / Math.max(previewLayout.width, previewLayout.height);
  /** Where the code itself sits inside the frame; the host div is positioned from this. */
  const qrSlot = useMemo(() => {
    const slot = previewLayout.shapes.find((s) => s.kind === 'qr');
    return slot && slot.kind === 'qr' ? slot : { x: 0, y: 0, size: PREVIEW_SIZE };
  }, [previewLayout]);

  const sectionTitle = 'text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 flex items-center gap-1.5 mb-3';
  const scoreT = scoreTone(diag.score);

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
            <p className="text-xs text-slate-500 truncate">Padrões, olhos, gradiente, logo, moldura de chamada e diagnóstico de leitura — pronto para impressão.</p>
          </div>
          <Button variant="secondary" icon={ClipboardCopy} loading={busy} onClick={copyImage}>
            Copiar imagem
          </Button>
          <Button icon={Download} loading={busy} onClick={() => download('png')}>
            Baixar PNG
          </Button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
          {/* ---------------------------------------------------------- left */}
          <div className="space-y-5">
            {/* type picker */}
            <div className="surface p-4">
              <p className={sectionTitle}>Tipo de QR code</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {QR_TYPES.map((t) => (
                  <button key={t.id} onClick={() => setType(t.id)} className={cn('rounded-xl border p-3 text-left transition-all', type === t.id ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/15' : 'border-slate-200 bg-white hover:border-slate-300')}>
                    <t.icon className={cn('w-4 h-4 mb-1.5', type === t.id ? 'text-brand-600' : 'text-slate-400')} />
                    <p className="text-xs font-bold text-slate-900 leading-tight">{t.label}</p>
                  </button>
                ))}
              </div>
              <p className="mt-2.5 text-xs text-slate-500">{def.description}</p>
            </div>

            {/* data */}
            <div className="surface p-4">
              <p className={sectionTitle}>Dados</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {def.fields.map((f) => (
                  <div key={f.key} className={cn(f.half ? 'sm:col-span-1' : 'sm:col-span-2')}>
                    {f.type === 'textarea' ? (
                      <Textarea label={f.label} hint={f.help} placeholder={f.placeholder} rows={3} value={current[f.key] || ''} onChange={(e) => setField(f.key, e.target.value)} />
                    ) : f.type === 'select' ? (
                      <Select label={f.label} hint={f.help} value={current[f.key] || ''} onChange={(e) => setField(f.key, e.target.value)}>
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input label={f.label} hint={f.help} placeholder={f.placeholder} type={f.type === 'number' ? 'number' : 'text'} value={current[f.key] || ''} onChange={(e) => setField(f.key, e.target.value)} />
                    )}
                  </div>
                ))}
              </div>
              {missing.length > 0 && <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">Preencha: {missing.join(', ')}.</p>}
            </div>

            {/* logo / brand */}
            <div className="surface p-4">
              <p className={sectionTitle}>
                <Sparkles className="w-3.5 h-3.5" /> Logo da marca
              </p>
              {logo ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    {/* live badge preview, on the same background the QR uses */}
                    <div className="w-14 h-14 shrink-0 rounded-xl p-1.5 ring-1 ring-inset ring-slate-200 bg-[length:10px_10px] bg-[linear-gradient(45deg,#e2e8f0_25%,transparent_25%),linear-gradient(-45deg,#e2e8f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e2e8f0_75%),linear-gradient(-45deg,transparent_75%,#e2e8f0_75%)] bg-[position:0_0,0_5px,5px_-5px,-5px_0]" style={{ backgroundColor: transparent ? undefined : bg }}>
                      <img src={logoImage ?? undefined} alt="" className="w-full h-full object-contain" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-900 truncate">{logoName}</p>
                      <p className="text-[11px] text-slate-500">{scanningLogo ? 'Analisando cores…' : palette.length ? `${palette.length} cores detectadas` : 'Sem cores dominantes claras'}</p>
                    </div>
                    <button onClick={() => logoInputRef.current?.click()} className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-white transition-colors" aria-label="Trocar logo">
                      <UploadCloud className="w-4 h-4" />
                    </button>
                    <button onClick={removeLogo} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-white transition-colors" aria-label="Remover logo">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* badge shape */}
                  <div>
                    <p className="text-xs font-semibold text-slate-600 mb-1.5">Formato do selo</p>
                    <div className="grid grid-cols-5 gap-1.5">
                      {LOGO_SHAPES.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setLogoShape(s.id)}
                          aria-pressed={logoShape === s.id}
                          title={s.label}
                          className={cn('flex flex-col items-center gap-1 rounded-xl border px-1 py-2 transition-colors', logoShape === s.id ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 hover:border-brand-300 text-slate-500')}
                        >
                          {s.id === 'none' ? (
                            <span className="w-5 h-5 grid place-items-center text-[13px] font-black leading-none text-current">A</span>
                          ) : (
                            <span className="w-5 h-5 border-2 border-current" style={{ borderRadius: s.radius }} />
                          )}
                          <span className="text-[9px] font-bold leading-none">{s.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* backdrop + finishing */}
                  {logoShape !== 'none' && (
                    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-600 mb-1.5">Fundo do selo</p>
                        <div className="flex items-center gap-1.5">
                          {[
                            { hex: '#ffffff', label: 'Branco' },
                            { hex: transparent ? '#ffffff' : bg, label: 'Fundo do QR' },
                            { hex: fg, label: 'Cor principal' },
                            { hex: '#0f172a', label: 'Grafite' }
                          ].map((c, i) => (
                            <button key={i} onClick={() => setLogoBackdrop(c.hex)} title={c.label} className={cn('w-8 h-8 rounded-lg border-2 transition-transform hover:scale-105', logoBackdrop.toLowerCase() === c.hex.toLowerCase() ? 'border-brand-500' : 'border-slate-200')} style={{ background: c.hex }} />
                          ))}
                          <button onClick={() => setLogoBackdrop('transparent')} title="Transparente" className={cn('w-8 h-8 rounded-lg border-2 bg-[length:8px_8px] bg-[linear-gradient(45deg,#e2e8f0_25%,transparent_25%),linear-gradient(-45deg,#e2e8f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e2e8f0_75%),linear-gradient(-45deg,transparent_75%,#e2e8f0_75%)] bg-[position:0_0,0_4px,4px_-4px,-4px_0]', logoBackdrop === 'transparent' ? 'border-brand-500' : 'border-slate-200')} />
                          <input type="color" value={logoBackdrop === 'transparent' ? '#ffffff' : logoBackdrop} onChange={(e) => setLogoBackdrop(e.target.value)} className="w-8 h-8 rounded-lg border-2 border-slate-200 bg-transparent p-0 cursor-pointer" aria-label="Cor do fundo do selo" />
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-600 mb-1">
                          <span>Respiro interno</span>
                          <span className="text-slate-400">{logoPad}%</span>
                        </div>
                        <input type="range" min={0} max={24} value={logoPad} onChange={(e) => setLogoPad(Number(e.target.value))} className="w-full accent-brand-600" />
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-600 mb-1">
                          <span>Borda do selo</span>
                          <span className="text-slate-400">{logoRing ? `${logoRing}%` : 'sem borda'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="range" min={0} max={8} value={logoRing} onChange={(e) => setLogoRing(Number(e.target.value))} className="flex-1 accent-brand-600" />
                          <input type="color" value={logoRingColor} onChange={(e) => setLogoRingColor(e.target.value)} className="w-8 h-8 rounded-lg border border-slate-200 bg-transparent p-0 cursor-pointer" aria-label="Cor da borda do selo" />
                        </div>
                      </div>

                      <Switch checked={logoShadow} onChange={setLogoShadow} label="Sombra suave" description="Destaca o selo do padrão de módulos." />
                    </div>
                  )}

                  <Switch checked={logoTrim} onChange={setLogoTrim} label="Recortar margens da imagem" description="Ignora a área transparente do arquivo para a logo ocupar todo o selo." />

                  {palette.length > 0 && (
                    <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        {palette.map((s) => (
                          <button key={s.hex} onClick={() => setFg(ensureScannable(s.hex, transparent ? '#ffffff' : bg))} className="w-8 h-8 rounded-lg border border-white shadow-sm hover:scale-110 transition-transform" style={{ background: s.hex }} title={`${s.hex} · usar como cor principal`} />
                        ))}
                      </div>
                      <Button size="sm" variant="secondary" icon={Palette} onClick={applyBrandColors} className="w-full">
                        Aplicar cores da logo
                      </Button>
                      <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">Gera o QR na identidade da marca: gradiente com as cores dominantes e olhos combinando, já ajustados para continuar legível.</p>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-600 mb-1">
                      <span>Tamanho da logo</span>
                      <span className="text-slate-400">
                        {logoSize}% · cobre {diag.logoCoverage.toFixed(0)}% da área (limite {diag.logoBudget}%)
                      </span>
                    </div>
                    <input type="range" min={15} max={50} value={logoSize} onChange={(e) => setLogoSize(Number(e.target.value))} className="w-full accent-brand-600" />
                    {diag.logoCoverage > diag.logoBudget && (
                      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                        <span>
                          A logo passa do limite de recuperação do nível {level}. Reduza para ~{Math.max(15, Math.floor(logoSize * Math.sqrt(diag.logoBudget / Math.max(diag.logoCoverage, 1))))}% ou use correção Alta.
                          <button onClick={() => setLogoSize(Math.max(15, Math.floor(logoSize * Math.sqrt(diag.logoBudget / Math.max(diag.logoCoverage, 1)))))} className="ml-1 font-bold underline underline-offset-2">
                            Ajustar
                          </button>
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => logoInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    onLogo(e.dataTransfer.files?.[0]);
                  }}
                  className={cn('w-full rounded-xl border-2 border-dashed transition-colors p-6 text-center', dragging ? 'border-brand-400 bg-brand-50' : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50/40')}
                >
                  {scanningLogo ? <Loader2 className="w-6 h-6 mx-auto text-brand-500 animate-spin" /> : <UploadCloud className="w-6 h-6 mx-auto text-slate-400" />}
                  <p className="mt-2 text-sm font-bold text-slate-700">Arraste a logo aqui ou clique para enviar</p>
                  <p className="text-xs text-slate-500">PNG, SVG ou JPG · recortamos as margens, montamos o selo e lemos as cores da marca</p>
                </button>
              )}
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
            </div>

            {/* frame / CTA */}
            <div className="surface p-4">
              <p className={sectionTitle}>
                <FrameIcon className="w-3.5 h-3.5" /> Moldura e chamada
              </p>
              <div className="grid grid-cols-5 gap-2">
                {FRAMES.map((f) => {
                  const l = frameLayout(f.id, 40, f.caption ? 'ABC' : '', frameColor);
                  const s = 56 / Math.max(l.width, l.height);
                  return (
                    <button key={f.id} onClick={() => setFrameId(f.id)} title={f.label} className={cn('rounded-xl border p-2 transition-colors', frameId === f.id ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/15' : 'border-slate-200 bg-white hover:border-slate-300')}>
                      <div className="h-[60px] flex items-center justify-center">
                        <div className="relative" style={{ width: l.width * s, height: l.height * s }}>
                          {l.shapes.map((sh, i) =>
                            sh.kind === 'rect' ? (
                              <span key={i} className="absolute" style={{ left: sh.x * s, top: sh.y * s, width: sh.w * s, height: sh.h * s, borderRadius: sh.r * s, background: sh.fill, boxShadow: sh.stroke ? `inset 0 0 0 1px ${sh.stroke}` : undefined }} />
                            ) : sh.kind === 'qr' ? (
                              <span key={i} className="absolute bg-slate-800" style={{ left: sh.x * s, top: sh.y * s, width: sh.size * s, height: sh.size * s, borderRadius: 2 }} />
                            ) : (
                              <span key={i} className="absolute rounded-full" style={{ left: '50%', top: (sh.y - sh.size * 0.75) * s, width: 18, height: 3, transform: 'translateX(-50%)', background: sh.color }} />
                            )
                          )}
                        </div>
                      </div>
                      <p className="text-[10px] font-bold text-slate-600 truncate">{f.label}</p>
                    </button>
                  );
                })}
              </div>
              {frameId !== 'none' && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input label="Texto da chamada" value={caption} maxLength={40} onChange={(e) => setCaption(e.target.value)} hint="Aparece na moldura, no PNG, SVG e PDF." />
                  <div>
                    <p className="text-xs font-semibold text-slate-600 mb-1.5">Cor da moldura</p>
                    <ColorField label="Moldura" color={frameColor} onChange={setFrameColor} />
                  </div>
                </div>
              )}
            </div>

            {/* presets */}
            <div className="surface p-4">
              <p className={sectionTitle}>
                <Bookmark className="w-3.5 h-3.5" /> Presets de marca
              </p>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input placeholder="Ex.: Identidade Opta 2026" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
                </div>
                <Button variant="secondary" icon={BookmarkPlus} onClick={savePreset}>
                  Salvar estilo
                </Button>
              </div>
              {presets.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {presets.map((p) => (
                    <div key={p.id} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white pl-2 pr-1 h-9 hover:border-brand-300 transition-colors">
                      <span className="flex gap-1">
                        <span className="w-3.5 h-3.5 rounded-full border border-white shadow-sm" style={{ background: p.style.fg }} />
                        <span className="w-3.5 h-3.5 rounded-full border border-white shadow-sm" style={{ background: p.style.bg }} />
                      </span>
                      <button onClick={() => applyPreset(p.style)} className="text-xs font-bold text-slate-700 hover:text-brand-700">
                        {p.name}
                      </button>
                      <button onClick={() => persistPresets(presets.filter((x) => x.id !== p.id))} className="p-1 rounded-lg text-slate-300 hover:text-rose-600" aria-label={`Excluir ${p.name}`}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">Salve cores, padrão, olhos, moldura e correção de erro como um preset e reaplique em qualquer QR — fica guardado neste navegador.</p>
              )}
            </div>

            {/* batch */}
            <div className="surface p-4">
              <div className="flex items-center justify-between">
                <p className={cn(sectionTitle, 'mb-0')}>
                  <Layers className="w-3.5 h-3.5" /> Geração em lote
                </p>
                <button onClick={() => setBatchOpen((v) => !v)} className="text-xs font-bold text-brand-600 hover:text-brand-700">
                  {batchOpen ? 'Fechar' : 'Abrir'}
                </button>
              </div>
              {batchOpen && (
                <div className="mt-3 space-y-3">
                  <Textarea
                    label="Um conteúdo por linha"
                    rows={6}
                    placeholder={'https://opta.com/loja/1\nhttps://opta.com/loja/2\nhttps://opta.com/loja/3'}
                    value={batchText}
                    onChange={(e) => setBatchText(e.target.value)}
                    hint={`Até ${BATCH_LIMIT} códigos. Todos saem com o estilo, a logo e a moldura configurados acima.`}
                  />
                  {busy && batchProgress > 0 && (
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-brand-600 transition-all" style={{ width: `${batchProgress}%` }} />
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <Button icon={Archive} loading={busy} onClick={runBatch}>
                      Gerar {batchLines.length || ''} códigos em ZIP
                    </Button>
                    <span className="text-xs text-slate-500">{batchLines.length} linha(s) detectada(s)</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* --------------------------------------------------------- right */}
          <div className="space-y-5 xl:sticky xl:top-6">
            {/* preview */}
            <div className="surface p-4">
              <p className={sectionTitle}>Pré-visualização</p>
              <div
                className="rounded-2xl border border-slate-200 p-4 flex items-center justify-center min-h-[332px]"
                style={{ backgroundImage: 'linear-gradient(45deg,#f1f5f9 25%,transparent 25%,transparent 75%,#f1f5f9 75%),linear-gradient(45deg,#f1f5f9 25%,transparent 25%,transparent 75%,#f1f5f9 75%)', backgroundSize: '16px 16px', backgroundPosition: '0 0,8px 8px' }}
              >
                <div className={cn('relative', !value && 'opacity-25')} style={{ width: previewLayout.width * previewScale, height: previewLayout.height * previewScale }}>
                  {previewLayout.shapes.map((sh, i) => {
                    if (sh.kind === 'rect')
                      return <span key={i} className="absolute" style={{ left: sh.x * previewScale, top: sh.y * previewScale, width: sh.w * previewScale, height: sh.h * previewScale, borderRadius: sh.r * previewScale, background: sh.fill, boxShadow: sh.stroke ? `inset 0 0 0 ${(sh.strokeWidth || 1) * previewScale}px ${sh.stroke}` : undefined }} />;
                    if (sh.kind === 'text')
                      return (
                        <span
                          key={i}
                          className="absolute font-extrabold whitespace-nowrap"
                          style={{ left: sh.x * previewScale, top: sh.y * previewScale, transform: 'translate(-50%,-88%)', fontSize: sh.size * previewScale, color: sh.color, letterSpacing: '0.04em' }}
                        >
                          {sh.text}
                        </span>
                      );
                    return null; // the QR host lives outside the map so switching frames never remounts it
                  })}
                  <div
                    ref={previewRef}
                    className="absolute [&>canvas]:w-full [&>canvas]:h-full [&>canvas]:rounded-md [&>svg]:w-full [&>svg]:h-full"
                    style={{ left: qrSlot.x * previewScale, top: qrSlot.y * previewScale, width: qrSlot.size * previewScale, height: qrSlot.size * previewScale }}
                  />
                </div>
              </div>

              {value && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Conteúdo codificado</span>
                    <button onClick={copyValue} className="text-[11px] font-bold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                  <pre className="text-[11px] font-mono text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-2.5 max-h-24 overflow-auto whitespace-pre-wrap break-all">{value}</pre>
                </div>
              )}

              <div className="mt-4 grid grid-cols-3 gap-2">
                {SIZES.map((s) => (
                  <button key={s.id} onClick={() => setSize(s.id)} className={cn('rounded-xl border px-2 py-2 text-center transition-colors', size === s.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300')}>
                    <p className="text-xs font-bold text-slate-800">{s.label}</p>
                    <p className="text-[10px] text-slate-400">{s.hint}</p>
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1">
                  <Input type="number" min={128} max={4096} step={64} value={size} onChange={(e) => setSize(Math.max(128, Math.min(4096, Number(e.target.value) || 512)))} />
                </div>
                <span className="text-[11px] text-slate-500 leading-tight">
                  {mmAt300(size)} mm
                  <br />a 300 DPI
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <Button size="sm" variant="secondary" loading={busy} onClick={() => download('png')}>
                  PNG
                </Button>
                <Button size="sm" variant="secondary" loading={busy} onClick={() => download('svg')}>
                  SVG
                </Button>
                <Button size="sm" variant="secondary" icon={FileText} loading={busy} onClick={() => download('pdf')}>
                  PDF
                </Button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button size="sm" variant="ghost" icon={Save} loading={busy} onClick={() => saveToDocs('png')}>
                  Salvar PNG
                </Button>
                <Button size="sm" variant="ghost" icon={Save} loading={busy} onClick={() => saveToDocs('pdf')}>
                  Salvar PDF
                </Button>
              </div>
            </div>

            {/* diagnostics */}
            <div className="surface p-4">
              <p className={sectionTitle}>
                <Gauge className="w-3.5 h-3.5" /> Diagnóstico de leitura
              </p>
              <div className="flex items-center gap-3">
                <ScoreRing score={diag.score} />
                <div className="min-w-0">
                  <p className={cn('text-sm font-extrabold', TONE_STYLE[scoreT].text)}>{scoreLabel(diag.score)}</p>
                  <p className="text-[11px] text-slate-500">
                    {diag.version ? `Versão ${diag.version} · ${diag.modules}×${diag.modules} módulos · ${diag.bytes} bytes` : 'Preencha os dados para analisar.'}
                  </p>
                </div>
              </div>

              {diag.version > 0 && (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        <Ruler className="w-3 h-3" /> Tamanho mínimo
                      </p>
                      <p className="text-sm font-extrabold text-slate-900">{diag.minPrintMm} mm</p>
                      <p className="text-[10px] text-slate-500">leitura até ~{diag.scanDistanceM} m</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Capacidade usada</p>
                      <p className="text-sm font-extrabold text-slate-900">{diag.capacityUsed.toFixed(0)}%</p>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                        <div className={cn('h-full', diag.capacityUsed > 92 ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${diag.capacityUsed}%` }} />
                      </div>
                    </div>
                  </div>

                  <ul className="mt-3 space-y-1.5">
                    {diag.issues.map((issue, i) => (
                      <li key={i} className={cn('flex gap-2 text-[11px] leading-relaxed rounded-xl border px-2.5 py-1.5', TONE_STYLE[issue.tone].chip)}>
                        <ToneIcon tone={issue.tone} />
                        <span className="text-slate-700">{issue.text}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {/* style panel */}
            <div className="surface p-4">
              <p className={sectionTitle}>
                <Palette className="w-3.5 h-3.5" /> Estilo
              </p>
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-1.5">Tema</p>
                  <div className="grid grid-cols-3 gap-2">
                    {THEMES.map((t) => (
                      <button key={t.label} onClick={() => applyTheme(t)} className="rounded-xl border border-slate-200 p-2 hover:border-brand-300 transition-colors" title={t.label}>
                        <div className="h-9 rounded-lg flex items-center justify-center" style={{ background: t.bg }}>
                          <PatternIcon type={t.pattern} color={t.fg} />
                        </div>
                        <p className="mt-1 text-[10px] font-bold text-slate-600 truncate">{t.label}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-1.5">Padrão dos módulos</p>
                  <div className="grid grid-cols-6 gap-1.5">
                    {PATTERNS.map((p) => (
                      <button key={p.id} onClick={() => setPattern(p.id)} title={p.label} className={cn('aspect-square rounded-xl border flex items-center justify-center transition-colors', pattern === p.id ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/15' : 'border-slate-200 bg-white hover:border-slate-300')}>
                        <PatternIcon type={p.id} color={pattern === p.id ? '#1d4ed8' : '#334155'} />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Select label="Moldura do olho" value={frame} onChange={(e) => setFrame(e.target.value as CornerSquareType)}>
                    {EYE_FRAMES.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <Select label="Centro do olho" value={ball} onChange={(e) => setBall(e.target.value as CornerDotType)}>
                    {EYE_BALLS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-slate-600">Cor do código</p>
                    <div className="flex gap-1">
                      {(['solid', 'linear', 'radial'] as FillMode[]).map((m) => (
                        <button key={m} onClick={() => setFill(m)} className={cn('h-6 px-2 rounded-full text-[10px] font-bold transition-colors', fill === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
                          {m === 'solid' ? 'Sólido' : m === 'linear' ? 'Gradiente' : 'Radial'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <ColorField label={fill === 'solid' ? 'Cor' : 'Cor inicial'} color={fg} onChange={setFg} />
                    {fill !== 'solid' && <ColorField label="Cor final" color={fg2} onChange={setFg2} />}
                    <ColorField label="Moldura dos olhos" color={eye} onChange={setEye} />
                    <ColorField label="Centro dos olhos" color={eyeBall} onChange={setEyeBall} />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-slate-600">Fundo</p>
                    <label className="text-[11px] font-semibold text-slate-500 inline-flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} className="accent-brand-600" /> Transparente
                    </label>
                  </div>
                  {!transparent && <ColorField label="Cor do fundo" color={bg} onChange={setBg} />}
                  <div className="mt-2.5 flex items-center justify-between text-xs font-semibold text-slate-600">
                    <span>Cantos do fundo</span>
                    <span className="text-slate-400">{Math.round(round * 100)}%</span>
                  </div>
                  <input type="range" min={0} max={0.5} step={0.05} value={round} onChange={(e) => setRound(Number(e.target.value))} className="w-full accent-brand-600" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Select label="Correção de erro" value={level} onChange={(e) => setLevel(e.target.value as Level)} hint={logo ? 'Alta é recomendada com logo' : undefined}>
                    <option value="L">Baixa (7%)</option>
                    <option value="M">Média (15%)</option>
                    <option value="Q">Boa (25%)</option>
                    <option value="H">Alta (30%)</option>
                  </Select>
                  <div>
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-600 mb-1">
                      <span>Margem</span>
                      <span className="text-slate-400">{margin}</span>
                    </div>
                    <input type="range" min={0} max={8} value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="w-full accent-brand-600 mt-3" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QrStudio;
