import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import type { JsonLogicRule } from '../../../../contracts/graph.js';

/**
 * v1: плоский список сравнений field/operator/value через AND (см. план 05).
 * Формат хранения — полноценный JSONLogic, так что условие, собранное не билдером
 * (вложенные or/группы), билдер не разберёт — тогда показывается read-only JSON.
 */

const OPERATORS = ['==', '!=', '>', '>=', '<', '<=', 'in'] as const;
type Operator = (typeof OPERATORS)[number];

export interface ConditionRow {
  field: string;
  operator: Operator;
  value: string;
}

function coerceValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return raw;
}

function valueToString(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function rowsToJsonLogic(rows: ConditionRow[]): JsonLogicRule | undefined {
  const clauses = rows
    .filter(row => row.field.trim() !== '')
    .map(row => ({ [row.operator]: [{ var: row.field.trim() }, coerceValue(row.value)] }));
  if (!clauses.length) return undefined;
  return clauses.length === 1 ? clauses[0] : { and: clauses };
}

/** null — условие не представимо плоским AND-списком (собрано вручную/будущим UI). */
export function jsonLogicToRows(rule: JsonLogicRule | undefined): ConditionRow[] | null {
  if (!rule) return [];
  const clauses = 'and' in rule && Array.isArray(rule.and) ? rule.and : [rule];
  const rows: ConditionRow[] = [];
  for (const clause of clauses) {
    if (clause === null || typeof clause !== 'object' || Array.isArray(clause)) return null;
    const entries = Object.entries(clause as Record<string, unknown>);
    if (entries.length !== 1) return null;
    const [operator, args] = entries[0];
    if (!OPERATORS.includes(operator as Operator) || !Array.isArray(args) || args.length !== 2) return null;
    const [left, right] = args;
    if (left === null || typeof left !== 'object' || typeof (left as Record<string, unknown>).var !== 'string') return null;
    rows.push({ field: (left as { var: string }).var, operator: operator as Operator, value: valueToString(right) });
  }
  return rows;
}

interface ConditionBuilderProps {
  rows: ConditionRow[];
  onChange: (rows: ConditionRow[]) => void;
}

export function ConditionBuilder({ rows, onChange }: ConditionBuilderProps) {
  const update = (index: number, patch: Partial<ConditionRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: строки условия не имеют стабильного id
        <div key={i} className="flex items-center gap-1">
          <Input
            className="h-8 flex-1 text-xs"
            placeholder="payload.amount"
            value={row.field}
            onChange={e => update(i, { field: e.target.value })}
          />
          <Select value={row.operator} onValueChange={v => update(i, { operator: v as Operator })}>
            <SelectTrigger className="h-8 w-16 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map(op => (
                <SelectItem key={op} value={op}>
                  {op}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="h-8 flex-1 text-xs"
            placeholder="значение"
            value={row.value}
            onChange={e => update(i, { value: e.target.value })}
          />
          <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() => onChange([...rows, { field: '', operator: '==', value: '' }])}
      >
        <Plus className="size-3.5" />
        Условие (AND)
      </Button>
    </div>
  );
}
