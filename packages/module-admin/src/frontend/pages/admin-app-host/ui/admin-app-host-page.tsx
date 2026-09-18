import { useFrontendContext, useTranslation } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { ArrowLeftIcon } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AdminAppsService } from '../../../../contracts/apps.js';
import { useAdminHeader } from '../../../lib/admin-header.js';

export function AdminAppHostPage() {
  const { t } = useTranslation('admin');
  const { services } = useFrontendContext();
  const { appId } = useParams();
  const navigate = useNavigate();

  const service = services.resolve<AdminAppsService>('admin:apps');
  const app = appId ? service.getById(appId) : undefined;
  const Icon = app?.icon;

  useAdminHeader(
    () => (
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label={t('admin_apps_back')} onClick={() => navigate('/admin/apps')}>
          <ArrowLeftIcon />
        </Button>
        {Icon ? <Icon className="size-5 text-muted-foreground" /> : null}
        <h1 className="truncate text-lg font-semibold">{app ? t(app.titleKey) : t('admin_apps_not_found')}</h1>
      </div>
    ),
    [app, Icon, t, navigate],
  );

  if (!app) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>{t('admin_apps_not_found')}</p>
      </div>
    );
  }

  const AppComponent = app.component;

  return (
    <div className="h-full min-h-0">
      <AppComponent />
    </div>
  );
}
