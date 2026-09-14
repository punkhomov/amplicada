import type { FilterCondition } from '@amplicada/platform-core/contracts';
import { useTranslation } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { X } from 'lucide-react';
import { type ColumnEntry, OPERATOR_LABEL_KEYS, operatorsFor } from '../lib/draft.js';
import { FilterValueInput } from './filter-value-input.js';

export interface FilterConditionRowProps {
  condition: FilterCondition;
  columns: ColumnEntry[];
  onChange: (next: FilterCondition) => void;
  onRemove: () => void;
}

export function FilterConditionRow({ condition, columns, onChange, onRemove }: FilterConditionRowProps) {
  const { t } = useTranslation('admin');
  const meta = columns.find(([key]) => key === condition.column)?.[1];
  const ops = operatorsFor(meta);

  const handleColumnChange = (column: string) => {
    const nextMeta = columns.find(([key]) => key === column)?.[1];
    // Смена колонки сбрасывает оператор и значения: старый оператор может быть недопустим для
    // нового типа, а значение — неприводимо (бэкенд ответил бы 400).
    onChange({ kind: 'condition', column, operator: operatorsFor(nextMeta)[0] ?? 'eq' });
  };

  const handleOperatorChange = (operator: string) => {
    onChange({
      kind: 'condition',
      column: condition.column,
      operator: operator as FilterCondition['operator'],
    });
  };

  return (
    <div className="flex items-start gap-2">
      <Select value={condition.column} onValueChange={value => handleColumnChange(String(value))}>
        <SelectTrigger className="w-40 shrink-0">
          <SelectValue placeholder={t('admin_filter_column_placeholder')} />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {columns.map(([key, colMeta]) => (
            <SelectItem key={key} value={key}>
              {colMeta.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={condition.operator} onValueChange={value => handleOperatorChange(String(value))}>
        <SelectTrigger className="w-44 shrink-0">
          <SelectValue placeholder={t('admin_filter_operator_placeholder')} />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {ops.map(op => (
            <SelectItem key={op} value={op}>
              {t(OPERATOR_LABEL_KEYS[op])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FilterValueInput condition={condition} meta={meta} onChange={onChange} />
      <Button variant="ghost" size="icon-sm" className="ml-auto shrink-0" onClick={onRemove} title={t('admin_filter_remove_condition')}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
