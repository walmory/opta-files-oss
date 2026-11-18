/**
 * Single source of branding assets for every PDF-generation engine (pdfGenerator, quotePdf,
 * timesheetPdf, Studio templates), so none of them hardcode the Opta Files logo/name/colors.
 */
import { getBranding } from '../config/branding';

export interface PdfBrandingAssets {
  logoUrl: string;
  companyName: string;
  primaryColor: string;
  secondaryColor: string;
  primaryColorRgb: [number, number, number];
  secondaryColorRgb: [number, number, number];
}

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '');
  const value = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/** Reads current branding (localStorage, falls back to ENV.COMPANY) shaped for jsPDF/pdf-lib/Konva. */
export const getPdfBrandingAssets = (): PdfBrandingAssets => {
  const branding = getBranding();
  return {
    logoUrl: branding.logoDataUrl || '/opta-files-wordmark.svg',
    companyName: branding.companyName,
    primaryColor: branding.primaryColor,
    secondaryColor: branding.secondaryColor,
    primaryColorRgb: hexToRgb(branding.primaryColor),
    secondaryColorRgb: hexToRgb(branding.secondaryColor)
  };
};

/** Loads the branding logo as an <img>, resolving null if it fails (caller should fall back to text). */
export const loadPdfLogoImage = (logoUrl: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = logoUrl;
  });
