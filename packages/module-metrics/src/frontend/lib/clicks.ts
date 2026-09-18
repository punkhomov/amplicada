export interface MetricsAttrSource {
  name: string;
  value: string;
}

const PREFIX = 'data-metrics-';
const EVENT_NAME_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

/** Имя события из `data-metrics`: та же таксономия, что у остальных событий (минимум два сегмента). */
export function isValidMetricEventName(name: string | null | undefined): name is string {
  return typeof name === 'string' && EVENT_NAME_RE.test(name);
}

/** Собирает атрибуты `data-metrics-*` кликнутого элемента (кроме самого имени события). */
export function extractClickAttributes(attributes: readonly MetricsAttrSource[], maxLength = 256): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attribute of attributes) {
    if (!attribute.name.startsWith(PREFIX)) continue;
    const key = attribute.name.slice(PREFIX.length);
    if (key.length === 0 || key.length > 64) continue;
    result[key] = attribute.value.slice(0, maxLength);
  }
  return result;
}
