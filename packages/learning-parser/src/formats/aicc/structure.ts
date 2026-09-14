import { parseCsv } from './csv.js';
import { prerequisiteExpressionOf } from './prerequisites.js';

/**
 * `.cst` — структура курса AICC.
 *
 * Формат непривычный: это не дерево, а список рёбер. Каждая строка — пара «блок, участник», где
 * участник это либо `system_id` единицы из `.au`, либо имя другого блока. Корневым считается блок
 * с именем `ROOT`; так его называет спецификация, и так его пишут все сборщики.
 *
 * Файл необязателен. Без него курс — плоский список единиц, и это законно: односекошные AICC-курсы
 * встречаются чаще составных.
 */

export const AICC_STRUCTURE_EXTENSION = '.cst';

const ROOT_BLOCK = 'root';

export interface AiccStructure {
  /** Имя блока (в нижнем регистре) → участники в порядке объявления. */
  members: Map<string, string[]>;
  /** Участники корня. Пусто — структура есть, но `ROOT` в ней не объявлен. */
  roots: string[];
  /**
   * Условие открытия участника (в нижнем регистре → выражение), если сборщик дописал в строку
   * колонку `prerequisite`. В спецификации её здесь нет — там под это отведён `.pre`.
   */
  prerequisites: Map<string, string>;
}

export function parseAiccStructure(text: string): AiccStructure {
  const members = new Map<string, string[]>();
  const prerequisites = new Map<string, string>();

  for (const row of parseCsv(text)) {
    const block = row.get('block')?.trim().toLowerCase();
    const member = row.get('member')?.trim();
    if (!block || !member) continue;

    const list = members.get(block);
    if (list) list.push(member);
    else members.set(block, [member]);

    // Условие относится к участнику: строка `.cst` — это ребро, и открывается по нему тот, к кому
    // ведёт, а не тот, из кого.
    const expression = prerequisiteExpressionOf(row);
    if (expression && !prerequisites.has(member.toLowerCase())) prerequisites.set(member.toLowerCase(), expression);
  }

  // Если `ROOT` не объявлен, корнями считаем блоки, которые сами никому не участники: так курс,
  // собранный без явного корня, всё равно разложится в дерево, а не в плоский список.
  const roots = members.get(ROOT_BLOCK) ?? orphanBlocks(members);
  return { members, roots, prerequisites };
}

function orphanBlocks(members: Map<string, string[]>): string[] {
  const claimed = new Set<string>();
  for (const list of members.values()) {
    for (const member of list) claimed.add(member.toLowerCase());
  }
  return [...members.keys()].filter(block => !claimed.has(block));
}
