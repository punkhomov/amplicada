/**
 * Вид контента пакета — он же способ проигрывания. `file` — один файл (PDF/видео) с отметкой
 * «ознакомлен», без SCORM-рантайма.
 *
 * У архива значение до распаковки — **догадка**: при заливке известно только расширение, а версию
 * SCORM знает лишь манифест внутри. Распаковка проставляет настоящую. Доверять этому полю можно
 * только у пакета в статусе `ready`.
 */
export type PackageKind = 'scorm12' | 'scorm2004' | 'file';

/** SCORM-пакет проигрывается рантаймом в iframe; `file` — просто открывается. */
export function isScormKind(kind: PackageKind): boolean {
  return kind === 'scorm12' || kind === 'scorm2004';
}

/**
 * Жизненный цикл пакета. `processing` выставляет воркер, забирая пакет в работу —
 * без него два воркера взяли бы один и тот же (см. подплан 02).
 */
export type PackageStatus = 'pending' | 'processing' | 'ready' | 'failed';

/** Нормализованный прогресс. Сырой `cmi` остаётся рядом и является источником правды. */
export type AttemptCompletion = 'not_started' | 'in_progress' | 'completed';

/** Итог прохождения. `null` — курс не выставляет оценку (`completed` без `passed`/`failed`). */
export type AttemptSuccess = 'passed' | 'failed';

/** Откуда у человека взялся курс. */
export type EnrollmentSource = 'assigned' | 'self';

/** id-константы Document System. */
export const LearningDocuments = { COURSE: 'learning-course', ATTEMPT: 'learning-attempt' } as const;

/**
 * Замечание к принятому пакету.
 *
 * `skipped-file` — файл выброшен политикой приёма (расширение вне whitelist'а). `parser` —
 * предупреждение разбора: осиротевший ресурс, битая ссылка, угаданная кодировка.
 *
 * Не ошибка: пакет с замечаниями принят и работает. Ошибка означала бы отказ, и живёт она в `error`.
 */
export interface PackageNote {
  kind: 'skipped-file' | 'parser';
  message: string;
  /** Путь внутри пакета либо место находки, если разбор его знает. */
  location: string | null;
}

/**
 * Версия контента курса, как её видит клиент.
 *
 * `createdAt` строкой, а не `Date`: это форма после JSON, а не строка таблицы. Ключа объекта в
 * бакете здесь нет намеренно — внутренняя раскладка хранилища клиента не касается.
 */
export interface PackageSummary {
  id: string;
  courseId: string;
  version: number;
  kind: PackageKind;
  status: PackageStatus;
  /** Текст сбоя распаковки; `null` — сбоя не было. */
  error: string | null;
  /** Замечания к принятому пакету: что выброшено при распаковке и на что жаловался разбор. */
  notes: PackageNote[];
  /** Этот пакет открывается при старте курса. */
  isCurrent: boolean;
  entryPoint: string | null;
  /** Название из описателя пакета — справочное: курс называется тем, что в карточке. */
  title: string | null;
  scormVersion: string | null;
  totalFiles: number;
  totalSize: number;
  createdAt: string;
}

/**
 * Ответ на заливку. Не `PackageSummary`: на этот момент пакета ещё нет — есть принятый файл и
 * строка в очереди. Отсюда и `202` вместо `201`.
 */
export interface PackageAccepted {
  packageId: string;
  version: number;
  kind: PackageKind;
  status: PackageStatus;
}

/** Пакет досчитан — переспрашивать больше незачем. */
export function isPackageSettled(status: PackageStatus): boolean {
  return status === 'ready' || status === 'failed';
}

/** Ответ на запуск курса: всё, что нужно плееру, чтобы показать iframe. */
export interface CourseLaunch {
  attemptId: string;
  packageId: string;
  kind: PackageKind;
  /** Название курса из карточки — то, что видит учащийся в шапке плеера. */
  courseTitle: string;
  /**
   * Точка входа. Открывается в iframe как есть; относительные ссылки внутри пакета резолвятся
   * браузером относительно неё и префикс тащат сами.
   */
  contentUrl: string;
  progress: AttemptProgress;
}

/** Нормализованное состояние попытки — то, что плеер показывает в шапке. */
export interface AttemptProgress {
  attemptId: string;
  completion: AttemptCompletion;
  success: AttemptSuccess | null;
  score: number | null;
  totalTimeSeconds: number;
  updatedAt: string | null;
  completedAt: string | null;
}
