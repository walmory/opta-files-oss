/**
 * Logo badge compositor.
 *
 * The QR libraries (ours included) just stamp the raw image into the middle of the
 * code, which is why an uploaded logo ends up looking like "a picture in a little
 * square". The commercial generators (QRCodeChimp, Uniqode, hovercode…) instead
 * pre-compose the logo into a *badge*: the artwork is trimmed to its real bounding
 * box, centred, padded, and placed on a shaped backdrop (rounded square, circle,
 * squircle) with an optional ring and drop shadow.
 *
 * This module produces that badge as a PNG data URL. Because the result is still a
 * plain square image, it drops straight into `imageOptions` and every export path
 * (preview / PNG / SVG / PDF / batch) renders exactly the same thing.
 */

export type LogoShape = 'none' | 'square' | 'rounded' | 'squircle' | 'circle';

export interface LogoBadgeOptions {
  shape: LogoShape;
  /** inner breathing room, as a % of the badge side (0–24) */
  padding: number;
  /** backdrop fill; `'transparent'` keeps the modules visible behind the artwork */
  backdrop: string;
  /** ring width as a % of the badge side (0 = no ring) */
  ring: number;
  ringColor: string;
  shadow: boolean;
  /** crop the transparent (or uniform) border of the uploaded file */
  trim: boolean;
}

export const DEFAULT_LOGO_BADGE: LogoBadgeOptions = {
  shape: 'rounded',
  padding: 12,
  backdrop: '#ffffff',
  ring: 0,
  ringColor: '#ffffff',
  shadow: false,
  trim: true
};

/** Badge raster size. Large enough for a 4096px export, cheap enough to recompose live. */
const SIDE = 512;
/** A circle only leaves its inscribed square usable, so artwork is scaled down inside it. */
const SHAPE_FIT: Record<LogoShape, number> = { none: 1, square: 1, rounded: 0.97, squircle: 0.94, circle: 0.8 };

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('logo-load-failed'));
    img.src = src;
  });

/** Bounding box of everything that is not transparent (falls back to the full frame). */
const alphaBounds = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return { x: 0, y: 0, w, h };
  }
  let top = h;
  let left = w;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < left || bottom < top) return { x: 0, y: 0, w, h };
  // one pixel of slack so anti-aliased edges are not clipped
  const x = Math.max(0, left - 1);
  const y = Math.max(0, top - 1);
  return { x, y, w: Math.min(w - x, right - left + 3), h: Math.min(h - y, bottom - top + 3) };
};

/** Rounded-rect / squircle / circle path, inset by `inset` on every side. */
const shapePath = (ctx: CanvasRenderingContext2D, shape: LogoShape, inset: number) => {
  const s = SIDE - inset * 2;
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(SIDE / 2, SIDE / 2, s / 2, 0, Math.PI * 2);
    return;
  }
  const r = shape === 'square' ? 0 : shape === 'rounded' ? s * 0.22 : s * 0.34; // squircle
  ctx.moveTo(inset + r, inset);
  ctx.lineTo(inset + s - r, inset);
  ctx.quadraticCurveTo(inset + s, inset, inset + s, inset + r);
  ctx.lineTo(inset + s, inset + s - r);
  ctx.quadraticCurveTo(inset + s, inset + s, inset + s - r, inset + s);
  ctx.lineTo(inset + r, inset + s);
  ctx.quadraticCurveTo(inset, inset + s, inset, inset + s - r);
  ctx.lineTo(inset, inset + r);
  ctx.quadraticCurveTo(inset, inset, inset + r, inset);
  ctx.closePath();
};

/**
 * Composes the badge and returns a PNG data URL, or the original `src` when nothing
 * would change (no shape, no padding, no trim) or when the browser refuses the canvas.
 */
export const composeLogoBadge = async (src: string, opts: LogoBadgeOptions): Promise<string> => {
  const plain = opts.shape === 'none' && opts.padding === 0 && !opts.trim && opts.ring === 0 && !opts.shadow;
  if (plain) return src;

  let img: HTMLImageElement;
  try {
    img = await loadImage(src);
  } catch {
    return src;
  }

  const natW = img.naturalWidth || img.width || SIDE;
  const natH = img.naturalHeight || img.height || SIDE;
  if (!natW || !natH) return src;

  // 1. rasterize at a workable size and find the real artwork bounds
  const scale = Math.min(1, 640 / Math.max(natW, natH));
  const srcW = Math.max(1, Math.round(natW * scale));
  const srcH = Math.max(1, Math.round(natH * scale));
  const stage = document.createElement('canvas');
  stage.width = srcW;
  stage.height = srcH;
  const sctx = stage.getContext('2d', { willReadFrequently: true });
  if (!sctx) return src;
  sctx.drawImage(img, 0, 0, srcW, srcH);
  const box = opts.trim ? alphaBounds(sctx, srcW, srcH) : { x: 0, y: 0, w: srcW, h: srcH };

  // 2. paint the badge
  const canvas = document.createElement('canvas');
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return src;

  const shadowRoom = opts.shadow ? SIDE * 0.06 : 0;
  const ringW = (Math.max(0, opts.ring) / 100) * SIDE;
  const hasBackdrop = opts.shape !== 'none' && opts.backdrop !== 'transparent';

  if (hasBackdrop || ringW > 0) {
    if (opts.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,0.28)';
      ctx.shadowBlur = SIDE * 0.05;
      ctx.shadowOffsetY = SIDE * 0.018;
      ctx.fillStyle = hasBackdrop ? opts.backdrop : opts.ringColor;
      shapePath(ctx, opts.shape, shadowRoom);
      ctx.fill();
      ctx.restore();
    }
    if (hasBackdrop) {
      ctx.fillStyle = opts.backdrop;
      shapePath(ctx, opts.shape, shadowRoom);
      ctx.fill();
    }
    if (ringW > 0) {
      ctx.strokeStyle = opts.ringColor;
      ctx.lineWidth = ringW;
      shapePath(ctx, opts.shape, shadowRoom + ringW / 2);
      ctx.stroke();
    }
  }

  // 3. fit the trimmed artwork inside the badge, respecting the shape
  const inset = shadowRoom + ringW + (Math.max(0, opts.padding) / 100) * SIDE;
  const avail = Math.max(1, (SIDE - inset * 2) * SHAPE_FIT[opts.shape]);
  const k = Math.min(avail / box.w, avail / box.h);
  const drawW = box.w * k;
  const drawH = box.h * k;

  if (opts.shape !== 'none') {
    ctx.save();
    shapePath(ctx, opts.shape, shadowRoom + ringW * 0.5);
    ctx.clip();
  }
  ctx.drawImage(stage, box.x, box.y, box.w, box.h, (SIDE - drawW) / 2, (SIDE - drawH) / 2, drawW, drawH);
  if (opts.shape !== 'none') ctx.restore();

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return src;
  }
};
