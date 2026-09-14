import { ISSUE_CODES, type IssueCode, type Severity, type ValidationIssue } from './issue.js';

/**
 * Политика разбора: что потребитель считает основанием для отказа.
 *
 * До этого строгость была вшита в код каждого правила, и библиотека решала за потребителя. А ведь
 * в рамке записано обратное: библиотека сообщает, что нашла, решает потребитель. Каталог курсов,
 * инвентаризация чужого архива и приём пакета в проигрывание — три разных ответа на один и тот же
 * отчёт.
 *
 * Здесь только политика находок. Потолок на чтение файла живёт не тут, а в источнике
 * (`zipSource`/`directorySource`): читает он, и две точки настройки одного ограничения означали бы,
 * что одна из них не работает.
 */

/**
 * - `default` — уровни такие, какие предложило правило: ошибка только если пакет нечем запустить;
 * - `strict` — любая находка становится ошибкой. Для того, кто хочет отказывать на всём подозрительном;
 * - `lenient` — ошибок не бывает вовсе. Для разбора ради инвентаризации, когда проигрывать не нужно.
 */
export type Strictness = 'default' | 'strict' | 'lenient';

export interface ParseOptions {
  /** По умолчанию `default`. */
  strictness?: Strictness;
  /**
   * Коды, которые не заводить вовсе.
   *
   * Главный потребитель — проверка существования файлов: у образца она тоже выключена по умолчанию,
   * потому что пакеты, собираемые из общего депо при развёртывании, законно ссылаются на то, чего
   * в архиве нет. Наш корпус ADL CTS — ровно такой случай.
   */
  disableRules?: readonly IssueCode[];
}

/**
 * Применяет политику к находкам: убирает отключённые, переписывает уровни.
 *
 * Неизвестный код в `disableRules` — исключение, а не тишина. Опечатка в имени правила иначе
 * выглядит как «правило не сработало», и искать её будут в разборщике.
 */
export function applyPolicy(issues: readonly ValidationIssue[], options: ParseOptions = {}): ValidationIssue[] {
  const disabled = resolveDisabled(options.disableRules);
  const severity = severityFor(options.strictness ?? 'default');

  const kept: ValidationIssue[] = [];
  for (const issue of issues) {
    if (disabled.has(issue.code)) continue;
    const level = severity(issue.severity);
    kept.push(level === issue.severity ? issue : { ...issue, severity: level });
  }

  return kept;
}

function severityFor(strictness: Strictness): (proposed: Severity) => Severity {
  switch (strictness) {
    case 'strict':
      return () => 'error';
    case 'lenient':
      return () => 'warning';
    default:
      return proposed => proposed;
  }
}

function resolveDisabled(codes: readonly IssueCode[] | undefined): ReadonlySet<string> {
  if (!codes?.length) return EMPTY;

  const known = new Set<string>(ISSUE_CODES);
  const unknown = codes.filter(code => !known.has(code));
  if (unknown.length) {
    throw new Error(`Неизвестные коды правил в disableRules: ${unknown.join(', ')}`);
  }

  return new Set<string>(codes);
}

const EMPTY: ReadonlySet<string> = new Set();
