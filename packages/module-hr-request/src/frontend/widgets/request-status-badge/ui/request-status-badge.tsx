import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import type { RequestStatus } from '../../../../contracts/index.js';

/** kind задаёт цвет, label приходит из ноды графа (см. contracts: отдельного справочника статусов нет). */
export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  switch (status.kind) {
    case 'draft':
      return <Badge variant="outline">{status.label}</Badge>;
    case 'in-progress':
      return <Badge variant="secondary">{status.label}</Badge>;
    case 'done-success':
      return (
        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-50">
          {status.label}
        </Badge>
      );
    case 'done-failure':
      return <Badge variant="destructive">{status.label}</Badge>;
    default:
      return <Badge>{status.label}</Badge>;
  }
}
