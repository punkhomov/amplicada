import type { FilterCombinator } from '@amplicada/platform-core/contracts';
import { useTranslation } from '@amplicada/platform-core/frontend';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';

/**
 * Левая колонка строки, как в Airtable: первая строка — статичное «Где», вторая — редактируемый
 * комбинатор группы, третья и далее — тот же комбинатор статичным текстом. Один комбинатор на
 * группу (а не «И/ИЛИ» между каждой парой) — иначе приоритет операций становится неоднозначным.
 */
export function FilterCombinatorCell({
  index,
  combinator,
  onChange,
}: {
  index: number;
  combinator: FilterCombinator;
  onChange: (next: FilterCombinator) => void;
}) {
  const { t } = useTranslation('admin');
  const label = combinator === 'or' ? t('admin_filter_combinator_or') : t('admin_filter_combinator_and');

  if (index === 0) {
    return <span className="w-20 shrink-0 pt-1.5 text-sm text-muted-foreground">{t('admin_filter_where')}</span>;
  }

  if (index === 1) {
    return (
      <Select value={combinator} onValueChange={value => value && onChange(String(value) as FilterCombinator)}>
        <SelectTrigger className="w-20 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value="and">{t('admin_filter_combinator_and')}</SelectItem>
          <SelectItem value="or">{t('admin_filter_combinator_or')}</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  return <span className="w-20 shrink-0 pt-1.5 text-sm text-muted-foreground">{label}</span>;
}
