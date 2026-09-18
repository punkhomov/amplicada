import type { KeyValueStorage } from './session.js';

export const METRICS_OPT_OUT_KEY = 'metrics.optout';

export interface OptOutEnvironment {
  storage?: KeyValueStorage | null;
  /** `navigator.doNotTrack` / legacy `window.doNotTrack` — строкой, как отдаёт браузер. */
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}

/** Opt-out пользователя: локальный флаг, DNT и GPC. Чистая функция — тестируется без браузера. */
export function isMetricsOptedOut(environment: OptOutEnvironment = {}): boolean {
  if (environment.storage?.getItem(METRICS_OPT_OUT_KEY) === '1') return true;
  if (environment.doNotTrack === '1') return true;
  if (environment.globalPrivacyControl === true) return true;
  return false;
}

/** Читает окружение браузера; недоступность storage трактуется как «не opt-out». */
export function detectMetricsOptOut(): boolean {
  try {
    const navigatorWithGpc = navigator as Navigator & { globalPrivacyControl?: boolean };
    const windowWithDnt = window as Window & { doNotTrack?: string | null };
    return isMetricsOptedOut({
      storage: window.localStorage,
      doNotTrack: navigator.doNotTrack ?? windowWithDnt.doNotTrack ?? null,
      globalPrivacyControl: navigatorWithGpc.globalPrivacyControl,
    });
  } catch {
    return false;
  }
}
