export type ScheduleFrequency = 'never' | 'periodic' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';

export interface ScheduleConfig {
  frequency: ScheduleFrequency;
  intervalValue: number;
  intervalUnit: 'minutes' | 'hours';
  hour: number;
  minute: number;
  dayOfWeek: number;
  dayOfMonth: number;
  quarterMonthOffset: 0 | 1 | 2;
  month: number;
  rawCron: string;
}

/** t — TFunction из useTranslation('admin') вызывающего компонента; записи пересчитываются на каждый рендер, реагируя на смену языка. */
export function frequencyItems(t: (key: string) => string): Record<ScheduleFrequency, string> {
  return {
    never: t('admin_schedule_freq_never'),
    periodic: t('admin_schedule_freq_periodic'),
    daily: t('admin_schedule_freq_daily'),
    weekly: t('admin_schedule_freq_weekly'),
    monthly: t('admin_schedule_freq_monthly'),
    quarterly: t('admin_schedule_freq_quarterly'),
    yearly: t('admin_schedule_freq_yearly'),
    custom: t('admin_schedule_freq_custom'),
  };
}

export const FREQUENCY_ORDER: ScheduleFrequency[] = ['never', 'periodic', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'];

function numberItems(count: number, start: number, pad = 0): Record<string, string> {
  const items: Record<string, string> = {};
  for (let i = start; i < start + count; i++) {
    items[String(i)] = pad ? String(i).padStart(pad, '0') : String(i);
  }
  return items;
}

export const HOUR_ITEMS = numberItems(24, 0, 2);
export const MINUTE_ITEMS = numberItems(60, 0, 2);
export const DAY_OF_MONTH_ITEMS = numberItems(31, 1);
export const INTERVAL_MINUTE_ITEMS = numberItems(59, 1);
export const INTERVAL_HOUR_ITEMS = numberItems(23, 1);

export function dayOfWeekItems(t: (key: string) => string): Record<string, string> {
  return Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i), t(`admin_schedule_dow_${i}`)]));
}

export function monthItems(t: (key: string) => string): Record<string, string> {
  return Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), t(`admin_schedule_month_${i + 1}`)]));
}

export function quarterOffsetItems(t: (key: string) => string): Record<string, string> {
  return { '0': t('admin_schedule_quarter_0'), '1': t('admin_schedule_quarter_1'), '2': t('admin_schedule_quarter_2') };
}

const DEFAULT_CONFIG: ScheduleConfig = {
  frequency: 'never',
  intervalValue: 15,
  intervalUnit: 'minutes',
  hour: 3,
  minute: 0,
  dayOfWeek: 1,
  dayOfMonth: 1,
  quarterMonthOffset: 0,
  month: 1,
  rawCron: '',
};

const QUARTER_BASE_MONTHS = [1, 4, 7, 10];

function quarterMonths(offset: 0 | 1 | 2): number[] {
  return QUARTER_BASE_MONTHS.map(base => ((base - 1 + offset) % 12) + 1).sort((a, b) => a - b);
}

/** Разбирает cron-выражение в дружелюбный конфиг. Всё, что не укладывается в узнаваемые паттерны — 'custom' с сырым cron как есть. */
export function cronToScheduleConfig(cron: string | null): ScheduleConfig {
  if (!cron) return { ...DEFAULT_CONFIG, frequency: 'never' };

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { ...DEFAULT_CONFIG, frequency: 'custom', rawCron: cron };
  const [min, hr, dom, mon, dow] = parts;

  const periodicMinutes = min.match(/^\*\/(\d+)$/);
  if (periodicMinutes && hr === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { ...DEFAULT_CONFIG, frequency: 'periodic', intervalValue: Number(periodicMinutes[1]), intervalUnit: 'minutes' };
  }

  const periodicHours = hr.match(/^\*\/(\d+)$/);
  if (min === '0' && periodicHours && dom === '*' && mon === '*' && dow === '*') {
    return { ...DEFAULT_CONFIG, frequency: 'periodic', intervalValue: Number(periodicHours[1]), intervalUnit: 'hours' };
  }

  const isPlainMin = /^\d+$/.test(min);
  const isPlainHr = /^\d+$/.test(hr);
  if (!isPlainMin || !isPlainHr) return { ...DEFAULT_CONFIG, frequency: 'custom', rawCron: cron };
  const minute = Number(min);
  const hour = Number(hr);

  if (dom === '*' && mon === '*' && dow === '*') {
    return { ...DEFAULT_CONFIG, frequency: 'daily', hour, minute };
  }
  if (dom === '*' && mon === '*' && /^\d$/.test(dow)) {
    return { ...DEFAULT_CONFIG, frequency: 'weekly', hour, minute, dayOfWeek: Number(dow) };
  }
  if (/^\d+$/.test(dom) && mon === '*' && dow === '*') {
    return { ...DEFAULT_CONFIG, frequency: 'monthly', hour, minute, dayOfMonth: Number(dom) };
  }
  if (/^\d+$/.test(dom) && dow === '*' && /^\d+(,\d+){3}$/.test(mon)) {
    const months = mon
      .split(',')
      .map(Number)
      .sort((a, b) => a - b);
    const consistent = months.every((m, i) => i === 0 || m - months[i - 1] === 3);
    if (consistent) {
      const offset = ((months[0] - 1) % 3) as 0 | 1 | 2;
      return { ...DEFAULT_CONFIG, frequency: 'quarterly', hour, minute, dayOfMonth: Number(dom), quarterMonthOffset: offset };
    }
  }
  if (/^\d+$/.test(dom) && /^\d+$/.test(mon) && dow === '*') {
    return { ...DEFAULT_CONFIG, frequency: 'yearly', hour, minute, dayOfMonth: Number(dom), month: Number(mon) };
  }

  return { ...DEFAULT_CONFIG, frequency: 'custom', rawCron: cron };
}

/** Обратное преобразование — собирает cron из конфига. 'never' -> null (задача неактивна). */
export function scheduleConfigToCron(config: ScheduleConfig): string | null {
  switch (config.frequency) {
    case 'never':
      return null;
    case 'periodic':
      return config.intervalUnit === 'minutes' ? `*/${config.intervalValue} * * * *` : `0 */${config.intervalValue} * * *`;
    case 'daily':
      return `${config.minute} ${config.hour} * * *`;
    case 'weekly':
      return `${config.minute} ${config.hour} * * ${config.dayOfWeek}`;
    case 'monthly':
      return `${config.minute} ${config.hour} ${config.dayOfMonth} * *`;
    case 'quarterly':
      return `${config.minute} ${config.hour} ${config.dayOfMonth} ${quarterMonths(config.quarterMonthOffset).join(',')} *`;
    case 'yearly':
      return `${config.minute} ${config.hour} ${config.dayOfMonth} ${config.month} *`;
    case 'custom':
      return config.rawCron.trim() || null;
  }
}
