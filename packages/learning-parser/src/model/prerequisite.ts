import { type IssueCode, issueWarning, type ValidationIssue } from '../issue.js';

/**
 * Условие открытия пункта: «не пускать в главу 3, пока не пройдена 2».
 *
 * Язык один на два формата: SCORM 1.2 заимствовал его у AICC вместе с названием
 * (`type="aicc_script"`), поэтому разбор живёт в модели, а не в каталоге формата. Формату остаётся
 * достать строку оттуда, где он её хранит, — а хранит он её в четырёх разных местах.
 *
 * Дерево, а не замыкание: выражение надо уметь показать («чтобы открыть, пройдите: Введение и
 * Практика»), а не только вычислить. Замыкание умеет второе и не умеет первое.
 */
export type Prerequisite =
  | { kind: 'item'; identifier: string }
  | { kind: 'not'; operand: Prerequisite }
  | { kind: 'and'; operands: Prerequisite[] }
  | { kind: 'or'; operands: Prerequisite[] };

/**
 * Разбор выражения. Рекурсивный спуск по грамматике:
 *
 * ```
 * expression → term ('|' term)*
 * term       → factor ('&' factor)*
 * factor     → '~'? atom
 * atom       → IDENTIFIER | '(' expression ')'
 * IDENTIFIER → [A-Za-z0-9_.-]+
 * ```
 *
 * Приоритеты по убыванию: `~` (не), `&` (и), `|` (или) — то есть `a&b|c` это `(a&b)|c`.
 *
 * **Непонятое условие даёт `null`, то есть «ограничений нет».** Обратный выбор — считать условие
 * невыполненным — запер бы учащегося в главе, которую никак не открыть, и без объяснения причины.
 * Непонятое выражение это наш пробел, а не изъян пакета, и расплачиваться за него учащийся не
 * должен. Поэтому же тишины здесь нет: каждый отказ становится находкой.
 *
 * @param where — место для находки; при вызове снаружи разбора не нужно.
 */
export function parsePrerequisites(source: string | null | undefined, issues: ValidationIssue[] = [], where = ''): Prerequisite | null {
  const text = source?.trim() ?? '';
  // Пустое поле — это отсутствие условия, а не изъян: его пишут все сборщики подряд.
  if (!text) return null;

  const scanner: Scanner = { text, at: 0, failure: null };
  const expression = parseOr(scanner);
  skipSpaces(scanner);

  // Разбор дошёл до конца выражения, а строка не кончилась: `a b`, `a)`, `A AND B` — словесные
  // операторы в языке не объявлены, и молча прочитать из них одно первое условие нельзя.
  if (!scanner.failure && scanner.at < text.length) {
    const rest = text.slice(scanner.at);
    // `a*b` останавливает разбор там же, где `a b`, но причина другая, и путать их не надо.
    if (UNSUPPORTED_CHAR.test(rest[0])) fail(scanner, UNSUPPORTED, `"${rest[0]}"`);
    else fail(scanner, UNPARSABLE, `лишнее после выражения: "${rest}"`);
  }

  if (scanner.failure) {
    issues.push(describe(scanner.failure, text, where));
    return null;
  }
  return expression;
}

/**
 * Вычисление по множеству пройденных пунктов.
 *
 * Чистая функция без состояния попытки — и вызывает её потребитель, а не библиотека. Что считать
 * пройденным (`completed`? `passed`? одно или другое?), решает рантайм: в SCORM это разные поля
 * модели данных, и выбор между ними меняет поведение курса.
 *
 * Сравнение точное. Приводить регистр здесь нельзя: в SCORM идентификаторы `xs:ID`, то есть
 * регистрозависимы, а как их сопоставляет AICC — дело того, кто собирает множество.
 */
export function evaluatePrerequisites(expression: Prerequisite, completed: ReadonlySet<string>): boolean {
  switch (expression.kind) {
    case 'item':
      return completed.has(expression.identifier);
    case 'not':
      return !evaluatePrerequisites(expression.operand, completed);
    case 'and':
      return expression.operands.every(operand => evaluatePrerequisites(operand, completed));
    case 'or':
      return expression.operands.some(operand => evaluatePrerequisites(operand, completed));
  }
}

/** Пункты, на которые ссылается выражение, без повторов и в порядке появления. */
export function prerequisiteIdentifiers(expression: Prerequisite): string[] {
  const found = new Set<string>();
  collectIdentifiers(expression, found);
  return [...found];
}

const UNPARSABLE = 'common.prerequisite-unparsable';
const UNSUPPORTED = 'common.prerequisite-unsupported';

/** AICC допускает в идентификаторе точку и дефис — это не операторы, а часть имени пункта. */
const IDENTIFIER_CHAR = /[A-Za-z0-9_.-]/;

