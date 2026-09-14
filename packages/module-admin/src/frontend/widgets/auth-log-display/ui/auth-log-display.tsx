import { useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@amplicada/platform-core/frontend/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';

interface AuthLogEvent {
  id: string;
  action: string;
  success: boolean;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string | null;
}

interface AuthLogDisplayProps {
  data: Record<string, unknown>;
}

const ACTION_LABEL_KEYS: Record<string, string> = {
  login: 'admin_auth_log_action_login',
  logout: 'admin_auth_log_action_logout',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function AuthLogDisplay({ data }: AuthLogDisplayProps) {
  const { t } = useTranslation('admin');
  const events = (data.events as AuthLogEvent[] | undefined) ?? [];

  if (events.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('admin_auth_log_empty_title')}</EmptyTitle>
          <EmptyDescription>{t('admin_auth_log_empty_description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('admin_auth_log_col_date')}</TableHead>
          <TableHead>{t('admin_auth_log_col_action')}</TableHead>
          <TableHead>{t('admin_auth_log_col_status')}</TableHead>
          <TableHead>{t('admin_auth_log_col_reason')}</TableHead>
          <TableHead>{t('admin_auth_log_col_ip')}</TableHead>
          <TableHead>{t('admin_auth_log_col_user_agent')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map(event => (
          <TableRow key={event.id}>
            <TableCell className="whitespace-nowrap">{formatDate(event.createdAt)}</TableCell>
            <TableCell>{ACTION_LABEL_KEYS[event.action] ? t(ACTION_LABEL_KEYS[event.action]) : event.action}</TableCell>
            <TableCell>
              <Badge variant={event.success ? 'secondary' : 'destructive'}>
                {event.success ? t('admin_auth_log_success') : t('admin_auth_log_failure')}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{event.reason ?? '—'}</TableCell>
            <TableCell className="font-mono text-xs">{event.ipAddress ?? '—'}</TableCell>
            <TableCell className="text-muted-foreground max-w-xs truncate" title={event.userAgent ?? undefined}>
              {event.userAgent ?? '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
