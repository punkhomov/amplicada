import { useApiClient, useQuery } from '@amplicada/platform-core/frontend';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { metricsContextQueryOptions } from '../../../lib/query-options.js';
import { chunkEvents, DEFAULT_FLUSH_INTERVAL_MS, MetricsQueue } from '../../../lib/queue.js';
import { normalizeRoute } from '../../../lib/route.js';
import { currentSessionId } from '../../../lib/session.js';

function sendBatch(chunk: unknown[], viaBeacon: boolean): void {
  const body = JSON.stringify({ events: chunk });
  if (viaBeacon && typeof navigator.sendBeacon === 'function') {
    const sent = navigator.sendBeacon('/api/metrics/collect', new Blob([body], { type: 'application/json' }));
    if (sent) return;
  }
  void fetch('/api/metrics/collect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => {
    // События телеметрии не влияют на продукт: потеря батча допустима.
  });
}

/**
 * Клиентский трекер: pageview на смену маршрута, батчи раз в 10 секунд, флаш при уходе
 * со страницы через beacon. Молчит, если сбор выключен или включён opt-out.
 */
export function MetricsTracker() {
  const location = useLocation();
  const api = useApiClient();
  const { data: context } = useQuery(metricsContextQueryOptions(api));
  const queueRef = useRef<MetricsQueue | null>(null);
  if (queueRef.current === null) queueRef.current = new MetricsQueue();
  const lastPathRef = useRef<string | null>(null);

  const enabled = context?.enabled ?? false;
  const maxBatchEvents = context?.limits.maxBatchEvents ?? 100;
  const samplePageviewRate = context?.sampleRates.pageview ?? 1;

  useEffect(() => {
    if (!enabled) return;
    const queue = queueRef.current;
    if (!queue) return;

    const flush = (viaBeacon: boolean) => {
      const items = queue.drain();
      if (items.length === 0) return;
      for (const chunk of chunkEvents(items, maxBatchEvents)) sendBatch(chunk, viaBeacon);
    };

    const interval = window.setInterval(() => flush(false), DEFAULT_FLUSH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      flush(false);
    };
  }, [enabled, maxBatchEvents]);

  useEffect(() => {
    if (!enabled) return;
    const path = location.pathname;
    if (lastPathRef.current === path) return;
    lastPathRef.current = path;
    if (samplePageviewRate <= 0 || Math.random() > samplePageviewRate) return;
    queueRef.current?.push({
      id: crypto.randomUUID(),
      name: 'page.view',
      kind: 'page',
      occurredAt: new Date().toISOString(),
      sessionId: currentSessionId(),
      context: {
        route: normalizeRoute(path),
        url: path,
        referrer: document.referrer || undefined,
      },
      attributes: { title: document.title },
      sampling: { rate: samplePageviewRate },
    });
  }, [location.pathname, enabled, samplePageviewRate]);

  return null;
}
