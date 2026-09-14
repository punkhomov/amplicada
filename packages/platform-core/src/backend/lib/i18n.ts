import i18next, { type TFunction } from 'i18next';

export type LocaleResources = Record<string, Record<string, Record<string, string>>>;

const SUPPORTED_LANGUAGES = ['ru', 'en'];

let i18n: typeof i18next | null = null;

/** Отдельный instance (не модульный singleton, как на фронтенде) — на бэкенде несколько createApp() в одном процессе (тесты) не должны делить состояние. */
export async function createI18n(resources: LocaleResources): Promise<typeof i18next> {
  const firstLang = Object.keys(resources)[0];
  const instance = i18next.createInstance();
  await instance.init({
    fallbackLng: 'ru',
    resources,
    ns: firstLang ? Object.keys(resources[firstLang]) : [],
    defaultNS: 'core',
    interpolation: { escapeValue: false },
  });
  i18n = instance;
  return instance;
}

/** lang — уже разобранный resolveLanguage() код языка. Не мутирует глобальное состояние — безопасно для параллельных запросов. */
export function getFixedT(lang: string): TFunction {
  if (!i18n) throw new Error('createI18n() must be called before getFixedT()');
  return i18n.getFixedT(lang);
}

/** Простейший разбор Accept-Language: первый поддерживаемый базовый язык ('ru-RU' -> 'ru'), иначе fallback на 'ru'. */
export function resolveLanguage(acceptLanguage: string | undefined): string {
  if (!acceptLanguage) return 'ru';
  const tags = acceptLanguage.split(',').map(tag => tag.split(';')[0].trim().split('-')[0].toLowerCase());
  return tags.find(tag => SUPPORTED_LANGUAGES.includes(tag)) ?? 'ru';
}
