import { useFrontendContext, useTranslation } from '@amplicada/platform-core/frontend';
import { Card, CardDescription, CardHeader, CardTitle } from '@amplicada/platform-core/frontend/ui/card';
import { Link } from 'react-router-dom';
import type { AdminAppsService } from '../../../../contracts/apps.js';
import { AdminBreadcrumbs } from '../../../widgets/admin-breadcrumbs/index.js';

export function AdminAppsPage() {
  const { t } = useTranslation('admin');
  const { services } = useFrontendContext();
  const apps = services.resolve<AdminAppsService>('admin:apps').getAll();

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full max-w-screen-2xl mx-auto flex flex-col px-8 py-4 gap-4">
        <AdminBreadcrumbs items={[{ label: t('admin_breadcrumb_root'), to: '/admin' }, { label: t('admin_tab_apps') }]} />

        <h1 className="text-2xl font-bold">{t('admin_tab_apps')}</h1>

        {apps.length === 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground">{t('admin_apps_empty')}</p>
            <p className="text-sm text-muted-foreground">{t('admin_apps_empty_hint')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {apps.map(app => {
              const Icon = app.icon;
              return (
                <Link
                  key={app.id}
                  to={`/admin/apps/${app.id}`}
                  className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Card className="h-full transition-colors hover:bg-muted/50">
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        {Icon && <Icon className="size-5 text-muted-foreground" />}
                        <CardTitle>{t(app.titleKey)}</CardTitle>
                      </div>
                      {app.descriptionKey && <CardDescription>{t(app.descriptionKey)}</CardDescription>}
                    </CardHeader>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
