import type { SinkConfigRow } from '../schemas/index.js';
import { isRetryableStatus, type MetricSink, type SinkItem, type SinkSendResult } from './sink.js';

const MP_ENDPOINT = 'https://mc.yandex.ru/collect';
const UPLOAD_ENDPOINT = 'https://api-metrika.yandex.net/management/v1';

export interface YandexMetricaSettings {
  counterId: string;
  /** Соответствие «имя события → ID цели Метрики» (например `support.thread.opened: GOAL1`). */
  goalMap: Record<string, string>;
}

export function parseYandexSettings(settings: Record<string, unknown>): YandexMetricaSettings | null {
  const counterId = typeof settings.counterId === 'string' ? settings.counterId : '';
  if (!/^\d+$/.test(counterId)) return null;
  const goalMap: Record<string, string> = {};
  if (settings.goalMap && typeof settings.goalMap === 'object' && !Array.isArray(settings.goalMap)) {
    for (const [event, goal] of Object.entries(settings.goalMap as Record<string, unknown>)) {
      if (typeof goal === 'string' && goal.length > 0) goalMap[event] = goal;
    }
  }
  return { counterId, goalMap };
}

function itemPayload(item: SinkItem): Record<string, unknown> {
  return item.payload;
}

function clientIdOf(payload: Record<string, unknown>): string | null {
  const attributes = (payload.attributes ?? {}) as Record<string, unknown>;
  const clientId = attributes['yandex.client_id'];
  return typeof clientId === 'string' && clientId.length > 0 ? clientId : null;
}

function actorHashOf(payload: Record<string, unknown>): string | null {
  return typeof payload.actorHash === 'string' && payload.actorHash.length > 0 ? payload.actorHash : null;
}

function occurredAtUnixSeconds(payload: Record<string, unknown>): number | null {
  const raw = payload.occurredAt;
  if (typeof raw !== 'string') return null;
  const time = new Date(raw);
  return Number.isNaN(time.getTime()) ? null : Math.floor(time.getTime() / 1000);
}

/**
 * Measurement Protocol: одна ссылка на событие с `ClientId` (его выдаёт клиентский счётчик
 * Метрики через `ym(id, 'getClientID')`). Возвращает `null`, если событие не отправляемо.
 */
export function buildMeasurementProtocolUrl(item: SinkItem, settings: YandexMetricaSettings, token?: string): string | null {
  const payload = itemPayload(item);
  const name = typeof payload.name === 'string' ? payload.name : '';
  const goal = settings.goalMap[name];
  if (!name || !goal) return null;

  const clientId = clientIdOf(payload);
  if (!clientId) return null;

  const params = new URLSearchParams({
    tid: settings.counterId,
    cid: clientId,
    t: 'event',
    ea: goal,
  });
  const et = occurredAtUnixSeconds(payload);
  if (et !== null) params.set('et', String(et));
  if (token) params.set('ms', token);

  return `${MP_ENDPOINT}?${params.toString()}`;
}

/** Offline Conversions: CSV по `UserId` (у нас — псевдоним актора) и ID цели. */
export function buildOfflineConversionsCsv(items: SinkItem[], settings: YandexMetricaSettings): string | null {
  const rows = ['UserId,Target,DateTime'];
  for (const item of items) {
    const payload = itemPayload(item);
    const name = typeof payload.name === 'string' ? payload.name : '';
    const goal = settings.goalMap[name];
    const userId = actorHashOf(payload);
    const at = occurredAtUnixSeconds(payload);
    if (!name || !goal || !userId || at === null) continue;
    rows.push(`${userId},${goal},${at}`);
  }
  return rows.length > 1 ? `${rows.join('\n')}\n` : null;
}

export interface YandexMetricaSinkDeps {
  getSecret(name: string): string | undefined;
  fetchImpl?: typeof fetch;
}

async function uploadOfflineConversions(
  fetchImpl: typeof fetch,
  settings: YandexMetricaSettings,
  token: string,
  csv: string,
  signal: AbortSignal,
): Promise<SinkSendResult> {
  const form = new FormData();
  form.set('file', new Blob([csv], { type: 'text/csv' }), 'offline_conversions.csv');
  try {
    const response = await fetchImpl(`${UPLOAD_ENDPOINT}/counter/${settings.counterId}/offline_conversions/upload?client_id_type=USER_ID`, {
      method: 'POST',
      headers: { authorization: `OAuth ${token}` },
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (response.ok) return { ok: true, retryable: false };
    return { ok: false, retryable: isRetryableStatus(response.status), error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, retryable: true, error: error instanceof Error ? error.message : 'network error' };
  }
}

/**
 * Яндекс.Метрика: Measurement Protocol (события с ClientId) + Offline Conversions (по UserId
 * из псевдонима актора). OAuth-токен — из core `secrets` (`metrics.yandex_token`), никогда
 * не в БД. Выключен по умолчанию; живьём без токена/счётчика не проверялся.
 */
export function createYandexMetricaSink({ getSecret, fetchImpl = fetch }: YandexMetricaSinkDeps): MetricSink {
  return {
    id: 'yandex-metrica',
    titleKey: 'metrics:sink_yandex_metrica',
    accepts: ['event'],
    maxEvents: 100,

    matches(payload, config: SinkConfigRow) {
      const settings = parseYandexSettings(config.settings);
      if (!settings) return false;
      const name = typeof payload.name === 'string' ? payload.name : '';
      if (!settings.goalMap[name]) return false;
      // Отправляем либо с ClientId (MP), либо по псевдониму актора (offline conversions).
      return clientIdOf(payload) !== null || actorHashOf(payload) !== null;
    },

    sanitizeSettings(input) {
      const settings: Record<string, unknown> = {};
      if (typeof input.counterId === 'string' && /^\d+$/.test(input.counterId)) settings.counterId = input.counterId;
      if (input.goalMap && typeof input.goalMap === 'object' && !Array.isArray(input.goalMap)) {
        const goalMap: Record<string, string> = {};
        for (const [event, goal] of Object.entries(input.goalMap as Record<string, unknown>)) {
          if (typeof goal === 'string' && goal.length > 0) goalMap[event] = goal;
        }
        settings.goalMap = goalMap;
      }
      return settings;
    },

    async send(items, config, signal) {
      const settings = parseYandexSettings(config.settings);
      if (!settings) return { ok: false, retryable: false, error: 'counterId is not configured' };

      const token = getSecret('metrics.yandex_token');
      const mpItems = items.filter(item => buildMeasurementProtocolUrl(item, settings) !== null);

      for (const item of mpItems) {
        const url = buildMeasurementProtocolUrl(item, settings, token);
        if (!url) continue;
        try {
          const response = await fetchImpl(url, { method: 'GET', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
          if (!response.ok) {
            return { ok: false, retryable: isRetryableStatus(response.status), error: `MP HTTP ${response.status}` };
          }
        } catch (error) {
          return { ok: false, retryable: true, error: error instanceof Error ? error.message : 'network error' };
        }
      }

      const csv = buildOfflineConversionsCsv(items, settings);
      if (mpItems.length === 0 && !csv) {
        return { ok: false, retryable: false, error: 'no sendable items (goalMap/clientId/actorHash)' };
      }
      if (csv) {
        if (!token) return { ok: false, retryable: false, error: 'metrics.yandex_token is not configured' };
        const uploaded = await uploadOfflineConversions(fetchImpl, settings, token, csv, signal);
        if (!uploaded.ok) return uploaded;
      }

      return { ok: true, retryable: false };
    },
  };
}
