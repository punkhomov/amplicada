import type { AdminAppsService } from '@amplicada/module-admin/frontend';
import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { ChartLineIcon } from 'lucide-react';
import { METRICS_PANELS_TOKEN } from '../contracts/index.js';
import { moduleManifest } from '../contracts/manifest.js';
import { MetricsTracker } from './features/metrics-tracker/index.js';
import { metricsPanelsService } from './lib/panel-registry.js';
import { metricsFrontendLocales } from './locales/index.js';
import { MetricsAdminPage } from './pages/metrics-admin/index.js';

export const metricsFrontendModule: FrontendModule = {
  ...moduleManifest,
  locales: { frontend: { ru: metricsFrontendLocales.ru, en: metricsFrontendLocales.en } },

  setup(context) {
    // Реестр панелей: модули объявляют свои графики, не завися от UI метрик.
    context.services.register(METRICS_PANELS_TOKEN, metricsPanelsService);

    const apps = context.services.resolve<AdminAppsService>('admin:apps');
    apps.register({
      id: 'metrics',
      titleKey: 'metrics:app_title',
      descriptionKey: 'metrics:app_description',
      icon: ChartLineIcon,
      iconClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
      order: 20,
      component: MetricsAdminPage,
    });

    // Трекер живёт на корневой точке `floating`: видит смену маршрута и не зависит от layout'ов.
    context.extensions.contribute('floating', { component: MetricsTracker, order: 90 });
  },
};
