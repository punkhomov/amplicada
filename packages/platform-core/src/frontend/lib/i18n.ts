import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next, Trans, useTranslation } from 'react-i18next';

export type LocaleResources = Record<string, Record<string, Record<string, string>>>;

export function createI18n(resources: LocaleResources) {
  const firstLang = Object.keys(resources)[0];

  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      fallbackLng: 'ru',
      resources,
      ns: firstLang ? Object.keys(resources[firstLang]) : [],
      defaultNS: 'core',
      interpolation: { escapeValue: false },
      detection: {
        order: ['localStorage', 'navigator', 'htmlTag'],
        caches: ['localStorage'],
        lookupLocalStorage: 'i18n_lng',
      },
    });

  document.documentElement.lang = i18n.language;
  i18n.on('languageChanged', lng => {
    document.documentElement.lang = lng;
  });

  return i18n;
}

export { i18n, Trans, useTranslation };
