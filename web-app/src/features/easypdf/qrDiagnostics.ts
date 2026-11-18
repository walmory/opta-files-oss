/**
 * Scan-quality analysis for a generated QR code.
 *
 * Everything here is computed from the *encoded payload*, not from the rendered image:
 * the symbol version (and therefore the module count) is obtained from the same encoder
 * qr-code-styling uses, so the numbers shown in the UI match the exported file exactly.
 */
import qrcode from 'qrcode-generator';
import { contrastRatio } from './logoPalette';

export type EcLevel = 'L' | 'M' | 'Q' | 'H';

/** Nominal error-correction capacity of each level, in % of the codewords. */
export const EC_PERCENT: Record<EcLevel, number> = { L: 7, M: 15, Q: 25, H: 30 };

/** Max logo area (% of the symbol) considered safe for each level, with a margin of safety. */
const LOGO_BUDGET: Record<EcLevel, number> = { L: 3, M: 8, Q: 16, H: 24 };

/** Smallest module printable by a common camera/handheld scanner, in millimetres. */
const MIN_MODULE_MM = 0.4;

export type IssueTone = 'ok' | 'warn' | 'error';

export interface QrIssue {
  tone: IssueTone;
  text: string;
}

export interface QrDiagnostic {
  /** 1..40, or 0 when the payload could not be encoded at all. */
  version: number;
  /** Symbol size in modules (without the quiet zone). */
  modules: number;
  level: EcLevel;
  /** Bytes of UTF-8 payload. */
  bytes: number;
  /** Payload bytes as a % of what this version/level can hold. */
  capacityUsed: number;
  /** Logo area as a % of the symbol area. */
  logoCoverage: number;
  logoBudget: number;
  contrast: number;
  /** Quiet zone in modules. 4 is the spec minimum. */
  quietZone: number;
  /** Minimum printed width, in mm, that keeps modules scannable. */
  minPrintMm: number;
  /** Comfortable scanning distance at that minimum size, in metres. */
  scanDistanceM: number;
  /** 0..100 overall confidence. */
  score: number;
  issues: QrIssue[];
  /** True when the payload is too large to be encoded at this level. */
  overflow: boolean;
}

const capacityCache = new Map<string, number>();

/** The typings restrict the version to a literal union; we only ever pass 1..40. */
type TypeNumber = Parameters<typeof qrcode>[0];

const fits = (version: number, level: EcLevel, length: number) => {
  try {
    const q = qrcode(version as TypeNumber, level);
    q.addData('a'.repeat(length));
    q.make();
    return true;
  } catch {
    return false;
  }
};

/** Max byte-mode payload of a version/level pair, found by binary search on the encoder itself. */
const capacityOf = (version: number, level: EcLevel) => {
  const key = `${version}:${level}`;
  const cached = capacityCache.get(key);
  if (cached !== undefined) return cached;
  let lo = 1;
  let hi = 2954; // absolute maximum (v40-L, byte mode)
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(version, level, mid)) lo = mid;
    else hi = mid - 1;
  }
  capacityCache.set(key, lo);
  return lo;
};

