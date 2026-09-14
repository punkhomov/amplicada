/**
 * Длительности из описателей приводятся к секундам.
 *
 * Записей две, и обе встречаются в одном и том же поле в зависимости от версии:
 *
 * - SCORM 1.2 (`adlcp:maxtimeallowed`) — часы-минуты-секунды через двоеточие, `02:30:00`,
 *   часов может быть до четырёх знаков;
 * - SCORM 2004 и cmi5 — ISO 8601, `PT2H30M`.
 *
 * Приводим здесь, а не в разборе, по той же причине, что и проходной балл: хранить вперемешку
 * `'02:30:00'` и `'PT2H30M'` значит переложить разбор на всех потребителей.
 */

/** `HHHH:MM:SS` и `HHHH:MM:SS.SS`. Минуты и секунды — до 59, иначе это не время, а опечатка. */
const CLOCK = /^(\d{1,4}):([0-5]?\d):([0-5]?\d(?:\.\d{1,2})?)$/;

/**
 * ISO 8601. `M` до `T` — месяцы, после `T` — минуты; перепутать их значит ошибиться в 43 000 раз,
 * поэтому регулярка разделяет части явно.
 */
const ISO = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function parseDurationSeconds(raw: string | null | undefined): number | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const clock = CLOCK.exec(text);
  if (clock) {
    return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  }

  const iso = ISO.exec(text);
  if (!iso) return null;

  const [, years, months, weeks, days, hours, minutes, seconds] = iso;
  // Годы и месяцы в секундах не выражаются без календаря: в месяце от 28 до 31 дня. Ограничение
  // времени на попытку, объявленное в годах, — это в любом случае ошибка автора пакета, и
  // придумывать за него «примерно 30 дней» хуже, чем честно ничего не вернуть.
  if (years || months) return null;
  if (!weeks && !days && !hours && !minutes && !seconds) return null;

  return (
    Number(weeks ?? 0) * 604_800 + Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)
  );
}
