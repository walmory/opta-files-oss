import type ForgeNs from 'node-forge';

/* node-forge só é baixado quando o utilizador realmente gera um certificado */
let forgePromise: Promise<typeof ForgeNs> | null = null;
const loadForge = () => (forgePromise ??= import('node-forge').then((m) => m.default));
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

/* ------------------------------------------------------------------ *
 * Identidade digital (certificado auto-assinado)                      *
 * ------------------------------------------------------------------ */

export type CertFormat = 'PKCS12' | 'PEM';

export interface CertSubject {
  commonName: string;
  organization?: string;
  organizationalUnit?: string;
  email?: string;
  locality?: string;
  state?: string;
  country?: string;
}

export interface CertOptions extends CertSubject {
  keySize: 2048 | 3072 | 4096;
  validityYears: number;
  password: string;
}

export interface GeneratedIdentity {
  format: CertFormat;
  /** Arquivo pronto para o campo `p12File` (PKCS#12). */
  p12File?: File;
  /** Arquivos prontos para os campos `certFile` / `privateKeyFile` (PEM). */
  certFile?: File;
  keyFile?: File;
  certPem: string;
  keyPem: string;
  password: string;
  subject: CertSubject;
  serial: string;
  fingerprint: string;
  validFrom: Date;
  validTo: Date;
}

const safeSlug = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'assinatura';

const binaryToUint8 = (bin: string) => {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
};

/** Gera o par de chaves com WebCrypto (rápido, não trava a UI) e converte para forge. */
const generateKeyPair = async (bits: number) => {
  const forge = await loadForge();
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  pkcs8.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  const privateKey = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(bin))) as ForgeNs.pki.rsa.PrivateKey;
  const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
  return { privateKey, publicKey };
};

const attrsFrom = (s: CertSubject) => {
  const attrs: ForgeNs.pki.CertificateField[] = [{ name: 'commonName', value: s.commonName }];
  if (s.organization) attrs.push({ name: 'organizationName', value: s.organization });
  if (s.organizationalUnit) attrs.push({ shortName: 'OU', value: s.organizationalUnit });
  if (s.locality) attrs.push({ name: 'localityName', value: s.locality });
  if (s.state) attrs.push({ shortName: 'ST', value: s.state });
  if (s.country) attrs.push({ name: 'countryName', value: s.country });
  if (s.email) attrs.push({ name: 'emailAddress', value: s.email });
  return attrs;
};

/**
 * Cria um certificado X.509 auto-assinado próprio para assinatura de documentos
 * e entrega no formato exigido pela ferramenta (PKCS#12 ou par PEM).
 */
export const generateIdentity = async (format: CertFormat, opts: CertOptions): Promise<GeneratedIdentity> => {
  const forge = await loadForge();
  const { privateKey, publicKey } = await generateKeyPair(opts.keySize);
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = `00${forge.util.bytesToHex(forge.random.getBytesSync(16))}`;
  const from = new Date();
  const to = new Date(from.getTime());
  to.setFullYear(to.getFullYear() + opts.validityYears);
  cert.validity.notBefore = from;
  cert.validity.notAfter = to;
  const attrs = attrsFrom(opts);
  cert.setSubject(attrs);
  cert.setIssuer(attrs); // auto-assinado
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
    { name: 'extKeyUsage', emailProtection: true, clientAuth: true },
    { name: 'subjectKeyIdentifier' },
    ...(opts.email ? [{ name: 'subjectAltName', altNames: [{ type: 1, value: opts.email }] }] : [])
  ]);
  cert.sign(privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(privateKey);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const fingerprint = forge.md.sha256
    .create()
    .update(der)
    .digest()
    .toHex()
    .toUpperCase()
    .replace(/(.{2})(?=.)/g, '$1:');

  const base = safeSlug(opts.commonName);
  const identity: GeneratedIdentity = {
    format,
    certPem,
    keyPem,
    password: opts.password,
    subject: opts,
    serial: cert.serialNumber.replace(/^00/, '').toUpperCase(),
    fingerprint,
    validFrom: from,
    validTo: to
  };

  if (format === 'PKCS12') {
    // 3DES: máxima compatibilidade com o leitor PKCS#12 da JVM usada pelo motor de assinatura.
    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, [cert], opts.password, { algorithm: '3des', friendlyName: opts.commonName });
    const bytes = binaryToUint8(forge.asn1.toDer(p12Asn1).getBytes());
    identity.p12File = new File([bytes], `${base}.p12`, { type: 'application/x-pkcs12' });
  } else {
    identity.certFile = new File([certPem], `${base}-certificado.pem`, { type: 'application/x-pem-file' });
    identity.keyFile = new File([keyPem], `${base}-chave-privada.pem`, { type: 'application/x-pem-file' });
  }
  return identity;
};

