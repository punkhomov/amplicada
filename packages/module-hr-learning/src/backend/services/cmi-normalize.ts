import type { AttemptCompletion, AttemptSuccess, PackageKind } from '../../contracts/index.js';

/**
 * Приведение сырого `cmi` от курса к полям, по которым строятся списки и отчёты.
 *
 * Сырое состояние остаётся в `attempts.cmi` нетронутым — оно источник правды, а всё ниже
 * производное. Важно: по спецификации SCORM эти значения клиент-авторитетны, курс волен прислать
 * что угодно. Проверенной оценкой они не являются (см. 05).
 *
 * Две модели данных, а не одна с синонимами: в 1.2 статус один (`cmi.core.lesson_status`, где
 * `passed` означает сразу и «завершено», и «сдано»), а в 2004 их два независимых
 * (`completion_status` и `success_status`), и курс законно бывает `completed` + `failed`.
 * Свести их в одну таблицу — значит потерять «прошёл до конца и не сдал».
 */

/**
 * Курс может присылать `cmi` как вложенный объект (`{ core: { lesson_status } }`), так и плоской
 * картой с точками в ключах (`{ 'cmi.core.lesson_status': ... }`) — реализации рантаймов
 * расходятся. Читаем оба вида, чтобы не зависеть от того, чем собран пакет.
 */
