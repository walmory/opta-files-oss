import { useEffect, useMemo, useRef, useState } from 'react';
import { BadgeCheck, Download, Eraser, FileKey2, Loader2, PenLine, ShieldCheck, Type as TypeIcon, Undo2 } from 'lucide-react';
import { Badge, Button, Input, Modal, Select, cn, useToast } from '../../../components/ui';
import { downloadBlob } from '../history';
import {
  SIGNATURE_FONTS,
  generateIdentity,
  strokesToPng,
  textToPng,
  type CertFormat,
  type GeneratedIdentity,
  type SignatureFontId,
  type Stroke
} from '../signatureKit';

export interface SignatureBundle {
  identity?: GeneratedIdentity;
  visual?: { file: File; url: string };
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Nome sugerido para o signatário (vem do formulário da ferramenta). */
  defaultName?: string;
  /** Entrega o que foi gerado para a ferramenta preencher os campos. */
  onApply: (bundle: SignatureBundle) => void;
}

const PAD_W = 640;
const PAD_H = 220;
const INK = [
  { value: '#0f172a', label: 'Preto' },
  { value: '#1d4ed8', label: 'Azul' },
  { value: '#0f766e', label: 'Verde' },
  { value: '#b91c1c', label: 'Vermelho' }
];

const fmtDate = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/* bloco enquadrado: evita o "mar de inputs" e dá respiro entre os grupos de campos */
const Section = ({ title, hint, children, className }: { title: string; hint?: string; children: React.ReactNode; className?: string }) => (
  <section className={cn('rounded-xl border border-slate-200 bg-white p-4', className)}>
    <header className="mb-3">
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</h4>
      {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{hint}</p>}
    </header>
    {children}
  </section>
);

