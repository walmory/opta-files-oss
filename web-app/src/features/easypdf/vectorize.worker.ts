/// <reference lib="webworker" />
/**
 * Worker do vetorizador: instancia o WASM do VTracer uma unica vez e responde a cada
 * pedido com o SVG. O modulo `wasm_vtracer` vem no formato "bundler" do wasm-bindgen
 * (importa o .wasm por `import`), que o Vite nao resolve — por isso o glue JS e o binario
 * sao carregados separadamente e ligados na mao com `__wbg_set_wasm`.
 */
import * as vt from 'wasm_vtracer/wasm_vtracer_bg.js';
import wasmUrl from 'wasm_vtracer/wasm_vtracer_bg.wasm?url';
import type { VectorizeOptions, VectorizeRequest, VectorizeResponse } from './vectorize';

const COLOR_MODE = { color: 0, bw: 1 } as const;
const LAYER_MODE = { stacked: 0, cutout: 1 } as const;
const PATH_MODE = { polygon: 0, spline: 1, pixel: 2 } as const;

let ready: Promise<void> | null = null;

const ensureWasm = () => {
  if (ready) return ready;
  ready = (async () => {
    const bytes = await fetch(wasmUrl).then((r) => r.arrayBuffer());
    const { instance } = await WebAssembly.instantiate(bytes, { './wasm_vtracer_bg.js': vt as unknown as WebAssembly.ModuleImports });
    const exports = instance.exports as { __wbindgen_start?: () => void };
    vt.__wbg_set_wasm(exports);
    exports.__wbindgen_start?.();
  })();
  return ready;
};

/**
 * Ajusta os limiares medidos em pixels ao fator de supersampling: "remover manchas de
 * 4 px" na imagem original vale 4*s*s px de area (e 4*s de comprimento) na ampliada.
 */
const buildConfig = (o: VectorizeOptions, scale: number) => {
  const cfg = new vt.TracerConfig();
  cfg.setColorMode(COLOR_MODE[o.colorMode]);
  cfg.setHierarchical(LAYER_MODE[o.layerMode]);
  cfg.setPathSimplifyMode(PATH_MODE[o.pathMode]);
  cfg.setFilterSpeckle(Math.round(o.filterSpeckle * scale * scale));
  cfg.setColorPrecision(o.colorPrecision);
  cfg.setLayerDifference(o.layerDifference);
  cfg.setCornerThreshold(o.cornerThreshold);
  // O VTracer so aceita 3.5..10 aqui.
  cfg.setLengthThreshold(Math.min(10, Math.max(3.5, o.lengthThreshold * scale)));
  cfg.setMaxIterations(o.maxIterations);
  cfg.setSpliceThreshold(o.spliceThreshold);
  cfg.setPathPrecision(o.pathPrecision);
  return cfg;
};

// ---------------------------------------------------------------------------
// Pre-processamento de cor. O VTracer agrupa cores por bits de precisao, o que deixa
// passar o degrade do anti-aliasing como camadas finas e tortas em volta de cada forma.
// Reduzir a imagem a uma paleta exata antes (como o "Cores" do Image Trace) resolve isso:
// cada pixel vira uma das N cores, e a borda entre duas cores fica limpa.
// ---------------------------------------------------------------------------

const ALPHA_CUT = 128;
const MAX_SAMPLES = 60_000;
const MAX_AUTO_COLORS = 24;

/**
 * Amostra ate MAX_SAMPLES pixels opacos e "planos": iguais ao vizinho da direita e ao de
 * baixo. Isso descarta a borda anti-aliased (que so tem misturas entre duas cores) e deixa
 * a paleta ser estimada apenas pelas areas cheias — a borda depois e atribuida a cor mais
 * proxima, que e exatamente o que o Image Trace faz.
 */