/* ------------------------------------------------------------------ *
 * Assinatura visual (PNG transparente)                                *
 * ------------------------------------------------------------------ */

export const SIGNATURE_FONTS = [
  { id: 'great-vibes', label: 'Clássica', family: "'Great Vibes', 'Snell Roundhand', cursive", scale: 1 },
  { id: 'dancing', label: 'Fluida', family: "'Dancing Script', 'Segoe Script', cursive", scale: 0.92 },
  { id: 'caveat', label: 'Casual', family: "'Caveat', 'Bradley Hand', cursive", scale: 0.95 },
  { id: 'homemade', label: 'Manuscrita', family: "'Homemade Apple', 'Apple Chancery', cursive", scale: 0.7 }
] as const;

export type SignatureFontId = (typeof SIGNATURE_FONTS)[number]['id'];

export type Stroke = { x: number; y: number }[];

const trimTransparent = (canvas: HTMLCanvasElement, pad = 12): HTMLCanvasElement => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')?.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
};

const canvasToPng = (canvas: HTMLCanvasElement, name: string) =>
  new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(new File([blob], name, { type: 'image/png' })) : reject(new Error('Falha ao gerar PNG'))), 'image/png');
  });

/** Desenha os traços (coordenadas 0..1) num PNG transparente de alta resolução. */
export const strokesToPng = async (strokes: Stroke[], opts: { color: string; thickness: number; width: number; height: number; name?: string }) => {
  const scale = 4;
  const canvas = document.createElement('canvas');
  canvas.width = opts.width * scale;
  canvas.height = opts.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível');
  ctx.scale(scale, scale);
  ctx.strokeStyle = opts.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = opts.thickness;
  strokes.forEach((stroke) => {
    if (!stroke.length) return;
    if (stroke.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke[0].x * opts.width, stroke[0].y * opts.height, opts.thickness / 2, 0, Math.PI * 2);
      ctx.fillStyle = opts.color;
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(stroke[0].x * opts.width, stroke[0].y * opts.height);
    for (let i = 1; i < stroke.length - 1; i += 1) {
      const cx = stroke[i].x * opts.width;
      const cy = stroke[i].y * opts.height;
      const nx = (cx + stroke[i + 1].x * opts.width) / 2;
      const ny = (cy + stroke[i + 1].y * opts.height) / 2;
      ctx.quadraticCurveTo(cx, cy, nx, ny);
    }
    const last = stroke[stroke.length - 1];
    ctx.lineTo(last.x * opts.width, last.y * opts.height);
    ctx.stroke();
  });
  return canvasToPng(trimTransparent(canvas, 10 * scale), opts.name || 'assinatura.png');
};

/** Renderiza o nome digitado com fonte manuscrita num PNG transparente. */
export const textToPng = async (text: string, opts: { fontId: SignatureFontId; color: string; name?: string }) => {
  const font = SIGNATURE_FONTS.find((f) => f.id === opts.fontId) || SIGNATURE_FONTS[0];
  const size = 220 * font.scale;
  const spec = `${size}px ${font.family}`;
  try {
    await document.fonts.load(spec, text);
    await document.fonts.ready;
  } catch {
    // fonte de sistema assume o lugar
  }
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('Canvas indisponível');
  measure.font = spec;
  const width = Math.ceil(measure.measureText(text).width) + size;
  const height = Math.ceil(size * 2.2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível');
  ctx.font = spec;
  ctx.fillStyle = opts.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height / 2);
  return canvasToPng(trimTransparent(canvas, 24), opts.name || 'assinatura.png');
};

