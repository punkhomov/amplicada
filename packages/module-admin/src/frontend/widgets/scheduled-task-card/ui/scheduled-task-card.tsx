import type { FieldMetadata } from '@amplicada/platform-core/contracts';
import { useTranslation } from '@amplicada/platform-core/frontend';
import { Alert, AlertDescription, AlertTitle } from '@amplicada/platform-core/frontend/ui/alert';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet } from '@amplicada/platform-core/frontend/ui/field';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Switch } from '@amplicada/platform-core/frontend/ui/switch';
import { Textarea } from '@amplicada/platform-core/frontend/ui/textarea';
import { AlertTriangle } from 'lucide-react';
import { ScheduleBuilder } from '../../schedule-builder/index.js';

interface ScheduledTaskData {
  id?: string;
  description?: string;
  timeout?: number;
  alertOnFailure?: boolean;
  schedule?: string | null;
  active?: boolean;
  stale?: boolean;
}

interface ScheduledTaskCardProps {
  data: ScheduledTaskData;
  fields: Record<string, FieldMetadata>;
  readonly?: boolean;
  onChange: (data: ScheduledTaskData) => void;
}

export function ScheduledTaskCard({ data, fields, readonly, onChange }: ScheduledTaskCardProps) {
  const { t } = useTranslation('admin');
  const update = (patch: Partial<ScheduledTaskData>) => onChange({ ...data, ...patch });

  return (
    <div className="flex flex-col gap-6">
      {data.stale && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50">
          <AlertTriangle />
          <AlertTitle>{fields.stale?.label ?? t('admin_task_field_stale')}</AlertTitle>
          <AlertDescription>{t('admin_task_field_stale_description')}</AlertDescription>
        </Alert>
      )}

      <FieldGroup>
        <FieldSet>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="task-id">{fields.id?.label ?? t('admin_task_field_id')}</FieldLabel>
              <Input id="task-id" value={data.id ?? ''} readOnly className="font-mono" />
            </Field>
            <Field orientation="horizontal">
              <Switch id="task-active" checked={!!data.active} disabled={readonly} onCheckedChange={active => update({ active })} />
              <FieldLabel htmlFor="task-active" className="font-normal">
                {fields.active?.label ?? t('admin_task_field_active')}
              </FieldLabel>
            </Field>
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="task-description">{fields.description?.label ?? t('admin_task_field_description')}</FieldLabel>
              <Textarea id="task-description" readOnly value={data.description ?? ''} className="resize-none" />
            </Field>
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="task-timeout">{fields.timeout?.label ?? t('admin_task_field_timeout')}</FieldLabel>
              <Input
                id="task-timeout"
                type="number"
                min={0}
                step={1}
                value={data.timeout ?? 0}
                disabled={readonly}
                onChange={e => update({ timeout: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
              />
              <FieldDescription>{fields.timeout?.helpText ?? t('admin_task_field_timeout_help')}</FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="task-alert"
                checked={!!data.alertOnFailure}
                disabled={readonly}
                onCheckedChange={alertOnFailure => update({ alertOnFailure })}
              />
              <FieldLabel htmlFor="task-alert" className="font-normal">
                {fields.alertOnFailure?.label ?? t('admin_task_field_alert')}
              </FieldLabel>
            </Field>
          </FieldGroup>
        </FieldSet>

        <ScheduleBuilder value={data.schedule ?? null} disabled={readonly} onChange={schedule => update({ schedule })} />
      </FieldGroup>
    </div>
  );
}