const samplePixels = (px: Uint8ClampedArray, width: number, height: number, scale: number) => {
  const total = width * height;
  // Depois do supersampling a borda suavizada tem ~scale px de largura; olhar so o vizinho
  // imediato nao basta. Compara com pixels a essa distancia, nos 4 sentidos.
  const d = Math.max(1, Math.ceil(scale));
  const step = Math.max(1, Math.floor(total / MAX_SAMPLES));
  const flat: number[] = [];
  const all: number[] = [];
  const near = (a: number, b: number) => Math.abs(px[a] - px[b]) + Math.abs(px[a + 1] - px[b + 1]) + Math.abs(px[a + 2] - px[b + 2]) < 24;
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (px[o + 3] < ALPHA_CUT) continue;
    all.push(px[o], px[o + 1], px[o + 2]);
    const x = i % width, y = (i - x) / width;
    if (x >= d && y >= d && x + d < width && y + d < height && near(o, o + d * 4) && near(o, o - d * 4) && near(o, o + width * 4 * d) && near(o, o - width * 4 * d)) {
      flat.push(px[o], px[o + 1], px[o + 2]);
    }
  }
  // Imagem toda em degrade (foto) quase nao tem pixel plano: cai para a amostra completa.
  return flat.length >= all.length * 0.2 ? flat : all;
};

/**
 * Estima quantas cores "de verdade" a imagem tem: histograma grosso (5 bits/canal),
 * fica com os baldes que representam pelo menos 0,5% da imagem e funde os que estao
 * a menos de ~24 niveis um do outro (anti-aliasing entre duas cores cria intermediarios).
 */
const guessPaletteSize = (samples: number[]) => {
  const hist = new Map<number, number>();
  const n = samples.length / 3;
  for (let i = 0; i < samples.length; i += 3) {
    const key = ((samples[i] >> 3) << 10) | ((samples[i + 1] >> 3) << 5) | (samples[i + 2] >> 3);
    hist.set(key, (hist.get(key) ?? 0) + 1);
  }
  const buckets = [...hist.entries()]
    .filter(([, c]) => c >= n * 0.005)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3]);
  const kept: number[][] = [];
  for (const b of buckets) {
    const near = kept.some((k) => Math.abs(k[0] - b[0]) + Math.abs(k[1] - b[1]) + Math.abs(k[2] - b[2]) < 72);
    if (!near) kept.push(b);
  }
  return Math.min(MAX_AUTO_COLORS, Math.max(2, kept.length));
};

/** k-means++ sobre as amostras; devolve a paleta como lista plana RGB. */
const kmeans = (samples: number[], k: number, iterations = 16) => {
  const n = samples.length / 3;
  if (n === 0) return [0, 0, 0];
  k = Math.min(k, n);
  const centers: number[] = [];
  // k-means++: cada novo centro tende a cair longe dos anteriores, o que evita que duas
  // cores parecidas roubem um centro enquanto uma cor distinta fica sem.
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const first = Math.floor(rnd() * n) * 3;
  centers.push(samples[first], samples[first + 1], samples[first + 2]);
  const dist = new Float64Array(n).fill(Infinity);
  while (centers.length / 3 < k) {
    const c = centers.length - 3;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const dr = samples[o] - centers[c], dg = samples[o + 1] - centers[c + 1], db = samples[o + 2] - centers[c + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < dist[i]) dist[i] = d;
      sum += dist[i];
    }
    let r = rnd() * sum, pick = n - 1;
    for (let i = 0; i < n; i++) { r -= dist[i]; if (r <= 0) { pick = i; break; } }
    centers.push(samples[pick * 3], samples[pick * 3 + 1], samples[pick * 3 + 2]);
  }
  const acc = new Float64Array(k * 3);
  const cnt = new Uint32Array(k);
  for (let it = 0; it < iterations; it++) {
    acc.fill(0); cnt.fill(0);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = samples[o] - centers[c * 3], dg = samples[o + 1] - centers[c * 3 + 1], db = samples[o + 2] - centers[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = c; }
      }
      acc[best * 3] += samples[o]; acc[best * 3 + 1] += samples[o + 1]; acc[best * 3 + 2] += samples[o + 2];
      cnt[best]++;
    }
    let moved = 0;
    for (let c = 0; c < k; c++) {
      if (!cnt[c]) continue;
      for (let ch = 0; ch < 3; ch++) {
        const v = acc[c * 3 + ch] / cnt[c];
        moved += Math.abs(v - centers[c * 3 + ch]);
        centers[c * 3 + ch] = v;
      }
    }
    if (moved < 0.5) break;
  }
  // Dois centros a menos de ~13 niveis por canal sao a mesma cor (ruido de compressao):
  // fundir evita camadas duplicadas com uma borda serrilhada entre elas.
  const merged: number[] = [];
  for (let c = 0; c < centers.length; c += 3) {
    const dup = merged.some((_, i) => i % 3 === 0 && Math.abs(merged[i] - centers[c]) + Math.abs(merged[i + 1] - centers[c + 1]) + Math.abs(merged[i + 2] - centers[c + 2]) < 40);
    if (!dup) merged.push(centers[c], centers[c + 1], centers[c + 2]);
  }
  return merged.map((v) => Math.round(v));
};

