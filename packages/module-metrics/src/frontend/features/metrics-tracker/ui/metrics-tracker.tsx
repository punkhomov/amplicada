import { frontendErrors, useApiClient, useQuery } from '@amplicada/platform-core/frontend';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { extractClickAttributes } from '../../../lib/clicks.js';
import { errorEventFromUnknown } from '../../../lib/error-capture.js';
import { detectMetricsOptOut } from '../../../lib/optout.js';
import { metricsContextQueryOptions } from '../../../lib/query-options.js';
import { chunkEvents, DEFAULT_FLUSH_INTERVAL_MS, MetricsQueue } from '../../../lib/queue.js';
import { normalizeRoute } from '../../../lib/route.js';
import { currentSessionId } from '../../../lib/session.js';
import { observeWebVitals } from '../../../lib/vitals.js';

const EVENT_NAME_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

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
 * Клиентский трекер: `page.view` на смену маршрута, `ui.*` по `data-metrics`-атрибутам,
 * ошибки (`window`, rejections, React 19 через `frontendErrors`) и Web Vitals; батчи
 * раз в 10 секунд, флаш при уходе со страницы через beacon. Молчит при выключенном сборе,
 * opt-out (localStorage `metrics.optout`) и DNT/GPC.
 */
export function MetricsTracker() {
  const location = useLocation();
  const api = useApiClient();
  const { data: context } = useQuery(metricsContextQueryOptions(api));
  const queueRef = useRef<MetricsQueue | null>(null);
  if (queueRef.current === null) queueRef.current = new MetricsQueue();
  const lastPathRef = useRef<string | null>(null);
  const optedOutRef = useRef<boolean | null>(null);
  if (optedOutRef.current === null) optedOutRef.current = detectMetricsOptOut();

  const enabled = (context?.enabled ?? false) && !optedOutRef.current;
  const maxBatchEvents = context?.limits.maxBatchEvents ?? 100;
  const samplePageviewRate = context?.sampleRates.pageview ?? 1;
  const sampleClickRate = context?.sampleRates.ui ?? 0;

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

  useEffect(() => {
    if (!enabled) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-metrics]') : null;
      const name = target?.getAttribute('data-metrics');
      if (!target || !name || !EVENT_NAME_RE.test(name)) return;
      if (sampleClickRate <= 0 || Math.random() > sampleClickRate) return;
      queueRef.current?.push({
        id: crypto.randomUUID(),
        name,
        kind: 'ui',
        occurredAt: new Date().toISOString(),
        sessionId: currentSessionId(),
        context: {
          route: normalizeRoute(window.location.pathname),
          url: window.location.pathname,
          referrer: document.referrer || undefined,
        },
        attributes: {
          element: target.tagName.toLowerCase(),
          ...extractClickAttributes(Array.from(target.attributes)),
        },
        sampling: { rate: sampleClickRate },
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [enabled, sampleClickRate]);

  useEffect(() => {
    if (!enabled) return;
    const report = (event: Parameters<MetricsQueue['push']>[0]) => queueRef.current?.push(event);
    const contextOf = () => ({ route: normalizeRoute(window.location.pathname), sessionId: currentSessionId() });

    observeWebVitals(report, contextOf);

    const onWindowError = (event: ErrorEvent) => {
      report(
        errorEventFromUnknown(event.error ?? event.message ?? 'Unknown window error', {
          source: 'window-error',
          ...contextOf(),
        }),
      );
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      report(errorEventFromUnknown(event.reason, { source: 'unhandled-rejection', ...contextOf() }));
    };
    window.addEventListener('error', onWindowError, true);
    window.addEventListener('unhandledrejection', onRejection);

    const unsubscribe = frontendErrors.subscribe((error, info) => {
      report(
        errorEventFromUnknown(error, {
          source: typeof info.source === 'string' ? info.source : 'react',
          componentStack: typeof info.componentStack === 'string' ? info.componentStack : undefined,
          ...contextOf(),
        }),
      );
    });

    return () => {
      window.removeEventListener('error', onWindowError, true);
      window.removeEventListener('unhandledrejection', onRejection);
      unsubscribe();
    };
  }, [enabled]);

  return null;
}
