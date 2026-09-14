import { Checkbox } from '@amplicada/platform-core/frontend/ui/checkbox';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Label } from '@amplicada/platform-core/frontend/ui/label';
import { RadioGroup, RadioGroupItem } from '@amplicada/platform-core/frontend/ui/radio-group';
import { Textarea } from '@amplicada/platform-core/frontend/ui/textarea';
import { Star } from 'lucide-react';
import type { PollQuestion } from '../../../../contracts/index.js';

interface GenericPollFormProps {
  questions: PollQuestion[];
  answers: Record<string, unknown>;
  onChange: (answers: Record<string, unknown>) => void;
  readonly?: boolean;
}

function RatingControl({ value, readonly, onSet }: { value: unknown; readonly?: boolean; onSet: (value: number) => void }) {
  const rating = typeof value === 'number' ? value : 0;
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={readonly}
          onClick={() => onSet(n)}
          className="disabled:cursor-default"
          aria-label={`${n} из 5`}
        >
          <Star className={n <= rating ? 'size-6 fill-amber-400 text-amber-400' : 'size-6 text-muted-foreground'} />
        </button>
      ))}
    </div>
  );
}

function NpsControl({ value, readonly, onSet }: { value: unknown; readonly?: boolean; onSet: (value: number) => void }) {
  const score = typeof value === 'number' ? value : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {Array.from({ length: 11 }, (_, n) => n).map(n => (
        <button
          key={n}
          type="button"
          disabled={readonly}
          onClick={() => onSet(n)}
          className={`flex size-8 items-center justify-center rounded-md border text-sm disabled:cursor-default ${
            score === n ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function QuestionControl({
  question,
  value,
  readonly,
  onSet,
}: {
  question: PollQuestion;
  value: unknown;
  readonly?: boolean;
  onSet: (value: unknown) => void;
}) {
  switch (question.type) {
    case 'textarea':
      return (
        <Textarea
          className="min-h-24"
          value={typeof value === 'string' ? value : ''}
          disabled={readonly}
          onChange={e => onSet(e.target.value)}
        />
      );
    case 'single-choice':
      return (
        <RadioGroup value={typeof value === 'string' ? value : ''} onValueChange={onSet} disabled={readonly}>
          {(question.options ?? []).map(option => (
            <label key={option.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <RadioGroupItem value={option.value} disabled={readonly} />
              {option.label}
            </label>
          ))}
        </RadioGroup>
      );
    case 'multi-choice': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (optionValue: string, checked: boolean) => {
        onSet(checked ? [...selected, optionValue] : selected.filter(v => v !== optionValue));
      };
      return (
        <div className="flex flex-col gap-2">
          {(question.options ?? []).map(option => (
            <label key={option.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={selected.includes(option.value)} disabled={readonly} onCheckedChange={c => toggle(option.value, !!c)} />
              {option.label}
            </label>
          ))}
        </div>
      );
    }
    case 'rating':
      return <RatingControl value={value} readonly={readonly} onSet={onSet} />;
    case 'nps':
      return <NpsControl value={value} readonly={readonly} onSet={onSet} />;
    default:
      return <Input value={typeof value === 'string' ? value : ''} disabled={readonly} onChange={e => onSet(e.target.value)} />;
  }
}

/** Generic-рендерер опроса из декларативного описания вопросов (аналог GenericRequestForm в module-hr-request). */
export function GenericPollForm({ questions, answers, onChange, readonly }: GenericPollFormProps) {
  if (!questions.length) {
    return <p className="text-sm text-muted-foreground">В этом опросе нет вопросов</p>;
  }
  return (
    <div className="flex flex-col gap-5">
      {questions.map(question => (
        <div key={question.key} className="flex flex-col gap-1.5">
          <Label>
            {question.label}
            {question.required && <span className="text-destructive"> *</span>}
          </Label>
          <QuestionControl
            question={question}
            value={answers[question.key]}
            readonly={readonly}
            onSet={v => onChange({ ...answers, [question.key]: v })}
          />
          {question.helpText && <span className="text-xs text-muted-foreground">{question.helpText}</span>}
        </div>
      ))}
    </div>
  );
}
