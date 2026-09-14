import { DashboardTopics } from '@amplicada/platform-core/contracts';
import { type ApiClient, QueryError, useApiClient, useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import { Card, CardContent, CardHeader } from '@amplicada/platform-core/frontend/ui/card';
import { Box, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AdminDashboardItem, AdminDashboardResponse } from '../../../../contracts/index.js';
import { AdminBreadcrumbs } from '../../../widgets/admin-breadcrumbs/index.js';

export function adminDashboardQueryOptions(api: ApiClient) {
  return {
    queryKey: ['admin', 'documents'] as const,
    queryFn: () => api.get<AdminDashboardResponse>('/admin/registry/documents'),
  };
}

function byOrder<T extends { order?: number }>(a: T, b: T): number {
  return (a.order ?? 0) - (b.order ?? 0);
}

function TileGrid({ items }: { items: AdminDashboardItem[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map(item => (
        <Link key={`${item.kind}-${item.id}`} to={item.kind === 'link' ? item.path : `/admin/${item.id}`}>
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader>
              <h2 className="text-lg font-semibold">{item.label}</h2>
            </CardHeader>
            <CardContent>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {item.kind === 'link' ? <ExternalLink className="size-3.5 shrink-0" /> : <Box className="size-3.5 shrink-0" />}
                {item.kind === 'link' ? item.path : `${item.module}:${item.id}`}
              </p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export function AdminDashboard() {
  const { t } = useTranslation('admin');
  const api = useApiClient();
  const { data, isLoading, isError, error: queryError, refetch } = useQuery(adminDashboardQueryOptions(api));

  if (isError) return <QueryError error={queryError} onRetry={refetch} />;
  if (isLoading) return <div className="p-8 text-muted-foreground">{t('core:loading')}</div>;

  const { topics = [], sections = [], items = [] } = data ?? {};
  const topicIds = new Set(topics.map(topic => topic.id));
  const sortedTopics = [...topics].sort(byOrder);

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full max-w-screen-2xl mx-auto flex flex-col px-8 py-4 gap-8">
        <AdminBreadcrumbs items={[{ label: t('admin_breadcrumb_root') }]} />
        {sortedTopics.map(topic => {
          // Пункт с незарегистрированным topic (например модуль, регистрирующий "система", не подключён
          // в этой сборке) уходит в дефолтный топик "Документы", а не пропадает молча.
          const topicItems = items.filter(item => (topicIds.has(item.topic) ? item.topic : DashboardTopics.DOCUMENTS) === topic.id);
          if (!topicItems.length) return null;

          const topicSections = sections.filter(s => s.topic === topic.id).sort(byOrder);
          const ungrouped = topicItems.filter(item => !item.section || !topicSections.some(s => s.id === item.section));

          return (
            <section key={topic.id} className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">{topic.label}</h1>
              {ungrouped.length > 0 && <TileGrid items={ungrouped} />}
              {topicSections.map(section => {
                const sectionItems = topicItems.filter(item => item.section === section.id);
                if (!sectionItems.length) return null;
                return (
                  <div key={section.id} className="flex flex-col gap-2">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{section.label}</h2>
                    <TileGrid items={sectionItems} />
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
