/**
 * Vetorizacao de imagens (raster -> SVG) com o VTracer (visioncortex), compilado para
 * WebAssembly. Roda inteiramente no navegador, dentro de um Web Worker, para nao travar
 * a interface enquanto o tracado acontece.
 *
 * Motor: https://github.com/visioncortex/vtracer (MIT/Apache-2.0), via `wasm_vtracer`.
 */

export type VectorColorMode = 'color' | 'bw';
/** Como as bordas viram caminho: curvas suaves, retas ou o contorno cru dos pixels. */
export type VectorPathMode = 'spline' | 'polygon' | 'pixel';
export type VectorLayerMode = 'stacked' | 'cutout';

export interface VectorizeOptions {
  colorMode: VectorColorMode;
  /**
   * Reduz a imagem a uma paleta fixa antes de tracar (k-means), como o "Cores" do Image
   * Trace do Illustrator. E o que elimina o halo do anti-aliasing e deixa as bordas
   * limpas; desligado, o VTracer agrupa as cores sozinho (melhor para fotos).
   */
  quantize: boolean;
  /** Tamanho da paleta quando `quantize` esta ligado; 0 = detectar automaticamente. */
  palette: number;
  pathMode: VectorPathMode;
  layerMode: VectorLayerMode;
  /** Descarta manchas menores que N pixels — o antidoto para ruido de JPEG. */
  filterSpeckle: number;
  /** Bits por canal na quantizacao de cor (1-8): quanto maior, mais cores no SVG. */
  colorPrecision: number;
  /** Diferenca minima de cor para abrir uma nova camada (0-255). */
  layerDifference: number;
  /** Angulo (graus) a partir do qual um vertice e tratado como canto vivo. */
  cornerThreshold: number;
  /** Comprimento minimo de segmento antes de tentar encaixar curva. */
  lengthThreshold: number;
  maxIterations: number;
  /** Angulo (graus) para emendar curvas vizinhas. */
  spliceThreshold: number;
  /** Casas decimais das coordenadas no SVG — menos casas, arquivo menor. */
  pathPrecision: number;
}

export const DEFAULT_OPTIONS: VectorizeOptions = {
  colorMode: 'color',
  quantize: true,
  palette: 0,
  pathMode: 'spline',
  layerMode: 'stacked',
  filterSpeckle: 4,
  colorPrecision: 6,
  layerDifference: 16,
  cornerThreshold: 60,
  lengthThreshold: 4,
  maxIterations: 10,
  spliceThreshold: 45,
  pathPrecision: 2
};

export interface VectorPreset {
  id: string;
  label: string;
  hint: string;
  options: VectorizeOptions;
}

/**
 * Os presets existem porque os parametros do VTracer sao pouco intuitivos isolados: o que
 * separa uma logo de uma foto nao e um slider, e uma combinacao (quantizacao + filtro de
 * manchas + tipo de caminho).
 */
export const VECTOR_PRESETS: VectorPreset[] = [
  {
    id: 'logo',
    label: 'Logo / Ilustracao',
    hint: 'Paleta fixa, bordas limpas, retas retas',
    // Paleta exata + precisao maxima: as cores ja chegam separadas, o VTracer so traca.
    options: { ...DEFAULT_OPTIONS, quantize: true, palette: 0, filterSpeckle: 4, colorPrecision: 8, layerDifference: 0, cornerThreshold: 60, lengthThreshold: 4, spliceThreshold: 45 }
  },
  {
    id: 'photo',
    label: 'Foto',
    hint: 'Muitas camadas de cor, tolera ruido',
    options: { ...DEFAULT_OPTIONS, quantize: false, filterSpeckle: 10, colorPrecision: 8, layerDifference: 12, cornerThreshold: 80, spliceThreshold: 45 }
  },
  {
    id: 'lineart',
    label: 'Traco / P&B',
    hint: 'Assinatura, desenho, carimbo',
    // Limiar de Otsu em vez do 128 fixo: funciona com scan claro ou escuro.
    options: { ...DEFAULT_OPTIONS, colorMode: 'bw', quantize: true, filterSpeckle: 3, cornerThreshold: 60 }
  },
  {
    id: 'pixel',
    label: 'Pixel art',
    hint: 'Preserva a borda quadrada do pixel',
    options: { ...DEFAULT_OPTIONS, pathMode: 'pixel', quantize: true, palette: 0, filterSpeckle: 0, colorPrecision: 8, layerDifference: 0, pathPrecision: 0 }
  }
];

