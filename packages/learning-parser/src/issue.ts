/**
 * Находки разбора: что с пакетом не так.
 *
 * Отчёт вместо исключения нужен не ради удобства, а потому что решение «принимать или нет»
 * принимает потребитель. Пока разбор бросал на первом изъяне, он это решение принимал за него:
 * метаданных нет, выбирать не из чего. Сказать «осиротевший ресурс меня не смущает, а отсутствующий
 * файл смущает» было негде.
 *
 * Лежит в корне пакета, а не в `validation/`, намеренно: находка — часть результата разбора, и её
 * заводят все слои, от чтения байтов до правил. Внутри `validation/` она означала бы, что от правил
 * зависит и `archive/`, и `xml/`.
 */

/**
 * Ровно два уровня. `error` — проиграть нельзя; `warning` — можно, но автор пакета что-то напутал.
 * Третий уровень («info») размыл бы первые два, а читать его всё равно никто не станет.
 */
export type Severity = 'error' | 'warning';

/**
 * Все коды находок, какие бывают. Перечень нужен по трём причинам сразу:
 *
 * - потребитель отключает правила по коду, и опечатка иначе выглядела бы как «правило не сработало»;
 * - `IssueCode` делает опечатку в самом разборщике ошибкой компиляции, а не молчаливо новым кодом;
 * - это готовая таблица для документации — коды и есть контракт, тексты справочные.
 *
 * Порядок алфавитный, сгруппирован семейством. Полнота проверяется тестом, который сверяет этот
 * список с тем, что реально встречается в исходниках.
 */
export const ISSUE_CODES = [
  'aicc.au-missing',
  'aicc.launch-url-missing',
  'aicc.objective-dangling',
  'aicc.objectives-unreadable',
  'aicc.prerequisite-relation-unknown',
  'aicc.prerequisites-unreadable',
  'cmi5.au-missing',
  'cmi5.course-missing',
  'cmi5.launch-url-missing',
  'cmi5.moveon-unknown',
  'common.duplicate-identifier',
  'common.encoding-guessed',
  'common.entry-missing',
  'common.external-launch',
  'common.external-metadata-missing',
  'common.file-missing',
  'common.launch-unresolvable',
  'common.no-launchable',
  'common.prerequisite-cycle',
  'common.prerequisite-unknown-item',
  'common.prerequisite-unparsable',
  'common.prerequisite-unsupported',
  'common.title-missing',
  'common.xml-malformed',
  'scorm.choice-exit-without-choice',
  'scorm.default-organization-invalid',
  'scorm.manifest-identifier-missing',
  'scorm.organizations-missing',
  'scorm.orphaned-resource',
  'scorm.prerequisites-type-unknown',
  'scorm.resource-href-missing',
  'scorm.resource-ref-dangling',
  'scorm.sequencing-ref-dangling',
  'scorm.sequencing-value-unknown',
  'xapi.activities-missing',
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

export interface ValidationIssue {
  /**
   * Уровень, который **предлагает** правило. Политика разбора (`ParseOptions.strictness`) может его
   * поднять или опустить: что считать основанием для отказа — вопрос потребителя, а не формата.
   */
  severity: Severity;
  /** Стабильный машинный код вида `scorm.orphaned-resource`. Потребитель решает по нему, не по тексту. */
  code: IssueCode;
  /** Текст для человека: его увидит тот, кто заливал пакет. */
  message: string;
  /** Где именно: `imsmanifest.xml#item:lesson_1`, `course.au#A1`. */
  location: string;
  /** Что сделать. Необязательно — осмысленный совет есть не всегда. */
  fix?: string;
}

export function issueError(code: IssueCode, message: string, location: string, fix?: string): ValidationIssue {
  return fix ? { severity: 'error', code, message, location, fix } : { severity: 'error', code, message, location };
}

export function issueWarning(code: IssueCode, message: string, location: string, fix?: string): ValidationIssue {
  return fix ? { severity: 'warning', code, message, location, fix } : { severity: 'warning', code, message, location };
}

export interface ValidationReport {
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Нет ошибок. Предупреждения на это не влияют — с ними пакет проигрывается. */
  ok: boolean;
}

export function buildReport(issues: readonly ValidationIssue[]): ValidationReport {
  const errors = issues.filter(issue => issue.severity === 'error');
  const warnings = issues.filter(issue => issue.severity === 'warning');
  return { issues: [...issues], errors, warnings, ok: errors.length === 0 };
}
