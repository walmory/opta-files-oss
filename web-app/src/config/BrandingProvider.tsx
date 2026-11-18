/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { type BrandingConfig, DEFAULT_BRANDING, getBranding, setBranding as persistBranding } from './branding';

interface BrandingContextValue {
  branding: BrandingConfig;
  updateBranding: (config: BrandingConfig) => void;
  resetToDefault: () => void;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBrandingState] = useState<BrandingConfig>(() => getBranding());

  useEffect(() => {
    document.title = branding.companyName;

    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon && branding.logoDataUrl) {
      favicon.href = branding.logoDataUrl;
    } else if (favicon && !branding.logoDataUrl) {
      favicon.href = '/opta-files.svg';
    }

    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor) themeColor.content = branding.primaryColor;
  }, [branding]);

  const updateBranding = useCallback((config: BrandingConfig) => {
    persistBranding(config);
    setBrandingState(config);
  }, []);

  const resetToDefault = useCallback(() => {
    persistBranding(DEFAULT_BRANDING);
    setBrandingState(DEFAULT_BRANDING);
  }, []);

  const value = useMemo(() => ({ branding, updateBranding, resetToDefault }), [branding, updateBranding, resetToDefault]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding must be used within a BrandingProvider');
  return ctx;
}
