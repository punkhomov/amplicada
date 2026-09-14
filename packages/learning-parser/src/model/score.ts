/**
 * Проходной балл приводится к доле 0..1.
 *
 * Шкалы у форматов разные: cmi5 объявляет `masteryScore` уже долей, SCORM 1.2 (`adlcp:masteryscore`)
 * и AICC (`Mastery_Score`) — процентами, SCORM 2004 (`minNormalizedMeasure`) — снова долей.
 * Хранить их вперемешку означало бы сравнивать 80 с 0.8.
 */
export function normalizeMastery(raw: unknown, scale: 'fraction' | 'percent'): number | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;

  const fraction = scale === 'percent' ? parsed / 100 : parsed;
  // Значение вне шкалы — ошибка автора пакета, а не наша: игнорируем, но не роняем разбор.
  return fraction >= 0 && fraction <= 1 ? fraction : null;
}
