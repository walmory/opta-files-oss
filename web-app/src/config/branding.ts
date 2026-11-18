/**
 * White-label branding config. Persisted client-side (localStorage), same runtime-override
 * pattern as getBackendUrl()/setBackendUrl() in ./env.ts.
 */
import { ENV } from './env';

const STORAGE_KEY = 'optafiles:branding';

export interface BrandingConfig {
  logoDataUrl: string | null;
  companyName: string;
  primaryColor: string;
  secondaryColor: string;
}

export const DEFAULT_BRANDING: BrandingConfig = {
  logoDataUrl: null,
  companyName: ENV.COMPANY.name,
  primaryColor: '#1b3f8b',
  secondaryColor: '#2e8b3d'
};

/** Logo must be roughly this aspect ratio (width/height), within LOGO_ASPECT_TOLERANCE. */
export const LOGO_ASPECT_MIN = 1; // square
export const LOGO_ASPECT_MAX = 3; // up to 3:1 wide
export const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2MB

export const getBranding = (): BrandingConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BRANDING;
    const parsed = JSON.parse(raw) as Partial<BrandingConfig>;
    return { ...DEFAULT_BRANDING, ...parsed };
  } catch {
    return DEFAULT_BRANDING;
  }
};

export const setBranding = (config: BrandingConfig) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore storage errors
  }
};

export const resetBranding = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};

export class LogoValidationError extends Error {}

/** Validates dimensions/size before accepting a logo upload; throws LogoValidationError with a user-facing message. */
export const validateLogoFile = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (file.size > LOGO_MAX_BYTES) {
      reject(new LogoValidationError('A imagem deve ter no máximo 2MB.'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      reject(new LogoValidationError('Selecione um arquivo de imagem válido.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new LogoValidationError('Não foi possível ler o arquivo.'));
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onerror = () => reject(new LogoValidationError('Arquivo de imagem inválido.'));
      img.onload = () => {
        const ratio = img.width / img.height;
        if (ratio < LOGO_ASPECT_MIN * 0.9 || ratio > LOGO_ASPECT_MAX * 1.05) {
          reject(
            new LogoValidationError(
              `Proporção inválida (${img.width}x${img.height}). Use uma logo entre quadrada (1:1) e ${LOGO_ASPECT_MAX}:1 (largura:altura) para não distorcer.`
            )
          );
          return;
        }
        resolve(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
};
