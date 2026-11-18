/**
 * O pacote `wasm_vtracer` e publicado no formato "bundler" do wasm-bindgen: o modulo
 * principal importa o .wasm diretamente, o que o Vite nao resolve sozinho. Por isso o
 * app carrega o `_bg.js` (JS puro) e instancia o .wasm na mao — este arquivo declara os
 * tipos dessa entrada interna, que o pacote nao tipa.
 */
declare module 'wasm_vtracer/wasm_vtracer_bg.js' {
  export class TracerConfig {
    constructor();
    free(): void;
    /** 0 = colorido, 1 = binario (preto e branco) */
    setColorMode(mode: number): void;
    /** 0 = camadas empilhadas, 1 = recorte (cutout) */
    setHierarchical(mode: number): void;
    /** 0 = poligonos, 1 = curvas de Bezier, 2 = sem simplificacao */
    setPathSimplifyMode(mode: number): void;
    setFilterSpeckle(v: number): void;
    setColorPrecision(v: number): void;
    setLayerDifference(v: number): void;
    setCornerThreshold(v: number): void;
    setLengthThreshold(v: number): void;
    setMaxIterations(v: number): void;
    setSpliceThreshold(v: number): void;
    setPathPrecision(v: number): void;
    presetPixelArt(): void;
    presetPhoto(): void;
    presetLineArt(): void;
  }
  export function convertImageToSvg(rgba: Uint8Array, width: number, height: number, config: TracerConfig): string;
  export function getVersion(): string;
  export function __wbg_set_wasm(exports: unknown): void;
}
