/**
 * Call-to-action frames drawn around the QR code.
 *
 * The geometry is described once as a list of primitives and rendered twice — to a
 * canvas (PNG/PDF) and to SVG — so the vector export is pixel-for-pixel the same
 * layout as the raster one.
 */
import { luminance } from './logoPalette';

export type FrameId = 'none' | 'bar' | 'label' | 'header' | 'pill';

export interface FrameDef {
  id: FrameId;
  label: string;
  /** Whether the frame shows a call-to-action caption. */
  caption: boolean;
}

export const FRAMES: FrameDef[] = [
  { id: 'none', label: 'Sem moldura', caption: false },
  { id: 'bar', label: 'Barra inferior', caption: true },
  { id: 'label', label: 'Etiqueta', caption: true },
  { id: 'header', label: 'Faixa superior', caption: true },
  { id: 'pill', label: 'Selo', caption: true }
];

export const DEFAULT_CAPTION = 'APONTE A CÂMERA';

type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number; fill?: string; stroke?: string; strokeWidth?: number }
  | { kind: 'text'; x: number; y: number; text: string; size: number; color: string; weight: number }
  | { kind: 'qr'; x: number; y: number; size: number };

interface Layout {
  width: number;
  height: number;
  shapes: Shape[];
}

const readable = (bg: string) => (luminance(bg) > 0.55 ? '#0f172a' : '#ffffff');

/** Shrinks the caption until it fits the available width (same maths in both renderers). */
const fitCaption = (text: string, base: number, maxWidth: number) => {
  const estimated = text.length * base * 0.62;
  return estimated <= maxWidth ? base : Math.max(base * 0.55, (maxWidth / Math.max(text.length, 1)) / 0.62);
};

export const frameLayout = (frame: FrameId, px: number, caption: string, accent: string): Layout => {
  const u = px / 100;
  const text = caption.trim();
  const ink = readable(accent);

  if (frame === 'none' || !text) return { width: px, height: px, shapes: [{ kind: 'qr', x: 0, y: 0, size: px }] };

  if (frame === 'bar') {
    const pad = 9 * u;
    const capH = 21 * u;
    const width = px + pad * 2;
    const height = pad + px + capH;
    const size = fitCaption(text, 11 * u, width * 0.86);
    return {
      width,
      height,
      shapes: [
        { kind: 'rect', x: 0, y: 0, w: width, h: height, r: 8 * u, fill: accent },
        { kind: 'rect', x: pad, y: pad, w: px, h: px, r: 5 * u, fill: '#ffffff' },
        { kind: 'qr', x: pad, y: pad, size: px },
        { kind: 'text', x: width / 2, y: pad + px + capH * 0.64, text, size, color: ink, weight: 800 }
      ]
    };
  }

  if (frame === 'header') {
    const pad = 9 * u;
    const capH = 22 * u;
    const width = px + pad * 2;
    const height = capH + px + pad;
    const size = fitCaption(text, 11 * u, width * 0.86);
    return {
      width,
      height,
      shapes: [
        { kind: 'rect', x: 0, y: 0, w: width, h: height, r: 8 * u, fill: accent },
        { kind: 'text', x: width / 2, y: capH * 0.66, text, size, color: ink, weight: 800 },
        { kind: 'rect', x: pad, y: capH, w: px, h: px, r: 5 * u, fill: '#ffffff' },
        { kind: 'qr', x: pad, y: capH, size: px }
      ]
    };
  }

  if (frame === 'label') {
    const border = 3 * u;
    const pad = 9 * u;
    const capH = 20 * u;
    const width = px + pad * 2;
    const height = pad + px + capH;
    const size = fitCaption(text, 10.5 * u, width * 0.86);
    return {
      width,
      height,
      shapes: [
        { kind: 'rect', x: 0, y: 0, w: width, h: height, r: 8 * u, fill: accent },
        { kind: 'rect', x: border, y: border, w: width - border * 2, h: height - border * 2, r: 6 * u, fill: '#ffffff' },
        { kind: 'qr', x: pad, y: pad, size: px },
        { kind: 'text', x: width / 2, y: pad + px + capH * 0.62, text, size, color: accent, weight: 800 }
      ]
    };
  }

  // pill
  const pad = 9 * u;
  const pillH = 15 * u;
  const gap = 4 * u;
  const width = px + pad * 2;
  const height = pad + px + gap + pillH + pad;
  const pillW = px * 0.9;
  const size = fitCaption(text, 9.5 * u, pillW * 0.86);
  return {
    width,
    height,
    shapes: [
      { kind: 'rect', x: 0, y: 0, w: width, h: height, r: 9 * u, fill: '#ffffff', stroke: '#e2e8f0', strokeWidth: 1.5 * u },
      { kind: 'qr', x: pad, y: pad, size: px },
      { kind: 'rect', x: (width - pillW) / 2, y: pad + px + gap, w: pillW, h: pillH, r: pillH / 2, fill: accent },
      { kind: 'text', x: width / 2, y: pad + px + gap + pillH * 0.68, text, size, color: ink, weight: 800 }
    ]
  };
};

