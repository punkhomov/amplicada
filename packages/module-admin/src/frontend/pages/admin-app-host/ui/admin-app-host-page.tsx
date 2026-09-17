import { useFrontendContext, useTranslation } from '@amplicada/platform-core/frontend';
import { useParams } from 'react-router-dom';
import type { AdminAppsService } from '../../../../contracts/apps.js';
import { AdminBreadcrumbs } from '../../../widgets/admin-breadcrumbs/index.js';

export function AdminAppHostPage() {
  const { t } = useTranslation('admin');
  const { services } = useFrontendContext();
  const { appId } = useParams();

  const service = services.resolve<AdminAppsService>('admin:apps');
  const app = appId ? service.getById(appId) : undefined;

  if (!app) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="w-full max-w-screen-2xl mx-auto flex flex-col px-8 py-4 gap-4">
          <AdminBreadcrumbs
            items={[
              { label: t('admin_breadcrumb_root'), to: '/admin' },
              { label: t('admin_tab_apps'), to: '/admin/apps' },
              { label: t('admin_apps_not_found') },
            ]}
          />
          <p className="text-muted-foreground">{t('admin_apps_not_found')}</p>
        </div>
      </div>
    );
  }

  const AppComponent = app.component;
  const Icon = app.icon;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 border-b bg-background">
        <div className="w-full max-w-screen-2xl mx-auto px-8 py-3 flex flex-col gap-2">
          <AdminBreadcrumbs
            items={[
              { label: t('admin_breadcrumb_root'), to: '/admin' },
              { label: t('admin_tab_apps'), to: '/admin/apps' },
              { label: t(app.titleKey) },
            ]}
          />
          <div className="flex items-center gap-2">
            {Icon && <Icon className="size-5 text-muted-foreground" />}
            <h1 className="text-xl font-bold">{t(app.titleKey)}</h1>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <AppComponent />
      </div>
    </div>
  );
}
