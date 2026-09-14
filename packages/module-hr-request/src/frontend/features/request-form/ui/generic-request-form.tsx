import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Label } from '@amplicada/platform-core/frontend/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { Switch } from '@amplicada/platform-core/frontend/ui/switch';
import { Textarea } from '@amplicada/platform-core/frontend/ui/textarea';
import type { RequestFormField } from '../../../../contracts/index.js';

interface GenericRequestFormProps {
  formFields: RequestFormField[];
  fields: Record<string, unknown>;
  onChange: (fields: Record<string, unknown>) => void;
  /** true — все поля редактируемы (черновик автора); массив — только перечисленные ключи (правка шага). */
  editableKeys: string[] | true;
}

function FieldControl({
  def,
  value,
  readonly,
  onSet,
}: {
  def: RequestFormField;
  value: unknown;
  readonly?: boolean;
  onSet: (value: unknown) => void;
}) {
  switch (def.widget) {
    case 'textarea':
      return (
        <Textarea
          className="min-h-24"
          placeholder={def.placeholder}
          value={typeof value === 'string' ? value : ''}
          disabled={readonly}
          onChange={e => onSet(e.target.value)}
        />
      );
    case 'number':
      return (
        <Input
          type="number"
          placeholder={def.placeholder}
          value={typeof value === 'number' ? value : ''}
          disabled={readonly}
          onChange={e => onSet(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'checkbox':
      return <Switch checked={value === true} disabled={readonly} onCheckedChange={onSet} />;
    case 'date':
      return <Input type="date" value={typeof value === 'string' ? value : ''} disabled={readonly} onChange={e => onSet(e.target.value)} />;
    case 'select':
      return (
        <Select value={typeof value === 'string' ? value : ''} onValueChange={v => onSet(v ?? undefined)} disabled={readonly}>
          <SelectTrigger>
            <SelectValue placeholder={def.placeholder ?? 'Выберите'} />
          </SelectTrigger>
          <SelectContent>
            {(def.options ?? []).map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    default:
      return (
        <Input
          placeholder={def.placeholder}
          value={typeof value === 'string' ? value : ''}
          disabled={readonly}
          onChange={e => onSet(e.target.value)}
        />
      );
  }
}

/** Generic-рендерер портальной формы из декларативного описания полей типа заявки. */
export function GenericRequestForm({ formFields, fields, onChange, editableKeys }: GenericRequestFormProps) {
  if (!formFields.length) {
    // Тип удалён/не настроен — показываем сырые данные, чтобы заявка оставалась читаемой
    return <pre className="text-xs">{JSON.stringify(fields, null, 2)}</pre>;
  }
  const isEditable = (key: string) => editableKeys === true || editableKeys.includes(key);
  return (
    <div className="flex flex-col gap-4">
      {formFields.map(def => (
        <div key={def.key} className="flex flex-col gap-1.5">
          <Label>
            {def.label}
            {def.required && <span className="text-destructive"> *</span>}
          </Label>
          <FieldControl
            def={def}
            value={fields[def.key]}
            readonly={!isEditable(def.key)}
            onSet={v => onChange({ ...fields, [def.key]: v })}
          />
          {def.helpText && <span className="text-xs text-muted-foreground">{def.helpText}</span>}
        </div>
      ))}
    </div>
  );
}
