import { useTranslation } from '@amplicada/platform-core/frontend';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { METRICS_PERIODS, type MetricsPeriod } from '../../../lib/query-options.js';

export function MetricsPeriodSelect({ value, onChange }: { value: MetricsPeriod; onChange: (period: MetricsPeriod) => void }) {
  const { t } = useTranslation('metrics');
  return (
    <Select value={value} onValueChange={next => onChange(next as MetricsPeriod)}>
      <SelectTrigger className="w-32" aria-label={t('period_label')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {METRICS_PERIODS.map(period => (
          <SelectItem key={period} value={period}>
            {t(`period_${period}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