export interface DiagnosticInput {
  value: string;
  level: EcLevel;
  /** Quiet zone, in modules. */
  margin: number;
  /** Logo width as a % of the symbol width; 0 when there is no logo. */
  logoSize: number;
  hasLogo: boolean;
  /** Darkest module colour (the gradient end that matters least is ignored). */
  fg: string;
  bg: string;
  /** Transparent background: scanners fall back to whatever is behind the code. */
  transparent: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const analyzeQr = (input: DiagnosticInput): QrDiagnostic => {
  const { value, level, margin, logoSize, hasLogo, fg, bg, transparent } = input;
  const bytes = new TextEncoder().encode(value).length;

  let modules = 0;
  let version = 0;
  let overflow = false;
  if (value) {
    try {
      const q = qrcode(0, level); // 0 = pick the smallest version that fits
      q.addData(value);
      q.make();
      modules = q.getModuleCount();
      version = (modules - 17) / 4;
    } catch {
      overflow = true;
    }
  }

  const capacity = version ? capacityOf(version, level) : 0;
  const capacityUsed = capacity ? clamp((bytes / capacity) * 100, 0, 100) : 0;
  const logoCoverage = hasLogo ? (logoSize / 100) ** 2 * 100 : 0;
  const logoBudget = LOGO_BUDGET[level];
  const contrast = contrastRatio(fg, transparent ? '#ffffff' : bg);
  const quietZone = margin;

  const minPrintMm = modules ? Math.round((modules + quietZone * 2) * MIN_MODULE_MM * 10) / 10 : 0;
  const scanDistanceM = Math.round((minPrintMm / 1000) * 10 * 10) / 10;

  const issues: QrIssue[] = [];
  let score = 100;

  if (overflow) {
    issues.push({ tone: 'error', text: `Conteúdo grande demais para o nível ${level}. Reduza o texto ou baixe a correção de erro.` });
    score = 0;
  }

  if (contrast < 3) {
    issues.push({ tone: 'error', text: `Contraste ${contrast.toFixed(1)}:1 — muitos leitores vão falhar. Escureça a cor do código.` });
    score -= 40;
  } else if (contrast < 5) {
    issues.push({ tone: 'warn', text: `Contraste ${contrast.toFixed(1)}:1 é justo. O ideal é 7:1 ou mais.` });
    score -= 12;
  } else {
    issues.push({ tone: 'ok', text: `Contraste ${contrast.toFixed(1)}:1 entre módulos e fundo.` });
  }

  if (transparent) {
    issues.push({ tone: 'warn', text: 'Fundo transparente: a leitura depende da superfície onde o QR for aplicado.' });
    score -= 8;
  }

  if (hasLogo) {
    if (logoCoverage > logoBudget) {
      issues.push({ tone: 'error', text: `A logo cobre ${logoCoverage.toFixed(0)}% do código — acima do limite de ${logoBudget}% para o nível ${level}.` });
      score -= 30;
    } else if (logoCoverage > logoBudget * 0.8) {
      issues.push({ tone: 'warn', text: `A logo cobre ${logoCoverage.toFixed(0)}% do código, perto do limite de ${logoBudget}%.` });
      score -= 10;
    } else {
      issues.push({ tone: 'ok', text: `Logo ocupa ${logoCoverage.toFixed(0)}% da área — dentro dos ${logoBudget}% do nível ${level}.` });
    }
    if (level !== 'H' && level !== 'Q') {
      issues.push({ tone: 'error', text: 'Com logo, use correção de erro Alta (H).' });
      score -= 20;
    }
  }

  if (quietZone < 4) {
    issues.push({ tone: 'warn', text: `Margem de ${quietZone} módulos. A norma pede 4 para leitura confiável.` });
    score -= 10;
  } else {
    issues.push({ tone: 'ok', text: `Margem de ${quietZone} módulos (mínimo da norma: 4).` });
  }

  if (capacityUsed > 92 && !overflow) {
    issues.push({ tone: 'warn', text: `Payload em ${capacityUsed.toFixed(0)}% da capacidade da versão ${version}.` });
    score -= 6;
  }

  if (version >= 15) {
    issues.push({ tone: 'warn', text: `Versão ${version} (${modules}×${modules} módulos): imprima maior ou encurte o conteúdo.` });
    score -= 8;
  }

  return {
    version,
    modules,
    level,
    bytes,
    capacityUsed,
    logoCoverage,
    logoBudget,
    contrast,
    quietZone,
    minPrintMm,
    scanDistanceM,
    score: clamp(Math.round(score), 0, 100),
    issues,
    overflow
  };
};

export const scoreTone = (score: number): IssueTone => (score >= 85 ? 'ok' : score >= 60 ? 'warn' : 'error');
export const scoreLabel = (score: number) => (score >= 85 ? 'Pronto para produção' : score >= 60 ? 'Funciona, mas dá para melhorar' : 'Risco de falha na leitura');
