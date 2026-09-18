export interface MetricsAttrSource {
  name: string;
  value: string;
}

const PREFIX = 'data-metrics-';

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