const StudioBody = ({ onClose, defaultName, onApply }: Omit<Props, 'open'>) => {
  const toast = useToast();
  const [tab, setTab] = useState<'identity' | 'visual'>('identity');

  /* ---------------- identidade digital ---------------- */
  const [format, setFormat] = useState<CertFormat>('PKCS12');
  const [commonName, setCommonName] = useState(defaultName || 'Opta Files');
  const [organization, setOrganization] = useState('Opta Files');
  const [unit, setUnit] = useState('Documentos');
  const [email, setEmail] = useState('');
  const [locality, setLocality] = useState('London');
  const [country, setCountry] = useState('GB');
  const [keySize, setKeySize] = useState<2048 | 3072 | 4096>(2048);
  const [years, setYears] = useState(3);
  const [password, setPassword] = useState('');
  const [generating, setGenerating] = useState(false);
  const [identity, setIdentity] = useState<GeneratedIdentity | undefined>();

  /* ---------------- assinatura visual ---------------- */
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [ink, setInk] = useState(INK[0].value);
  const [thickness, setThickness] = useState(3.4);
  const [fontId, setFontId] = useState<SignatureFontId>('great-vibes');
  const [typed, setTyped] = useState(defaultName || '');
  const [visual, setVisual] = useState<{ file: File; url: string } | undefined>();
  const [rendering, setRendering] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => () => { if (visual) URL.revokeObjectURL(visual.url); }, [visual]);

  /* repinta o pad sempre que traços/cor/espessura mudam */
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = PAD_W * dpr;
    canvas.height = PAD_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PAD_W, PAD_H);
    ctx.strokeStyle = ink;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = thickness;
    strokes.forEach((s) => {
      if (s.length < 2) {
        if (s.length === 1) {
          ctx.beginPath();
          ctx.arc(s[0].x * PAD_W, s[0].y * PAD_H, thickness / 2, 0, Math.PI * 2);
          ctx.fillStyle = ink;
          ctx.fill();
        }
        return;
      }
      ctx.beginPath();
      ctx.moveTo(s[0].x * PAD_W, s[0].y * PAD_H);
      for (let i = 1; i < s.length - 1; i += 1) {
        const cx = s[i].x * PAD_W;
        const cy = s[i].y * PAD_H;
        ctx.quadraticCurveTo(cx, cy, (cx + s[i + 1].x * PAD_W) / 2, (cy + s[i + 1].y * PAD_H) / 2);
      }
      ctx.lineTo(s[s.length - 1].x * PAD_W, s[s.length - 1].y * PAD_H);
      ctx.stroke();
    });
  }, [strokes, ink, thickness, tab, mode]);

  /* precisa ser resolvido no handler (síncrono): dentro do updater do setState
     o evento do React já foi reciclado e `currentTarget` vira null. */
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget ?? canvasRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };

  const startStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    const p = point(e);
    if (!p) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* alguns navegadores recusam a captura — desenhar continua funcionando */
    }
    drawing.current = true;
    setStrokes((prev) => [...prev, [p]]);
  };
  const extendStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const p = point(e);
    if (!p) return;
    setStrokes((prev) => {
      if (!prev.length) return [[p]];
      const next = prev.slice();
      next[next.length - 1] = [...next[next.length - 1], p];
      return next;
    });
  };
  const endStroke = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = false;
    if (e && e.currentTarget?.hasPointerCapture?.(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* nada a fazer */
      }
    }
  };

  const canGenerateIdentity = commonName.trim().length > 1 && password.length >= 4;
  const canRenderVisual = mode === 'draw' ? strokes.length > 0 : typed.trim().length > 0;

  const runGenerateIdentity = async () => {
    setGenerating(true);
    try {
      const id = await generateIdentity(format, {
        commonName: commonName.trim(),
        organization: organization.trim() || undefined,
        organizationalUnit: unit.trim() || undefined,
        email: email.trim() || undefined,
        locality: locality.trim() || undefined,
        country: country.trim().toUpperCase().slice(0, 2) || undefined,
        keySize,
        validityYears: years,
        password
      });
      setIdentity(id);
      toast.success('Certificado gerado', format === 'PKCS12' ? `${id.p12File?.name} pronto para uso` : 'Par PEM pronto para uso');
    } catch (e) {
      toast.error('Falha ao gerar certificado', e instanceof Error ? e.message : undefined);
    } finally {
      setGenerating(false);
    }
  };

  const runRenderVisual = async () => {
    setRendering(true);
    try {
      const file = mode === 'draw'
        ? await strokesToPng(strokes, { color: ink, thickness, width: PAD_W, height: PAD_H })
        : await textToPng(typed.trim(), { fontId, color: ink });
      if (visual) URL.revokeObjectURL(visual.url);
      setVisual({ file, url: URL.createObjectURL(file) });
    } catch (e) {
      toast.error('Falha ao gerar assinatura', e instanceof Error ? e.message : undefined);
    } finally {
      setRendering(false);
    }
  };

  const apply = () => {
    if (!identity && !visual) return;
    onApply({ identity, visual });
    onClose();
  };

  const fonts = useMemo(() => SIGNATURE_FONTS, []);

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Gerar formato exigido"
      description="Crie a identidade digital (certificado) e a assinatura visual sem sair da ferramenta — tudo já entra nos campos certos."
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            {identity && <Badge tone="success" dot>Certificado pronto</Badge>}
            {visual && <Badge tone="info" dot>Assinatura visual pronta</Badge>}
            {!identity && !visual && <span>Gere ao menos um dos dois para aplicar.</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button icon={BadgeCheck} onClick={apply} disabled={!identity && !visual}>Usar na ferramenta</Button>
          </div>
        </div>
      }
    >
      <div className="flex gap-1.5 p-1 rounded-xl bg-slate-100 mb-4">
        {([
          { id: 'identity' as const, label: 'Identidade digital', icon: FileKey2 },
          { id: 'visual' as const, label: 'Assinatura visual', icon: PenLine }
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn('flex-1 h-9 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors', tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'identity' ? (
        <div className="space-y-3">
          <Section title="Formato do certificado" hint="Define o arquivo que a ferramenta vai receber e a força da chave.">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2"><Select label="Formato exigido" value={format} onChange={(e) => { setFormat(e.target.value as CertFormat); setIdentity(undefined); }}>
                <option value="PKCS12">PKCS#12 — arquivo .p12 (recomendado)</option>
                <option value="PEM">PEM — certificado + chave privada</option>
              </Select></div>
              <Select label="Tamanho da chave" value={String(keySize)} onChange={(e) => { setKeySize(Number(e.target.value) as 2048); setIdentity(undefined); }}>
                <option value="2048">RSA 2048 bits</option>
                <option value="3072">RSA 3072 bits</option>
                <option value="4096">RSA 4096 (lento)</option>
              </Select>
            </div>
          </Section>

          <Section title="Titular" hint="Vai impresso no certificado e aparece no painel de assinaturas do leitor de PDF.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Input label="Nome do signatário (CN)" value={commonName} onChange={(e) => { setCommonName(e.target.value); setIdentity(undefined); }} placeholder="João Victor da Silva" /></div>
              <Input label="Organização" value={organization} onChange={(e) => { setOrganization(e.target.value); setIdentity(undefined); }} />
              <Input label="Departamento" value={unit} onChange={(e) => setUnit(e.target.value)} />
              <div className="sm:col-span-2"><Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contato@empresa.com" /></div>
              <Input label="Cidade" value={locality} onChange={(e) => setLocality(e.target.value)} />
              <Input label="País (ISO-2)" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} placeholder="BR" />
            </div>
          </Section>

          <Section title="Proteção e validade">
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
              <Input label="Senha do certificado" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setIdentity(undefined); }} placeholder="mínimo 4 caracteres" hint="Reaproveitada automaticamente no campo Senha da ferramenta." />
              <Input label="Validade (anos)" type="number" min={1} max={20} value={years} onChange={(e) => setYears(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
          </Section>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-slate-50 px-4 py-3">
            <Button icon={generating ? Loader2 : ShieldCheck} onClick={runGenerateIdentity} disabled={!canGenerateIdentity || generating} loading={generating}>
              {identity ? 'Gerar novamente' : 'Gerar certificado'}
            </Button>
            <span className="text-[11px] text-slate-500">
              {canGenerateIdentity ? 'Tudo é gerado no seu navegador — nada é enviado para servidores.' : 'Informe o nome do signatário e uma senha de 4+ caracteres.'}
            </span>
          </div>

          {identity && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-emerald-800">
                  {identity.format === 'PKCS12' ? identity.p12File?.name : `${identity.certFile?.name} + ${identity.keyFile?.name}`}
                </p>
                <div className="flex gap-1.5">
                  {identity.p12File && <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadBlob(identity.p12File!, identity.p12File!.name)}>.p12</Button>}
                  {identity.certFile && <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadBlob(identity.certFile!, identity.certFile!.name)}>cert</Button>}
                  {identity.keyFile && <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadBlob(identity.keyFile!, identity.keyFile!.name)}>chave</Button>}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-emerald-900/80">
                <div><dt className="inline font-semibold">Série: </dt><dd className="inline font-mono">{identity.serial.slice(0, 16)}…</dd></div>
                <div><dt className="inline font-semibold">Validade: </dt><dd className="inline">{fmtDate(identity.validFrom)} → {fmtDate(identity.validTo)}</dd></div>
                <div className="col-span-2 truncate"><dt className="inline font-semibold">SHA-256: </dt><dd className="inline font-mono">{identity.fingerprint}</dd></div>
              </dl>
              <p className="text-[11px] text-emerald-900/70">
                Certificado auto-assinado: garante integridade e carimba autoria, mas não é emitido por uma AC — leitores como o Adobe mostram “assinatura válida, autor não verificado”. Para valor legal pleno, use um certificado de AC credenciada (ICP-Brasil, eIDAS) no mesmo campo.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* barra única: modo à esquerda, tinta e espessura à direita — antes eram três linhas soltas */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <div className="flex gap-1 p-1 rounded-lg bg-slate-100">
              {([{ id: 'draw' as const, label: 'Desenhar', icon: PenLine }, { id: 'type' as const, label: 'Digitar', icon: TypeIcon }]).map((m) => (
                <button key={m.id} type="button" onClick={() => setMode(m.id)} className={cn('h-7 px-2.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors', mode === m.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                  <m.icon className="w-3.5 h-3.5" />
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5" role="group" aria-label="Cor da tinta">
              {INK.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={ink === c.value}
                  onClick={() => setInk(c.value)}
                  className={cn('w-6 h-6 rounded-full transition-transform', ink === c.value ? 'ring-2 ring-offset-2 ring-slate-900 scale-105' : 'ring-1 ring-slate-200 hover:scale-105')}
                  style={{ background: c.value }}
                />
              ))}
            </div>

            {mode === 'draw' && (
              <label className="ml-auto flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                Espessura
                <input type="range" min={1.5} max={7} step={0.2} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} className="w-24 accent-slate-900" />
              </label>
            )}
          </div>

          {mode === 'draw' ? (
            <div className="relative rounded-xl border border-slate-200 bg-white overflow-hidden">
              {/* linha-guia de assinatura, como num papel */}
              <div className="pointer-events-none absolute inset-x-8 bottom-[22%] border-b border-dashed border-slate-200" />
              <canvas
                ref={canvasRef}
                style={{ width: '100%', aspectRatio: `${PAD_W} / ${PAD_H}`, touchAction: 'none' }}
                onPointerDown={startStroke}
                onPointerMove={extendStroke}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
                onPointerLeave={endStroke}
                className="relative block cursor-crosshair"
              />
              {strokes.length === 0 && (
                <p className="absolute inset-0 grid place-items-center text-xs text-slate-400 pointer-events-none">
                  Assine aqui com o mouse, caneta ou dedo
                </p>
              )}
              <div className="absolute top-2 right-2 flex gap-1">
                <Button size="sm" variant="ghost" icon={Undo2} onClick={() => setStrokes((p) => p.slice(0, -1))} disabled={!strokes.length}>Desfazer</Button>
                <Button size="sm" variant="ghost" icon={Eraser} onClick={() => setStrokes([])} disabled={!strokes.length}>Limpar</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Input label="Nome a assinar" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="João Victor da Silva" />
              <div className="grid gap-2 sm:grid-cols-2">
                {fonts.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFontId(f.id)}
                    aria-pressed={fontId === f.id}
                    className={cn('flex h-16 items-center rounded-xl border px-4 text-2xl overflow-hidden transition-colors', fontId === f.id ? 'border-brand-500 bg-brand-50/60' : 'border-slate-200 bg-white hover:border-slate-300')}
                    style={{ fontFamily: f.family, color: ink }}
                  >
                    <span className="block w-full truncate text-left leading-none">{typed.trim() || f.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-slate-50 px-4 py-3">
            <Button icon={rendering ? Loader2 : PenLine} loading={rendering} onClick={runRenderVisual} disabled={!canRenderVisual || rendering}>
              {visual ? 'Atualizar assinatura' : 'Gerar assinatura'}
            </Button>
            <span className="text-[11px] text-slate-500">
              {canRenderVisual ? 'Gera um PNG transparente recortado no traço.' : mode === 'draw' ? 'Desenhe algo no quadro acima.' : 'Digite o nome a assinar.'}
            </span>
          </div>

          {visual && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3.5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex-1 rounded-lg bg-[linear-gradient(45deg,#eef2f7_25%,transparent_25%,transparent_75%,#eef2f7_75%),linear-gradient(45deg,#eef2f7_25%,#fff_25%,#fff_75%,#eef2f7_75%)] bg-[length:14px_14px] bg-[position:0_0,7px_7px] p-3 grid place-items-center">
                <img src={visual.url} alt="Assinatura gerada" className="max-h-24 object-contain" />
              </div>
              <div className="text-[11px] text-sky-900/80 space-y-1.5 sm:w-48">
                <p className="font-bold text-sky-900">PNG transparente</p>
                <p>Será carimbado no PDF antes da assinatura criptográfica, então fica dentro do documento assinado.</p>
                <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadBlob(visual.file, visual.file.name)}>Baixar PNG</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

/* monta o corpo só quando abre: o estado nasce já com o nome vindo da ferramenta */
const SignatureStudio = ({ open, ...rest }: Props) => (open ? <StudioBody {...rest} /> : null);

export default SignatureStudio;
