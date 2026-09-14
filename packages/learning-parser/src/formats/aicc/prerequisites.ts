import { issueWarning, type ValidationIssue } from '../../issue.js';
import { type Prerequisite, parsePrerequisites } from '../../model/prerequisite.js';
import { parseCsv } from './csv.js';

/**
 * Пререквизиты AICC.
 *
 * Язык тот же, что у SCORM 1.2 (тот его отсюда и заимствовал), а вот живёт он в трёх местах:
 * отдельный файл `.pre`, колонка в `.au` и колонка в строке `.cst`. Спецификация отводит под них
 * `.pre`, но сборщики пишут кто куда, поэтому читаются все три.
 *
 * Сам разбор выражений общий — в `model/prerequisite.ts`.
 */

export const AICC_PREREQUISITES_EXTENSION = '.pre';

/** Спецификация называет колонку `prerequisite`; форма множественного числа встречается не реже. */
const EXPRESSION_COLUMNS = ['prerequisite', 'prerequisites'];

/**
 * Чей это пререквизит. `structure_element` — по спецификации, остальное пишут сборщики; `member`
 * и `block` появляются, когда таблицу собрали из `.cst`.
 */
const ELEMENT_COLUMNS = ['structure_element', 'system_id', 'element', 'block', 'member'];

/**
 * Запись рёбрами: строка на связь вместо строки на элемент. Спецификацией не предусмотрена, но
 * встречается, и образец её читает.
 *
 * Направление — зависимый слева, требуемое справа — установлено по трём независимым свидетельствам:
 * колонка `type` со значением `requires` в одном из настоящих файлов; смысл курса, где вводный урок
 * идёт первым, а итоговый требует обоих предыдущих; и эвристика образца, дающая тот же результат.
 * Перечень имён точный, а не по подстроке как у образца: ошибка в направлении запирает главу вместо
 * того, чтобы её открыть, и расширять список наугад тут нельзя.
 */
const DEPENDENT_COLUMNS = ['source', 'from', 'pre_from', 'pre_source', 'pre_member', 'preid', 'pre_id'];
const REQUIRED_COLUMNS = ['target', 'to', 'post_to', 'post_member', 'postid', 'post_id', 'target_member'];

/** Чем ребро объявлено. Всё, кроме этого, означает связь другого рода, и читать её как «требует» нельзя. */
const RELATION_COLUMNS = ['type', 'relation', 'relationship'];
const REQUIRES = 'requires';

/** Выражение из строки CSV — годится и для `.au`, и для `.cst`. */
export function prerequisiteExpressionOf(row: Map<string, string>): string | null {
  for (const column of EXPRESSION_COLUMNS) {
    const value = row.get(column);
    if (value) return value;
  }
  return null;
}

/**
 * `.pre` — условия открытия элементов структуры, в одной из двух форм.
 *
 * Возвращается карта «идентификатор в нижнем регистре → условие»: `system_id` в AICC
 * регистронезависим, и сопоставлять по точному написанию значило бы терять условия у пакетов, где
 * `.au` и `.pre` собирали разные инструменты.
 *
 * Если не распознана ни одна форма, заводится находка, а не догадка.
 */
export function parseAiccPrerequisiteFile(text: string | null, issues: ValidationIssue[], where: string): Map<string, Prerequisite> {
  const conditions = new Map<string, Prerequisite>();
  if (!text) return conditions;

  const rows = parseCsv(text);
  if (!rows.length) return conditions;

  readExpressions(rows, conditions, issues, where);
  const edges = readEdges(rows, conditions, issues, where);

  if (!conditions.size && !edges) {
    issues.push(
      issueWarning(
        'aicc.prerequisites-unreadable',
        `В файле пререквизитов не распознаны колонки: ни условие (${EXPRESSION_COLUMNS.join(', ')}), ни связь (${DEPENDENT_COLUMNS[0]}/${REQUIRED_COLUMNS[0]})`,
        where,
        'Условия не прочитаны — все пункты курса считаются открытыми',
      ),
    );
  }

  return conditions;
}

/** Форма по спецификации: строка на элемент, условие выражением. */
function readExpressions(
  rows: readonly Map<string, string>[],
  conditions: Map<string, Prerequisite>,
  issues: ValidationIssue[],
  where: string,
): void {
  for (const row of rows) {
    const element = firstValue(row, ELEMENT_COLUMNS);
    const expression = prerequisiteExpressionOf(row);
    if (!element || !expression) continue;

    const key = element.toLowerCase();
    // Первое объявление выигрывает — как и везде, где AICC допускает повтор ключа.
    if (conditions.has(key)) continue;

    const parsed = parsePrerequisites(expression, issues, `${where}#${element}`);
    if (parsed) conditions.set(key, parsed);
  }
}

/**
 * Форма рёбрами. Несколько строк на один зависимый элемент складываются по И: элемент открывается,
 * когда пройдено **всё**, на что он ссылается.
 *
 * @returns были ли распознаны колонки связи — чтобы отличить «форма не та» от «форма та, но пустая».
 */
function readEdges(
  rows: readonly Map<string, string>[],
  conditions: Map<string, Prerequisite>,
  issues: ValidationIssue[],
  where: string,
): boolean {
  const dependentColumn = columnOf(rows[0], DEPENDENT_COLUMNS);
  const requiredColumn = columnOf(rows[0], REQUIRED_COLUMNS);
  if (!dependentColumn || !requiredColumn) return false;

  const required = new Map<string, string[]>();

  for (const row of rows) {
    const dependent = row.get(dependentColumn);
    const prerequisite = row.get(requiredColumn);
    if (!dependent || !prerequisite) continue;

    const relation = firstValue(row, RELATION_COLUMNS);
    if (relation && relation.toLowerCase() !== REQUIRES) {
      // Связь объявлена, но другая. Что она означает — неизвестно, а прочитать «исключает» как
      // «требует» хуже, чем не прочитать вовсе.
      issues.push(
        issueWarning(
          'aicc.prerequisite-relation-unknown',
          `Связь "${relation}" между "${dependent}" и "${prerequisite}" не распознана — известно только "${REQUIRES}"`,
          `${where}#${dependent}`,
          'Условие не прочитано — пункт считается открытым',
        ),
      );
      continue;
    }

    const key = dependent.toLowerCase();
    // Условие из формы по спецификации важнее: она объявлена в стандарте, эта — нет.
    if (conditions.has(key)) continue;

    const list = required.get(key) ?? [];
    if (!list.includes(prerequisite)) list.push(prerequisite);
    required.set(key, list);
  }

  for (const [key, identifiers] of required) {
    const operands = identifiers.map<Prerequisite>(identifier => ({ kind: 'item', identifier }));
    conditions.set(key, operands.length === 1 ? operands[0] : { kind: 'and', operands });
  }

  return true;
}

/** Имя колонки, которая есть в строке. Нужно отдельно от значения: пустая колонка — тоже колонка. */
function columnOf(row: Map<string, string>, columns: readonly string[]): string | null {
  return columns.find(column => row.has(column)) ?? null;
}

function firstValue(row: Map<string, string>, columns: readonly string[]): string | null {
  for (const column of columns) {
    const value = row.get(column);
    if (value) return value;
  }
  return null;
}
