import type { ScormEdition } from '../../model/details.js';

/**
 * Редакция SCORM 2004 из текста `<schemaversion>`.
 *
 * Пишут её как угодно: `2004 3rd Edition`, `2004 3rd edition`, `CAM 1.3`, изредка просто `2004`.
 * Смотреть вместо этого на неймспейс нельзя — `adlcp_v1p3` стоит и у 3-й, и у 4-й редакции, а
 * `imsss_v1p0` вообще у всех трёх.
 *
 * Первая редакция 2004 отозвана ADL и в живых пакетах не встречается; `1st` в тип не заводим, чтобы
 * потребитель не писал ветку под то, чего нет.
 */
const EDITIONS: readonly (readonly [RegExp, ScormEdition])[] = [
  [/\b2nd\b|\bsecond\b/i, '2nd'],
  [/\b3rd\b|\bthird\b/i, '3rd'],
  [/\b4th\b|\bfourth\b/i, '4th'],
];

export function detectEdition(schemaVersion: string | null): ScormEdition | null {
  if (!schemaVersion) return null;
  return EDITIONS.find(([pattern]) => pattern.test(schemaVersion))?.[1] ?? null;
}
