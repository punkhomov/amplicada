import { useTranslation } from '@amplicada/platform-core/frontend';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { useMemo } from 'react';
import {
  cronToScheduleConfig,
  DAY_OF_MONTH_ITEMS,
  dayOfWeekItems,
  frequencyItems,
  HOUR_ITEMS,
  INTERVAL_HOUR_ITEMS,
  INTERVAL_MINUTE_ITEMS,
  MINUTE_ITEMS,
  monthItems,
  quarterOffsetItems,
  type ScheduleConfig,
  scheduleConfigToCron,
} from '../../../lib/cron-schedule.js';

interface ScheduleBuilderProps {
  value: string | null;
  onChange: (cron: string | null) => void;
  disabled?: boolean;
}

interface PickerSelectProps {
  value: string;
  onChange: (value: string) => void;
  items: Record<string, string>;
  disabled?: boolean;
  className?: string;
}

function PickerSelect({ value, onChange, items, disabled, className }: PickerSelectProps) {
  return (
    <Select items={items} value={value} disabled={disabled} onValueChange={v => v != null && onChange(v)}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ScheduleBuilder({ value, onChange, disabled }: ScheduleBuilderProps) {
  const { t } = useTranslation('admin');
  // config всегда выводится из value, а не хранится в стейте: cron<->config — стабильный round-trip,
  // а value может прийти позже монтирования (данные документа подгружаются асинхронно) — стейт бы
  // тогда навсегда застрял на конфиге по умолчанию ("никогда").
  const config = useMemo(() => cronToScheduleConfig(value), [value]);

  const update = (patch: Partial<ScheduleConfig>) => {
    onChange(scheduleConfigToCron({ ...config, ...patch }));
  };

  const timePicker = (
    <div className="flex items-center gap-1.5">
      <PickerSelect
        value={String(config.hour)}
        items={HOUR_ITEMS}
        disabled={disabled}
        onChange={v => update({ hour: Number(v) })}
        className="w-20"
      />
      <span className="text-sm text-muted-foreground">:</span>
      <PickerSelect
        value={String(config.minute)}
        items={MINUTE_ITEMS}
        disabled={disabled}
        onChange={v => update({ minute: Number(v) })}
        className="w-20"
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <PickerSelect
        value={config.frequency}
        items={frequencyItems(t)}
        disabled={disabled}
        onChange={v => update({ frequency: v as ScheduleConfig['frequency'] })}
        className="w-56"
      />

      {config.frequency === 'periodic' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('admin_schedule_every')}</span>
          <PickerSelect
            value={String(config.intervalValue)}
            items={config.intervalUnit === 'minutes' ? INTERVAL_MINUTE_ITEMS : INTERVAL_HOUR_ITEMS}
            disabled={disabled}
            onChange={v => update({ intervalValue: Number(v) })}
            className="w-20"
          />
          <PickerSelect
            value={config.intervalUnit}
            items={{ minutes: t('admin_schedule_minutes'), hours: t('admin_schedule_hours') }}
            disabled={disabled}
            onChange={v => update({ intervalUnit: v as ScheduleConfig['intervalUnit'] })}
            className="w-28"
          />
        </div>
      )}

      {config.frequency === 'daily' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('admin_schedule_at_capitalized')}</span>
          {timePicker}
        </div>
      )}

      {config.frequency === 'weekly' && (
        <div className="flex items-center gap-2">
          <PickerSelect
            value={String(config.dayOfWeek)}
            items={dayOfWeekItems(t)}
            disabled={disabled}
            onChange={v => update({ dayOfWeek: Number(v) })}
            className="w-40"
          />
          <span className="text-sm text-muted-foreground">{t('admin_schedule_at')}</span>
          {timePicker}
        </div>
      )}

      {(config.frequency === 'monthly' || config.frequency === 'quarterly') && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">{t('admin_schedule_day_numbers')}</span>
          <PickerSelect
            value={String(config.dayOfMonth)}
            items={DAY_OF_MONTH_ITEMS}
            disabled={disabled}
            onChange={v => update({ dayOfMonth: Number(v) })}
            className="w-20"
          />
          {config.frequency === 'quarterly' && (
            <PickerSelect
              value={String(config.quarterMonthOffset)}
              items={quarterOffsetItems(t)}
              disabled={disabled}
              onChange={v => update({ quarterMonthOffset: Number(v) as 0 | 1 | 2 })}
              className="w-48"
            />
          )}
          <span className="text-sm text-muted-foreground">{t('admin_schedule_at')}</span>
          {timePicker}
        </div>
      )}

      {config.frequency === 'yearly' && (
        <div className="flex items-center gap-2 flex-wrap">
          <PickerSelect
            value={String(config.month)}
            items={monthItems(t)}
            disabled={disabled}
            onChange={v => update({ month: Number(v) })}
            className="w-36"
          />
          <PickerSelect
            value={String(config.dayOfMonth)}
            items={DAY_OF_MONTH_ITEMS}
            disabled={disabled}
            onChange={v => update({ dayOfMonth: Number(v) })}
            className="w-20"
          />
          <span className="text-sm text-muted-foreground">{t('admin_schedule_at')}</span>
          {timePicker}
        </div>
      )}

      {config.frequency === 'custom' && (
        <Input
          value={config.rawCron}
          disabled={disabled}
          placeholder="* * * * *"
          onChange={e => update({ rawCron: e.target.value })}
          className="w-56 font-mono"
        />
      )}

      {config.frequency !== 'never' && <p className="text-xs text-muted-foreground font-mono">{scheduleConfigToCron(config) ?? '—'}</p>}
    </div>
  );
}
