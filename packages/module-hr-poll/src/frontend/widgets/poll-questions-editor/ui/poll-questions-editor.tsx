import { Alert, AlertDescription } from '@amplicada/platform-core/frontend/ui/alert';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { Switch } from '@amplicada/platform-core/frontend/ui/switch';
import { Lock, Plus, Trash2 } from 'lucide-react';
import type { PollQuestion, PollQuestionType } from '../../../../contracts/index.js';

const QUESTION_TYPES: { value: PollQuestionType; label: string }[] = [
  { value: 'text', label: 'Текст' },
  { value: 'textarea', label: 'Многострочный текст' },
  { value: 'single-choice', label: 'Один вариант' },
  { value: 'multi-choice', label: 'Несколько вариантов' },
  { value: 'rating', label: 'Оценка (звёзды 1–5)' },
  { value: 'nps', label: 'Шкала 0–10 (NPS)' },
];

const CHOICE_TYPES: PollQuestionType[] = ['single-choice', 'multi-choice'];

/** Контракт кастомного компонента группы admin-document-card: { data, readonly, onChange }. */
interface PollQuestionsEditorProps {
  data: { questions?: PollQuestion[]; status?: string };
  readonly?: boolean;
  onChange: (data: { questions: PollQuestion[] }) => void;
}

/**
 * Мини-редактор декларативных вопросов опроса. Заблокирован (readonly), если опрос уже
 * опубликован — схема вопросов иммутабельна с момента публикации (см. план module-hr-poll):
 * правка возможна только созданием нового опроса.
 */
export function PollQuestionsEditor({ data, readonly, onChange }: PollQuestionsEditorProps) {
  const locked = readonly || data.status === 'published';
  const rows = data.questions ?? [];
  const apply = (next: PollQuestion[]) => onChange({ questions: next });
  const update = (index: number, patch: Partial<PollQuestion>) => {
    apply(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="flex flex-col gap-3">
      {data.status === 'published' && (
        <Alert>
          <Lock className="size-4" />
          <AlertDescription>Опрос опубликован — вопросы заморожены. Для новой схемы создайте новый опрос.</AlertDescription>
        </Alert>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr_11rem_auto_auto] items-center gap-2 text-xs font-medium text-muted-foreground">
          <span>Ключ (answers)</span>
          <span>Вопрос</span>
          <span>Тип</span>
          <span>Обяз.</span>
          <span />
        </div>
      )}
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: у строк редактора нет стабильного id, ключ вопроса редактируется
        <div key={i} className="flex flex-col gap-1">
          <div className="grid grid-cols-[1fr_1fr_11rem_auto_auto] items-center gap-2">
            <Input
              className="h-8 font-mono text-xs"
              placeholder="satisfaction"
              value={row.key}
              disabled={locked}
              onChange={e => update(i, { key: e.target.value })}
            />
            <Input
              className="h-8 text-sm"
              placeholder="Насколько вы довольны?"
              value={row.label}
              disabled={locked}
              onChange={e => update(i, { label: e.target.value })}
            />
            <Select value={row.type} onValueChange={v => update(i, { type: (v ?? 'text') as PollQuestionType })} disabled={locked}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUESTION_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Switch checked={row.required ?? false} disabled={locked} onCheckedChange={on => update(i, { required: on || undefined })} />
            <Button size="icon" variant="ghost" className="size-8" disabled={locked} onClick={() => apply(rows.filter((_, j) => j !== i))}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          {CHOICE_TYPES.includes(row.type) && (
            <Input
              className="h-8 text-xs"
              placeholder="Варианты через запятую (значение отображается как есть)"
              disabled={locked}
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
        disabled={locked}
        onClick={() => apply([...rows, { key: '', label: '', type: 'text' }])}
      >
        <Plus className="size-3.5" />
        Добавить вопрос
      </Button>
      <p className="text-xs text-muted-foreground">
        Ключи вопросов попадают в ответы как есть — переименование ключа не мигрирует уже собранные ответы.
      </p>
    </div>
  );
}
