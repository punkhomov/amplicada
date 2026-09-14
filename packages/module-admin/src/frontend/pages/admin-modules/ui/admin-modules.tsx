import { type ApiClient, QueryError, useApiClient, useFrontendContext, useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Card, CardContent, CardHeader } from '@amplicada/platform-core/frontend/ui/card';
import { AdminBreadcrumbs } from '../../../widgets/admin-breadcrumbs/index.js';

interface ApiModule {
  id: string;
  name: string;
  version: string;
  dependencies?: string[];
}

interface FrontendModule {
  id: string;
  name: string;
  version: string;
}

interface MergedModule {
  id: string;
  name: string;
  version: string;
  hasBackend: boolean;
  hasFrontend: boolean;
  dependencies?: string[];
}

export function adminApiModulesQueryOptions(api: ApiClient) {
  return {
    queryKey: ['admin', 'modules'] as const,
    queryFn: () => api.get<ApiModule[]>('/admin/registry/modules'),
  };
}

export function AdminModules() {
  const { t } = useTranslation('admin');
  const api = useApiClient();
  const { modules } = useFrontendContext();
  const { data: apiModules = [], isLoading, isError, error: queryError, refetch } = useQuery(adminApiModulesQueryOptions(api));

  const webModules: FrontendModule[] = modules.getAll();

  const merged = new Map<string, MergedModule>();

  for (const mod of apiModules) {
    merged.set(mod.id, { ...mod, hasBackend: true, hasFrontend: false });
  }

  for (const mod of webModules) {
    const existing = merged.get(mod.id);
    if (existing) {
      existing.hasFrontend = true;
    } else {
      merged.set(mod.id, { ...mod, hasBackend: false, hasFrontend: true });
    }
  }

  const mergedModules = [...merged.values()];

  if (isError) return <QueryError error={queryError} onRetry={refetch} />;
  if (isLoading) return <div className="p-8 text-muted-foreground">{t('core:loading')}</div>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full max-w-screen-2xl mx-auto flex flex-col px-8 py-4 gap-4">
        <div className="shrink-0 flex flex-col gap-4">
          <AdminBreadcrumbs items={[{ label: t('admin_breadcrumb_root'), to: '/admin' }, { label: t('admin_modules_title') }]} />
        </div>

        <h1 className="text-2xl font-bold">{t('admin_modules_title')}</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {mergedModules.map(mod => (
            <Card key={mod.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{mod.name}</h2>
                  <div className="flex gap-1">
                    {mod.hasBackend && <Badge variant="secondary">Backend</Badge>}
                    {mod.hasFrontend && <Badge variant="secondary">Frontend</Badge>}
                    {!mod.hasBackend && !mod.hasFrontend && <Badge variant="outline">—</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-2">{mod.id}</p>
                <p className="text-sm text-muted-foreground">v{mod.version}</p>
                {mod.dependencies && mod.dependencies.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {mod.dependencies.map(dep => (
                      <Badge key={dep} variant="outline" className="text-xs">
                        {dep}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
