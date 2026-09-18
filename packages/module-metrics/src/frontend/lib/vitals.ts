import { type Metric, onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import type { ClientEventInput } from '../../contracts/index.js';

export interface VitalContext {
  route: string;
  sessionId: string;
}

export type VitalReporter = (event: ClientEventInput) => void;

let started = false;

/**
 * Core Web Vitals через `web-vitals`: каждая метрика шлётся с `delta`-обновлениями.
 * Запускается один раз на страницу — повторные подписки дали бы дубли событий.
 */
export function observeWebVitals(report: VitalReporter, context: () => VitalContext): void {
  if (started) return;
  started = true;

  const handle = (metric: Metric) => {
    const current = context();
    report({
      id: crypto.randomUUID(),
      name: `web_vital.${metric.name.toLowerCase()}`,
      kind: 'web_vital',
      occurredAt: new Date().toISOString(),
      sessionId: current.sessionId,
      context: { route: current.route, url: window.location.pathname },
      attributes: { rating: metric.rating, navigation_type: metric.navigationType },
      measures: { value: metric.value, delta: metric.delta },
    });
  };

  onCLS(handle);
  onFCP(handle);
  onINP(handle);
  onLCP(handle);
  onTTFB(handle);
}
