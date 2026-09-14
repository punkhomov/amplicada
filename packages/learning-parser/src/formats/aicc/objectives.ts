import { issueWarning, type ValidationIssue } from '../../issue.js';
import type { AiccObjective } from '../../model/details.js';
import { parseCsv } from './csv.js';

/**
 * `.ort` — связи целей с единицами (objectives relationships).
 *
 * Строка описывает одну связь: цель, единица и вид связи (`read` — цель влияет на единицу,
 * `write` — единица её закрывает). Файл необязателен: курс без общих целей встречается чаще.
 *
 * `.cmp` (требования завершения) рядом не разбирается — см. `06-metadata-depth`: его раскладка
 * колонок ничем проверяемым не закреплена, а придумать её значило бы положить в модель правила
 * зачёта, которых автор не писал.
 */

export const AICC_OBJECTIVES_EXTENSION = '.ort';

const OBJECTIVE_COLUMNS = ['objective_id', 'objective', 'obj_id'];
const UNIT_COLUMNS = ['au_system_id', 'system_id', 'au_id', 'au', 'member'];

export interface AiccObjectiveRelations {
  objectives: AiccObjective[];
  /** Цели каждой единицы, ключ — `system_id` в нижнем регистре. */
  byUnit: Map<string, string[]>;
}

/**
 * @param units — известные единицы (в нижнем регистре) для проверки ссылок. Цель, привязанная к
 *   несуществующей единице, остаётся в перечне: она объявлена автором, и молча её терять хуже, чем
 *   показать вместе с находкой.
 */
export function parseAiccObjectives(
  text: string | null,
  units: ReadonlySet<string>,
  issues: ValidationIssue[],
  where: string,
): AiccObjectiveRelations {
  const objectives = new Map<string, AiccObjective>();
  const byUnit = new Map<string, string[]>();
  if (!text) return { objectives: [], byUnit };

  const rows = parseCsv(text);
  let recognized = 0;

  for (const row of rows) {
    const id = pick(row, OBJECTIVE_COLUMNS);
    const unitId = pick(row, UNIT_COLUMNS);
    if (!id || !unitId) continue;
    recognized++;

    const objective = objectives.get(id) ?? { id, members: [] };
    objective.members.push({ unitId, relation: pick(row, ['relation', 'type']) });
    objectives.set(id, objective);

    const key = unitId.toLowerCase();
    if (!units.has(key)) {
      issues.push(
        issueWarning('aicc.objective-dangling', `Цель "${id}" связана с единицей "${unitId}", которой нет в .au`, `${where}#${unitId}`),
      );
      continue;
    }

    const list = byUnit.get(key);
    if (list) {
      if (!list.includes(id)) list.push(id);
    } else byUnit.set(key, [id]);
  }

  if (rows.length && !recognized) {
    issues.push(
      issueWarning(
        'aicc.objectives-unreadable',
        `В файле целей нет колонок, по которым видно цель и единицу (${OBJECTIVE_COLUMNS[0]}, ${UNIT_COLUMNS[0]})`,
        where,
        'Связи целей не прочитаны — на разбор остального пакета это не влияет',
      ),
    );
  }

  return { objectives: [...objectives.values()], byUnit };
}

function pick(row: Map<string, string>, columns: readonly string[]): string | null {
  for (const column of columns) {
    const value = row.get(column);
    if (value) return value;
  }
  return null;
}
