import { useTranslation } from '@amplicada/platform-core/frontend';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@amplicada/platform-core/frontend/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';

interface Member {
  userId: string;
  login: string;
}

interface MembersDisplayProps {
  data: Record<string, unknown>;
}

export function MembersDisplay({ data }: MembersDisplayProps) {
  const { t } = useTranslation('admin');
  const members = (data.members as Member[] | undefined) ?? [];

  if (members.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('admin_members_empty_title')}</EmptyTitle>
          <EmptyDescription>{t('admin_members_empty_description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('admin_members_col_login')}</TableHead>
          <TableHead>{t('admin_members_col_id')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map(m => (
          <TableRow key={m.userId}>
            <TableCell className="font-medium">{m.login}</TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">{m.userId}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