const FONT_STACK = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível ler a imagem do QR code.'));
    img.src = src;
  });

/** Composites the QR PNG inside the chosen frame and returns a new PNG blob. */
export const renderFramedPng = async (qrPng: Blob, frame: FrameId, px: number, caption: string, accent: string): Promise<Blob> => {
  const layout = frameLayout(frame, px, caption, accent);
  if (frame === 'none' || layout.shapes.length === 1) return qrPng;

  const url = URL.createObjectURL(qrPng);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(layout.width);
    canvas.height = Math.round(layout.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponível neste navegador.');

    for (const s of layout.shapes) {
      if (s.kind === 'rect') {
        roundRect(ctx, s.x, s.y, s.w, s.h, s.r);
        if (s.fill) {
          ctx.fillStyle = s.fill;
          ctx.fill();
        }
        if (s.stroke) {
          ctx.strokeStyle = s.stroke;
          ctx.lineWidth = s.strokeWidth || 1;
          ctx.stroke();
        }
      } else if (s.kind === 'qr') {
        ctx.drawImage(img, s.x, s.y, s.size, s.size);
      } else {
        ctx.fillStyle = s.color;
        ctx.font = `${s.weight} ${s.size}px ${FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(s.text, s.x, s.y);
      }
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Falha ao gerar o PNG com moldura.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler o SVG do QR code.'));
    reader.readAsDataURL(blob);
  });

/** Wraps the QR SVG inside the chosen frame, keeping everything vectorial. */
export const renderFramedSvg = async (qrSvg: Blob, frame: FrameId, px: number, caption: string, accent: string): Promise<Blob> => {
  const layout = frameLayout(frame, px, caption, accent);
  if (frame === 'none' || layout.shapes.length === 1) return qrSvg;

  const href = await blobToDataUrl(qrSvg);
  const body = layout.shapes
    .map((s) => {
      if (s.kind === 'rect') {
        const stroke = s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.strokeWidth || 1}"` : '';
        const inset = s.stroke ? (s.strokeWidth || 1) / 2 : 0;
        return `<rect x="${s.x + inset}" y="${s.y + inset}" width="${s.w - inset * 2}" height="${s.h - inset * 2}" rx="${s.r}" fill="${s.fill || 'none'}"${stroke}/>`;
      }
      if (s.kind === 'qr') return `<image x="${s.x}" y="${s.y}" width="${s.size}" height="${s.size}" href="${href}"/>`;
      return `<text x="${s.x}" y="${s.y}" font-family="${FONT_STACK}" font-size="${s.size}" font-weight="${s.weight}" fill="${s.color}" text-anchor="middle">${escapeXml(s.text)}</text>`;
    })
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">${body}</svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
};