/* ------------------------------------------------------------------ *
 * Aplicação do carimbo visual no PDF (local, via pdf-lib)             *
 * ------------------------------------------------------------------ */

export interface StampPlacement {
  /** 1-based; 0 = todas as páginas. */
  page: number;
  /** Percentuais 0..100 a partir do canto inferior esquerdo. */
  x: number;
  y: number;
  /** Largura em % da largura da página (imagens). */
  widthPct: number;
  /** Tamanho da fonte em pontos (texto). */
  fontSize?: number;
  opacity: number;
  /** Graus, anti-horário, em torno do canto inferior esquerdo. */
  rotation?: number;
}

export type PdfOverlay = { kind: 'image'; file: File | Blob } | { kind: 'text'; text: string; color: string };

const hexToRgb = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** Converte qualquer imagem do browser (webp, gif, svg…) para PNG, para o pdf-lib conseguir embutir. */
const toPngBytes = async (file: File | Blob): Promise<ArrayBuffer> => {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Imagem inválida'));
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || 1;
    c.height = img.naturalHeight || 1;
    c.getContext('2d')?.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Não foi possível converter a imagem');
    return blob.arrayBuffer();
  } finally {
    URL.revokeObjectURL(url);
  }
};

/**
 * Aplica um elemento (imagem ou texto) nas páginas do PDF, no lugar exato escolhido
 * no PlacementStudio. Feito localmente com pdf-lib — o que se vê na prévia é o que fica.
 */
export const applyOverlayToPdf = async (pdf: File | Blob, overlay: PdfOverlay, placement: StampPlacement | StampPlacement[], fileName = 'documento.pdf'): Promise<File> => {
  const doc = await PDFDocument.load(await pdf.arrayBuffer(), { ignoreEncryption: true });
  const pages = doc.getPages();
  const list = Array.isArray(placement) ? placement : [placement];
  /** pares (página, posição) — página 0 expande para todas. */
  const jobs = list.flatMap((place) => (place.page === 0 ? pages : [pages[Math.min(Math.max(place.page, 1), pages.length) - 1]]).map((page) => ({ page, place })));

  if (overlay.kind === 'image') {
    const bytes = await overlay.file.arrayBuffer();
    const type = overlay.file.type;
    let image;
    try {
      image = type === 'image/jpeg' || type === 'image/jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    } catch {
      image = await doc.embedPng(await toPngBytes(overlay.file));
    }
    jobs.forEach(({ page, place }) => {
      const { width, height } = page.getSize();
      const w = (width * place.widthPct) / 100;
      const h = (w / image.width) * image.height;
      page.drawImage(image, { x: (width * place.x) / 100, y: (height * place.y) / 100, width: w, height: h, opacity: place.opacity, rotate: degrees(place.rotation ?? 0) });
    });
  } else {
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    jobs.forEach(({ page, place }) => {
      const { width, height } = page.getSize();
      page.drawText(overlay.text, { x: (width * place.x) / 100, y: (height * place.y) / 100, size: place.fontSize ?? 30, font, color: hexToRgb(overlay.color), opacity: place.opacity, rotate: degrees(place.rotation ?? 0) });
    });
  }
  const bytes = await doc.save();
  const name = pdf instanceof File ? pdf.name : fileName;
  return new File([bytes as BlobPart], name, { type: 'application/pdf' });
};

export const stampSignatureOnPdf = (pdf: File, png: File, place: StampPlacement | StampPlacement[]): Promise<File> => applyOverlayToPdf(pdf, { kind: 'image', file: png }, place);
