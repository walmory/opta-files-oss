import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import ptCommon from './locales/pt/common.json';
import ptSettings from './locales/pt/settings.json';
import ptStudio from './locales/pt/studio.json';
import ptPdf from './locales/pt/pdf.json';
import ptPages from './locales/pt/pages.json';
import ptAuth from './locales/pt/auth.json';

import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enStudio from './locales/en/studio.json';
import enPdf from './locales/en/pdf.json';
import enPages from './locales/en/pages.json';
import enAuth from './locales/en/auth.json';

import esCommon from './locales/es/common.json';
import esSettings from './locales/es/settings.json';
import esStudio from './locales/es/studio.json';
import esPdf from './locales/es/pdf.json';
import esPages from './locales/es/pages.json';
import esAuth from './locales/es/auth.json';

import frCommon from './locales/fr/common.json';
import frSettings from './locales/fr/settings.json';
import frStudio from './locales/fr/studio.json';
import frPdf from './locales/fr/pdf.json';
import frPages from './locales/fr/pages.json';
import frAuth from './locales/fr/auth.json';

import deCommon from './locales/de/common.json';
import deSettings from './locales/de/settings.json';
import deStudio from './locales/de/studio.json';
import dePdf from './locales/de/pdf.json';
import dePages from './locales/de/pages.json';
import deAuth from './locales/de/auth.json';

import itCommon from './locales/it/common.json';
import itSettings from './locales/it/settings.json';
import itStudio from './locales/it/studio.json';
import itPdf from './locales/it/pdf.json';
import itPages from './locales/it/pages.json';
import itAuth from './locales/it/auth.json';

export const SUPPORTED_LANGUAGES = ['pt', 'en', 'es', 'fr', 'de', 'it'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  pt: 'Português',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano'
};

const resources = {
  pt: { common: ptCommon, settings: ptSettings, studio: ptStudio, pdf: ptPdf, pages: ptPages, auth: ptAuth },
  en: { common: enCommon, settings: enSettings, studio: enStudio, pdf: enPdf, pages: enPages, auth: enAuth },
  es: { common: esCommon, settings: esSettings, studio: esStudio, pdf: esPdf, pages: esPages, auth: esAuth },
  fr: { common: frCommon, settings: frSettings, studio: frStudio, pdf: frPdf, pages: frPages, auth: frAuth },
  de: { common: deCommon, settings: deSettings, studio: deStudio, pdf: dePdf, pages: dePages, auth: deAuth },
  it: { common: itCommon, settings: itSettings, studio: itStudio, pdf: itPdf, pages: itPages, auth: itAuth }
};

export const I18N_STORAGE_KEY = 'optafiles:lang';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'pt',
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    ns: ['common', 'settings', 'studio', 'pdf', 'pages', 'auth'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: I18N_STORAGE_KEY,
      caches: ['localStorage']
    }
  });

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

export default i18n;
