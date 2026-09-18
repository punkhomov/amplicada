import { useFrontendContext, useTranslation } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { ArrowLeftIcon } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AdminAppsService } from '../../../../contracts/apps.js';

export function AdminAppHostPage() {
  const { t } = useTranslation('admin');
  const { services } = useFrontendContext();
  const { appId } = useParams();
  const navigate = useNavigate();

  const service = services.resolve<AdminAppsService>('admin:apps');
  const app = appId ? service.getById(appId) : undefined;

  const backButton = (
    <Button variant="ghost" size="icon-sm" aria-label={t('admin_apps_back')} onClick={() => navigate('/admin/apps')}>
      <ArrowLeftIcon />
    </Button>
  );

  if (!app) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="w-full max-w-screen-2xl mx-auto flex items-center gap-2 px-8 py-3">
          {backButton}
          <h1 className="text-xl font-bold">{t('admin_apps_not_found')}</h1>
        </div>
      </div>
    );
  }

  const AppComponent = app.component;
  const Icon = app.icon;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 border-b bg-background">
        <div className="w-full max-w-screen-2xl mx-auto px-8 py-3 flex items-center gap-3">
          {backButton}
          {Icon && <Icon className="size-5 text-muted-foreground" />}
          <h1 className="text-xl font-bold">{t(app.titleKey)}</h1>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <AppComponent />
      </div>
    </div>
  );
}