export function readCmiPath(cmi: Record<string, unknown>, path: string): unknown {
  const flat = cmi[path] ?? cmi[`cmi.${path}`];
  if (flat !== undefined) return flat;

  let node: unknown = cmi;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function text(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

/** SCORM 1.2, `cmi.core.lesson_status`. Незнакомое значение трактуем как «не начато». */
export function normalizeLessonStatus(raw: unknown): { completion: AttemptCompletion; success: AttemptSuccess | null } {
  switch (text(raw)) {
    case 'passed':
      return { completion: 'completed', success: 'passed' };
    case 'failed':
      // Провал — тоже завершение: попытка закончена, просто с отрицательным результатом.
      return { completion: 'completed', success: 'failed' };
    case 'completed':
      return { completion: 'completed', success: null };
    case 'incomplete':
    case 'browsed':
      return { completion: 'in_progress', success: null };
    default:
      return { completion: 'not_started', success: null };
  }
}

/**
 * SCORM 2004: `cmi.completion_status` и `cmi.success_status` независимы.
 *
 * `unknown` — законное значение спецификации, означающее «курс не берётся судить», и это не то же
 * самое, что «не начинал»: попытка с `unknown` и непустым `suspend_data` идёт полным ходом. Поэтому
 * `unknown` при наличии любого признака работы читается как `in_progress`.
 */
export function normalizeScorm2004Status(
  completionRaw: unknown,
  successRaw: unknown,
  started: boolean,
): { completion: AttemptCompletion; success: AttemptSuccess | null } {
  const success = text(successRaw) === 'passed' ? 'passed' : text(successRaw) === 'failed' ? 'failed' : null;

  switch (text(completionRaw)) {
    case 'completed':
      return { completion: 'completed', success };
    case 'incomplete':
      return { completion: 'in_progress', success };
    case 'not attempted':
      return { completion: 'not_started', success };
    default:
      // `unknown` и пустое. Сдан/провален без объявленного completion — тоже завершение:
      // курс вынес вердикт, а значит дошёл до конца.
      if (success) return { completion: 'completed', success };
      return { completion: started ? 'in_progress' : 'not_started', success: null };
  }
}

/**
 * CMITimespan из SCORM 1.2: `HHHH:MM:SS.SS`, часов может быть от 2 до 4 знаков.
 * `null` — распарсить не удалось; ронять из-за этого коммит нельзя, курс просто прислал мусор.
 */
export function parseScormTimespan(raw: unknown): number | null {
  const value = String(raw ?? '').trim();
  const match = /^(\d{2,4}):([0-5]\d):([0-5]\d)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const [, hh, mm, ss, frac] = match;
  const fraction = frac ? Number(`0.${frac}`) : 0;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + fraction;
}

/**
 * SCORM 2004 меряет время длительностью ISO 8601: `PT1H30M5S`, `P1DT2H`, `PT0S`.
 *
 * Год и месяц в секунды не переводим — их длина непостоянна, и курс, который пишет в session_time
 * месяцы, скорее сломан, чем прав. Такое значение отвергается целиком (`null`), а не считается
 * приблизительно: заниженное на месяц время хуже отсутствующего, потому что выглядит правдой.
 */
export function parseIso8601Duration(raw: unknown): number | null {
  const value = String(raw ?? '').trim();
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  // `P` и `PT` регулярка пропускает, но длительности они не задают — это не ноль, а отсутствие.
  if (days === undefined && hours === undefined && minutes === undefined && seconds === undefined) return null;
  return Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
}

/**
 * Обратный перевод: накопленное время в тот вид, в каком его ждёт рантайм при засеве.
 *
 * Нужен потому, что накопление делает рантайм, а не мы: он получает прошлый итог, прибавляет к нему
 * сессию и присылает новый. Без засева каждый заход считал бы время с нуля.
 */
export function formatDuration(kind: PackageKind, seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  if (kind === 'scorm2004') {
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    return `PT${hours}H${minutes}M${whole % 60}S`;
  }
  // SCORM 1.2: HHHH:MM:SS, часов минимум два знака и не больше четырёх — курс на 10000 часов
  // невозможен, но переполнение отдало бы пятизначное поле, которое рантайм отвергнет целиком.
  const hours = Math.min(9999, Math.floor(whole / 3600));
  const minutes = Math.floor((whole % 3600) / 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(whole % 60)}`;
}

/**
 * Балл. Шкалу не проверяем: SCORM не обязывает её быть 0–100, а курсы этим пользуются.
 */
export function parseScore(raw: unknown): number | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface NormalizedCmi {
  completion: AttemptCompletion;
  success: AttemptSuccess | null;
  score: number | null;
  /**
   * Накопленное время попытки, секунды. Именно накопленное, а не текущей сессии.
   *
   * По спецификации `total_time` считает LMS: контент выставляет `session_time` (длительность
   * сессии целиком, не дельту), а итог пересчитывается как «итог на начало сессии + session_time».
   * Складывать `session_time` с текущим итогом на каждом автокоммите нельзя — итог задвоится.
   *
   * Складываем не мы: рантайм в iframe получает при запуске уже накопленный `total_time`, сам
   * прибавляет к нему сессию (`alwaysSendTotalTime`) и присылает готовый итог. Поэтому здесь просто
   * чтение, а колонка «итог на начало сессии», заложенная в плане `05`, не понадобилась.
   */
  totalTimeSeconds: number | null;
}

export function normalizeCmi(cmi: Record<string, unknown>, kind: PackageKind): NormalizedCmi {
  if (kind === 'scorm2004') {
    const { completion, success } = normalizeScorm2004Status(
      readCmiPath(cmi, 'completion_status'),
      readCmiPath(cmi, 'success_status'),
      hasProgressSigns(cmi),
    );
    return {
      completion,
      success,
      score: scoreOf(readCmiPath(cmi, 'score.raw'), readCmiPath(cmi, 'score.scaled')),
      totalTimeSeconds: parseIso8601Duration(readCmiPath(cmi, 'total_time')),
    };
  }

  const { completion, success } = normalizeLessonStatus(readCmiPath(cmi, 'core.lesson_status'));
  return {
    completion,
    success,
    score: parseScore(readCmiPath(cmi, 'core.score.raw')),
    totalTimeSeconds: parseScormTimespan(readCmiPath(cmi, 'core.total_time')),
  };
}

/**
 * `score.raw` главнее, но пакеты 2004 сплошь и рядом выставляют только `score.scaled` (доля −1..1) —
 * и тогда колонка балла оставалась бы пустой у курса, который балл выставил.
 *
 * Перевод в проценты явный и осознанно приблизительный: `scaled` относителен собственной шкалы SCO,
 * процент — то, как это всё равно прочитает человек. Отрицательные `scaled` спецификация допускает,
 * и они уезжают как есть, а не обрезаются в ноль.
 */
function scoreOf(raw: unknown, scaled: unknown): number | null {
  const direct = parseScore(raw);
  if (direct !== null) return direct;

  const fraction = parseScore(scaled);
  return fraction === null ? null : Math.round(fraction * 10000) / 100;
}

/**
 * Есть ли в `cmi` следы работы. Нужно только чтобы отличить `unknown` «ещё не открывал» от
 * `unknown` «идёт полным ходом» — сам курс об этом не сообщает.
 */
function hasProgressSigns(cmi: Record<string, unknown>): boolean {
  for (const path of ['location', 'suspend_data', 'progress_measure', 'score.raw', 'score.scaled']) {
    const value = readCmiPath(cmi, path);
    if (value !== undefined && value !== null && String(value) !== '') return true;
  }
  return false;
}