/** Substitui cada pixel pela cor mais proxima da paleta; alfa vira 0 ou 255. */
const applyPalette = (px: Uint8ClampedArray, palette: number[]) => {
  const k = palette.length / 3;
  // Cache por cor de 15 bits: imagens reais repetem muito, e o cache evita k distancias
  // por pixel na maior parte deles.
  const cache = new Int16Array(32768).fill(-1);
  for (let o = 0; o < px.length; o += 4) {
    if (px[o + 3] < ALPHA_CUT) { px[o] = px[o + 1] = px[o + 2] = px[o + 3] = 0; continue; }
    const r = px[o], g = px[o + 1], b = px[o + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let best = cache[key];
    if (best < 0) {
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = r - palette[c * 3], dg = g - palette[c * 3 + 1], db = b - palette[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = c; }
      }
      cache[key] = best;
    }
    px[o] = palette[best * 3]; px[o + 1] = palette[best * 3 + 1]; px[o + 2] = palette[best * 3 + 2]; px[o + 3] = 255;
  }
};

/** Limiar de Otsu sobre a luminancia: separa o traco do fundo mesmo em scans amarelados. */
const otsuBinarize = (px: Uint8ClampedArray) => {
  const hist = new Uint32Array(256);
  const lum = new Uint8Array(px.length / 4);
  let total = 0;
  for (let i = 0, o = 0; o < px.length; i++, o += 4) {
    if (px[o + 3] < ALPHA_CUT) { lum[i] = 255; continue; }
    const l = (px[o] * 77 + px[o + 1] * 151 + px[o + 2] * 28) >> 8;
    lum[i] = l; hist[l]++; total++;
  }
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = t; }
  }
  for (let i = 0, o = 0; o < px.length; i++, o += 4) {
    const dark = px[o + 3] >= ALPHA_CUT && lum[i] <= threshold;
    // Fundo vira transparente: o SVG de um traco nao deve carregar um retangulo branco.
    px[o] = px[o + 1] = px[o + 2] = dark ? 0 : 255;
    px[o + 3] = dark ? 255 : 0;
  }
};

let dbg: unknown = null;
const preprocess = (px: Uint8ClampedArray, width: number, height: number, scale: number, o: VectorizeOptions) => {
  if (!o.quantize) return;
  if (o.colorMode === 'bw') { otsuBinarize(px); return; }
  const samples = samplePixels(px, width, height, scale);
  if (!samples.length) return;
  const k = o.palette > 0 ? o.palette : guessPaletteSize(samples);
  const pal = kmeans(samples, k);
  dbg = { scale, samples: samples.length / 3, k, pal };
  applyPalette(px, pal);
};

self.onmessage = async (ev: MessageEvent<VectorizeRequest>) => {
  const { id, rgba, width, height, scale, options } = ev.data;
  const reply = (msg: VectorizeResponse) => (self as unknown as Worker).postMessage(msg);
  try {
    await ensureWasm();
    const px = new Uint8ClampedArray(rgba);
    dbg = { v: 'v3', quantize: options.quantize, mode: options.colorMode };
    preprocess(px, width, height, scale, options);
    const cfg = buildConfig(options, scale);
    try {
      const svg = vt.convertImageToSvg(new Uint8Array(px.buffer), width, height, cfg);
      reply({ id, svg: svg + '<!--dbg ' + JSON.stringify(dbg) + '-->' });
    } finally {
      // O objeto vive no heap do WASM: sem `free` cada pre-visualizacao vazaria memoria.
      cfg.free();
    }
  } catch (e) {
    reply({ id, error: e instanceof Error ? e.message : 'Falha ao vetorizar' });
  }
};