export interface VectorizeRequest {
  id: number;
  rgba: ArrayBuffer;
  width: number;
  height: number;
  /** Fator de supersampling aplicado antes (1 = tamanho original). */
  scale: number;
  options: VectorizeOptions;
}

export type VectorizeResponse = { id: number; svg: string } | { id: number; error: string };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (svg: string) => void; reject: (e: Error) => void }>();

const getWorker = () => {
  if (worker) return worker;
  worker = new Worker(new URL('./vectorize.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<VectorizeResponse>) => {
    const entry = pending.get(ev.data.id);
    if (!entry) return;
    pending.delete(ev.data.id);
    if ('error' in ev.data) entry.reject(new Error(ev.data.error));
    else entry.resolve(ev.data.svg);
  };
  worker.onerror = (ev) => {
    // Um erro fatal derruba o worker inteiro: rejeita tudo que estava na fila e permite
    // que a proxima chamada suba uma instancia nova.
    for (const [, entry] of pending) entry.reject(new Error(ev.message || 'Falha no motor de vetorizacao'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
};

export interface RasterInput {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Fator aplicado sobre a imagem original (>1 = ampliada antes do tracado). */
  scale: number;
  /** Dimensoes originais, para o SVG final sair no tamanho certo. */
  outWidth: number;
  outHeight: number;
}

/**
 * Envia os pixels para o worker e devolve o SVG ja normalizado: `viewBox` no espaco
 * ampliado e `width`/`height` nas dimensoes originais da imagem.
 */
export const vectorize = async (input: RasterInput, options: VectorizeOptions): Promise<string> => {
  const id = ++seq;
  const buffer = input.data.buffer.slice(0) as ArrayBuffer;
  const w = getWorker();
  const svg = await new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: VectorizeRequest = { id, rgba: buffer, width: input.width, height: input.height, scale: input.scale, options };
    w.postMessage(req, [buffer]);
  });
  return normalizeSvg(svg, input.width, input.height, input.outWidth, input.outHeight);
};

/** Reescreve a tag raiz: o VTracer so emite width/height no tamanho da imagem tracada. */
const normalizeSvg = (svg: string, traceW: number, traceH: number, outW: number, outH: number) =>
  svg.replace(/<svg\b[^>]*>/, (tag) => {
    let t = tag.replace(/\s(width|height|viewBox)="[^"]*"/g, '');
    t = t.replace(/^<svg/, `<svg width="${outW}" height="${outH}" viewBox="0 0 ${traceW} ${traceH}"`);
    if (!/xmlns=/.test(t)) t = t.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    return t;
  });

/** Nunca amplia mais que isso: acima disso so cresce o tempo, nao a qualidade. */
const MAX_UPSCALE = 4;

/**
 * Desenha a imagem num canvas no tamanho de analise e devolve os pixels RGBA.
 * Imagens pequenas sao AMPLIADAS com interpolacao suave antes de tracar (supersampling):
 * o VTracer ajusta curvas em cima da borda dos pixels, e uma borda com 4x mais amostras
 * vira curva lisa e reta reta, em vez de escadinha. Imagens grandes sao reduzidas ao
 * mesmo alvo, o que limita o tempo. Pixel art nunca e reamostrado.
 */
export const toRgba = (img: CanvasImageSource, naturalW: number, naturalH: number, targetSize: number, options: VectorizeOptions): RasterInput => {
  const longest = Math.max(naturalW, naturalH);
  let scale = targetSize > 0 ? targetSize / longest : 1;
  if (options.pathMode === 'pixel') scale = 1;
  scale = Math.min(MAX_UPSCALE, scale);
  const width = Math.max(1, Math.round(naturalW * scale));
  const height = Math.max(1, Math.round(naturalH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas indisponivel neste navegador');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height, scale: width / naturalW, outWidth: naturalW, outHeight: naturalH };
};

/** Numero de caminhos e de cores distintas — o resumo util para julgar o resultado. */
export const svgStats = (svg: string) => {
  const paths = svg.match(/<path\b/g)?.length ?? 0;
  const colors = new Set(svg.match(/fill="(#[0-9a-fA-F]{3,8}|rgb\([^)]*\))"/g) ?? []);
  return { paths, colors: colors.size };
};

/** Substitui a extensao do arquivo original por `.svg`. */
export const svgName = (name: string) => `${name.replace(/\.[^.]+$/, '')}.svg`;
