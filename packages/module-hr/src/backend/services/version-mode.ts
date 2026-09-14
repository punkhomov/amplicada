/**
 * Чистая часть версионирования: выбор ветки записи и арифметика дат. Без импортов — чтобы
 * проверяться без БД и без загрузки backend-барреля platform-core.
 */

export function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export type VersionWriteMode = 'correction' | 'new-interval';

/**
 * Как записать изменение версии.
 *
 * - `correction` — правим текущую версию на месте: мы неверно записали факт, а не узнали новый.
 *   Так работает карточка документа (`effectiveDate === null`): она generic CRUD-форма без поля
 *   «действует с», то есть источником valid-time событий не является.
 * - `new-interval` — закрываем текущую версию днём раньше и вставляем новую.
 *
 * Дата, не превышающая начало текущей версии, — тоже коррекция: закрывать версию днём раньше её
 * собственного начала значит строить интервал `[today, today-1]`, запрещённый exclusion-констрейнтом.
 * Именно это и роняло правку документа в день его создания.
 *
 * См. ref/plans/2026-08-05-document-model/05-hr-versioning.md.
 */
export function versionWriteMode(currentValidFrom: string | undefined, effectiveDate: string | null): VersionWriteMode {
  if (currentValidFrom === undefined) return 'new-interval';
  if (effectiveDate === null) return 'correction';
  return effectiveDate <= currentValidFrom ? 'correction' : 'new-interval';
}

/**
 * `undefined` в частичном сохранении означает «поле не трогаем», а не «обнули». Нужен и версии
 * (иначе спред затёр бы перенесённое со старой версии значение), и строке узла (иначе UPDATE
 * попытался бы записать `undefined` в NOT NULL-колонку).
 */
export function definedOnly(values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}
