import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { Switch } from '@amplicada/platform-core/frontend/ui/switch';
import { Plus, Trash2 } from 'lucide-react';
import type { RequestFormField, RequestFormWidget } from '../../../../contracts/index.js';

const WIDGETS: { value: RequestFormWidget; label: string }[] = [
  { value: 'text', label: 'Текст' },
  { value: 'textarea', label: 'Многострочный текст' },
  { value: 'number', label: 'Число' },
  { value: 'checkbox', label: 'Чекбокс' },
  { value: 'date', label: 'Дата' },
  { value: 'select', label: 'Выбор из списка' },
];

/** Контракт кастомного компонента группы admin-document-card: { data, fields, readonly, onChange }. */
interface RequestTypeFieldsEditorProps {
  data: { formFields?: RequestFormField[] };
  readonly?: boolean;
  onChange: (data: { formFields: RequestFormField[] }) => void;
}

/**
 * Мини-редактор декларативных полей формы типа заявки. Ключ поля — то, что попадёт в payload
 * процесса: условия Gateway в графе ссылаются на него как payload.{ключ} (переименование ключа
 * не мигрирует условия — известное ограничение, см. план).
 */
export function RequestTypeFieldsEditor({ data, readonly, onChange }: RequestTypeFieldsEditorProps) {
  const rows = data.formFields ?? [];
  const apply = (next: RequestFormField[]) => onChange({ formFields: next });
  const update = (index: number, patch: Partial<RequestFormField>) => {
    apply(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="flex flex-col gap-3">
      {rows.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr_10rem_auto_auto] items-center gap-2 text-xs font-medium text-muted-foreground">
          <span>Ключ (payload)</span>
          <span>Название</span>
          <span>Виджет</span>
          <span>Обяз.</span>
          <span />
        </div>
      )}
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: у строк редактора нет стабильного id, ключ поля редактируется
        <div key={i} className="flex flex-col gap-1">
          <div className="grid grid-cols-[1fr_1fr_10rem_auto_auto] items-center gap-2">
            <Input
              className="h-8 font-mono text-xs"
              placeholder="cost"
              value={row.key}
              disabled={readonly}
              onChange={e => update(i, { key: e.target.value })}
            />
            <Input
              className="h-8 text-sm"
              placeholder="Стоимость, ₽"
              value={row.label}
              disabled={readonly}
              onChange={e => update(i, { label: e.target.value })}
            />
            <Select value={row.widget} onValueChange={v => update(i, { widget: (v ?? 'text') as RequestFormWidget })} disabled={readonly}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WIDGETS.map(w => (
                  <SelectItem key={w.value} value={w.value}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Switch checked={row.required ?? false} disabled={readonly} onCheckedChange={on => update(i, { required: on || undefined })} />
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              disabled={readonly}
              onClick={() => apply(rows.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          {row.widget === 'select' && (
            <Input
              className="h-8 text-xs"
              placeholder="Варианты через запятую (значение отображается как есть)"
              disabled={readonly}
              value={(row.options ?? []).map(o => o.label).join(', ')}
              onChange={e => {
                const options = e.target.value
                  .split(',')
                  .map(s => s.trim())
                  .filter(Boolean)
                  .map(label => ({ label, value: label }));
                update(i, { options: options.length ? options : undefined });
              }}
            />
          )}
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        disabled={readonly}
        onClick={() => apply([...rows, { key: '', label: '', widget: 'text' }])}
      >
        <Plus className="size-3.5" />
        Добавить поле
      </Button>
      <p className="text-xs text-muted-foreground">
        Ключи полей попадают в payload процесса — условия шлюзов в графе ссылаются на них как payload.&#123;ключ&#125;.
      </p>
    </div>
  );
}
