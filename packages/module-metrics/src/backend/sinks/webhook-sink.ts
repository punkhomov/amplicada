import { createHmac } from 'node:crypto';
import type { SinkConfigRow } from '../schemas/index.js';
import { isRetryableStatus, type MetricSink, matchesEventFilter } from './sink.js';

export interface WebhookSinkDeps {
  getSecret(name: string): string | undefined;
  fetchImpl?: typeof fetch;
}

/**
 * Webhook: POST батча JSON, подпись HMAC-SHA256 в `x-metrics-signature` (если задан
 * секрет `metrics.webhook_secret`), таймаут 10 с. 4xx без 429 — в DLQ.
 */
export function createWebhookSink({ getSecret, fetchImpl = fetch }: WebhookSinkDeps): MetricSink {
  return {
    id: 'webhook',
    titleKey: 'metrics:sink_webhook',
    accepts: ['event'],
    maxEvents: 200,

    matches(payload, config: SinkConfigRow) {
      return matchesEventFilter(String(payload.name ?? ''), config.settings.events);
    },

    sanitizeSettings(input) {
      const settings: Record<string, unknown> = {};
      if (typeof input.url === 'string') {
        const url = input.url.trim();
        if (url === '' || /^https?:\/\//i.test(url)) settings.url = url;
      }
      if (Array.isArray(input.events)) {
        settings.events = input.events.filter(entry => typeof entry === 'string').slice(0, 100);
      }
      return settings;
    },

    async send(items, config, signal) {
      const url = typeof config.settings.url === 'string' ? config.settings.url : '';
      if (!url) return { ok: false, retryable: false, error: 'webhook url is not configured' };

      const body = JSON.stringify({ items });
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      const secret = getSecret('metrics.webhook_secret');
      if (secret) {
        headers['x-metrics-signature'] = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
      }

      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        });
        if (response.ok) return { ok: true, retryable: false };
        return { ok: false, retryable: isRetryableStatus(response.status), error: `HTTP ${response.status}` };
      } catch (error) {
        return { ok: false, retryable: true, error: error instanceof Error ? error.message : 'network error' };
      }
    },
  };
}