/**
 * Конструкции полного AICC-скрипта, до которых мы не дошли: `*` (множество), `{n}` («любые n из»),
 * `,` (перечисление внутри множества). Отличать их от мусора стоит: это наш пробел, а не ошибка
 * автора пакета, и чинить его нам.
 */
const UNSUPPORTED_CHAR = /[*{},]/;

interface Failure {
  code: IssueCode;
  detail: string;
}

interface Scanner {
  readonly text: string;
  at: number;
  /** Первая причина отказа. После неё разбирать нечего: дерево уже вышло бы неполным. */
  failure: Failure | null;
}

function parseOr(scanner: Scanner): Prerequisite | null {
  const operands = [parseAnd(scanner)];
  while (!scanner.failure && match(scanner, '|')) operands.push(parseAnd(scanner));
  return combine('or', operands, scanner);
}

function parseAnd(scanner: Scanner): Prerequisite | null {
  const operands = [parseNot(scanner)];
  while (!scanner.failure && match(scanner, '&')) operands.push(parseNot(scanner));
  return combine('and', operands, scanner);
}

function parseNot(scanner: Scanner): Prerequisite | null {
  // `~` связывает только следующий атом: `~a&b` это `(~a)&b`. Рекурсия, а не единичное чтение,
  // потому что `~~a` формально законно.
  if (!match(scanner, '~')) return parseAtom(scanner);
  const operand = parseNot(scanner);
  return operand ? { kind: 'not', operand } : null;
}

function parseAtom(scanner: Scanner): Prerequisite | null {
  skipSpaces(scanner);
  if (scanner.at >= scanner.text.length) return fail(scanner, UNPARSABLE, 'выражение обрывается');

  const char = scanner.text[scanner.at];
  if (UNSUPPORTED_CHAR.test(char)) return fail(scanner, UNSUPPORTED, `"${char}"`);

  if (match(scanner, '(')) {
    const inner = parseOr(scanner);
    if (!inner) return null;
    if (!match(scanner, ')')) return fail(scanner, UNPARSABLE, 'не закрыта скобка');
    return inner;
  }

  return parseIdentifier(scanner);
}

function parseIdentifier(scanner: Scanner): Prerequisite | null {
  const start = scanner.at;
  while (scanner.at < scanner.text.length && IDENTIFIER_CHAR.test(scanner.text[scanner.at])) scanner.at++;
  if (scanner.at === start) return fail(scanner, UNPARSABLE, `ожидался идентификатор пункта, а не "${scanner.text[scanner.at]}"`);
  return { kind: 'item', identifier: scanner.text.slice(start, scanner.at) };
}

/**
 * Один операнд не заворачивается: `and` из одного элемента — лишний узел, который потребителю
 * пришлось бы разворачивать и при показе, и при сравнении.
 */
function combine(kind: 'and' | 'or', operands: readonly (Prerequisite | null)[], scanner: Scanner): Prerequisite | null {
  if (scanner.failure) return null;
  const parsed = operands.filter((operand): operand is Prerequisite => operand !== null);
  if (parsed.length !== operands.length) return null;
  return parsed.length === 1 ? parsed[0] : { kind, operands: parsed };
}

/** Пробелы внутри выражения в живых пакетах ставят как попало — значения они не несут нигде. */
function skipSpaces(scanner: Scanner): void {
  while (scanner.at < scanner.text.length && /\s/.test(scanner.text[scanner.at])) scanner.at++;
}

function match(scanner: Scanner, char: string): boolean {
  skipSpaces(scanner);
  if (scanner.text[scanner.at] !== char) return false;
  scanner.at++;
  return true;
}

function fail(scanner: Scanner, code: IssueCode, detail: string): null {
  scanner.failure ??= { code, detail };
  return null;
}

function describe(failure: Failure, text: string, where: string): ValidationIssue {
  if (failure.code === UNSUPPORTED) {
    return issueWarning(
      failure.code,
      `Условие открытия "${text}" написано на полном AICC-скрипте: конструкция ${failure.detail} не разбирается`,
      where,
      'Условие не применяется — пункт открыт. Если такие пакеты пойдут, разбор конструкции надо дописать',
    );
  }
  return issueWarning(
    failure.code,
    `Условие открытия "${text}" не разобрано: ${failure.detail}`,
    where,
    'Допустимы идентификаторы пунктов, "&" (и), "|" (или), "~" (не) и скобки',
  );
}

function collectIdentifiers(expression: Prerequisite, found: Set<string>): void {
  switch (expression.kind) {
    case 'item':
      found.add(expression.identifier);
      return;
    case 'not':
      collectIdentifiers(expression.operand, found);
      return;
    default:
      for (const operand of expression.operands) collectIdentifiers(operand, found);
  }
}
