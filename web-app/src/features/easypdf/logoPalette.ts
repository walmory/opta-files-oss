/**
 * Extracts the brand palette from an uploaded logo so the QR code can be generated
 * "in the shape of" that brand: dominant colours become the dot gradient and the
 * corner-eye colours, the way branded QR generators do it.
 */

export interface Swatch {
  hex: string;
  /** share of the sampled pixels, 0..1 */
  weight: number;
}

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

const parseHex = (hex: string): [number, number, number] => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
};

const srgb = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export const luminance = (hex: string) => {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
};

export const contrastRatio = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

/** Darkens a colour until it reaches a scannable contrast against `bg` (keeps the hue). */
export const ensureScannable = (hex: string, bg = '#ffffff', target = 5) => {
  let [r, g, b] = parseHex(hex);
  const bgLight = luminance(bg) > 0.4;
  for (let i = 0; i < 24 && contrastRatio(toHex(r, g, b), bg) < target; i++) {
    if (bgLight) [r, g, b] = [r * 0.86, g * 0.86, b * 0.86];
    else [r, g, b] = [r + (255 - r) * 0.14, g + (255 - g) * 0.14, b + (255 - b) * 0.14];
  }
  return toHex(r, g, b);
};

/**
 * Buckets the logo pixels into a coarse colour cube and returns the most frequent,
 * reasonably saturated colours. Near-transparent, near-white and near-black pixels are
 * dropped first because they are almost always background or outlines.
 */
export const extractPalette = (src: string, max = 5): Promise<Swatch[]> =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve([]);
    img.onload = () => {
      const side = 64;
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return resolve([]);
      ctx.drawImage(img, 0, 0, side, side);

      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(0, 0, side, side).data;
      } catch {
        return resolve([]); // tainted canvas
      }

      const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
      let counted = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (a < 160) continue;
        const max3 = Math.max(r, g, b);
        const min3 = Math.min(r, g, b);
        const isNeutral = max3 - min3 < 24;
        if (isNeutral && (max3 > 232 || max3 < 26)) continue; // paper white / pure black
        counted++;
        // 5 bits per channel keeps shades of the same brand colour together
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        const cur = buckets.get(key);
        if (cur) {
          cur.r += r;
          cur.g += g;
          cur.b += b;
          cur.n++;
        } else buckets.set(key, { r, g, b, n: 1 });
      }
      if (!counted) return resolve([]);

      const swatches = [...buckets.values()]
        .sort((a, b) => b.n - a.n)
        .slice(0, max * 3)
        .map((c) => ({ hex: toHex(c.r / c.n, c.g / c.n, c.b / c.n), weight: c.n / counted }));

      // Drop colours that are visually the same as one already picked.
      const picked: Swatch[] = [];
      for (const s of swatches) {
        const [r, g, b] = parseHex(s.hex);
        const near = picked.some((p) => {
          const [pr, pg, pb] = parseHex(p.hex);
          return Math.abs(pr - r) + Math.abs(pg - g) + Math.abs(pb - b) < 60;
        });
        if (!near) picked.push(s);
        if (picked.length >= max) break;
      }
      resolve(picked);
    };
    img.src = src;
  });
