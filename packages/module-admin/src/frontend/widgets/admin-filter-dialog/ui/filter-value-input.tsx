import type { FilterCondition, ListFieldMeta } from '@amplicada/platform-core/contracts';
import { FILTER_MAX_IN_VALUES } from '@amplicada/platform-core/contracts';
import { useTranslation } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Checkbox } from '@amplicada/platform-core/frontend/ui/checkbox';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { X } from 'lucide-react';
import { useState } from 'react';
import { operatorIsMultiValue, operatorNeedsNoValue, valueInputType } from '../lib/draft.js';

interface FilterValueInputProps {
  condition: FilterCondition;
  meta: ListFieldMeta | undefined;
  onChange: (next: FilterCondition) => void;
}

/**
 * Мультизначный ввод для in/notIn. Сознательно собран из Select/Input/Button вместо Base UI
 * Combobox с чипами: free-entry-семантика комбобокса заметно тоньше, а выигрыш здесь — только
 * визуальный. Значения-чипы редактируются как список строк, ровно как их хранит FilterCondition.values.
 */
function MultiValueInput({
  values,
  options,
  inputType,
  onChange,
}: {
  values: string[];
  options: ListFieldMeta['options'];
  inputType: string;
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation('admin');
  const [pending, setPending] = useState('');

  const add = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || values.includes(trimmed) || values.length >= FILTER_MAX_IN_VALUES) return;
    onChange([...values, trimmed]);
  };

  const remove = (value: string) => onChange(values.filter(v => v !== value));

  const unusedOptions = options?.filter(opt => !values.includes(opt.value)) ?? [];

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map(value => (
            <span key={value} className="flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium">
              {options?.find(o => o.value === value)?.label ?? value}
              <Button variant="ghost" size="icon-xs" onClick={() => remove(value)} title={t('admin_filter_value_remove')}>
                <X className="size-3" />
              </Button>
            </span>
          ))}
        </div>
      )}
      {options ? (
        unusedOptions.length > 0 && (
          // value="" — Select здесь работает как «добавить ещё одно», а не как отображение выбранного.
          <Select value="" onValueChange={value => value && add(String(value))}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder={t('admin_filter_values_add')} />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {unusedOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      ) : (
        <Input
          type={inputType}
          value={pending}
          placeholder={t('admin_filter_values_placeholder')}
          className="w-44"
          onChange={e => setPending(e.target.value)}
          onKeyDown={e => {
            if (e.key !== 'Enter' && e.key !== ',') return;
            e.preventDefault();
            add(pending);
            setPending('');
          }}
          // Незакоммиченный текст не должен потеряться при уходе фокуса — иначе пользователь
          // напечатал значение, нажал «Применить» и молча отфильтровал без него.
          onBlur={() => {
            if (!pending.trim()) return;
            add(pending);
            setPending('');
          }}
        />
      )}
    </div>
  );
}

export function FilterValueInput({ condition, meta, onChange }: FilterValueInputProps) {
  if (operatorNeedsNoValue(condition.operator)) return null;

  const inputType = valueInputType(meta?.type);

  if (operatorIsMultiValue(condition.operator)) {
    return (
      <MultiValueInput
        values={condition.values ?? []}
        options={meta?.options}
        inputType={inputType}
        onChange={values => onChange({ ...condition, values })}
      />
    );
  }

  if (meta?.type === 'checkbox') {
    return (
      <Checkbox
        checked={condition.value === 'true'}
        onCheckedChange={checked => onChange({ ...condition, value: checked ? 'true' : 'false' })}
      />
    );
  }

  if (meta?.type === 'select' && meta.options?.length) {
    return (
      <Select value={condition.value ?? ''} onValueChange={value => onChange({ ...condition, value: String(value) })}>
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {meta.options.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <>
      <Input
        type={inputType}
        value={condition.value ?? ''}
        onChange={e => onChange({ ...condition, value: e.target.value })}
        className="w-36"
      />
      {condition.operator === 'between' && (
        <Input
          type={inputType}
          value={condition.value2 ?? ''}
          onChange={e => onChange({ ...condition, value2: e.target.value })}
          className="w-36"
        />
      )}
    </>
  );
}
