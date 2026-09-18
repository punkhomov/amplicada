import type { AdminAppsService } from '@amplicada/module-admin/frontend';
import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { API_CLIENT_TOKEN, type ApiClient, i18n } from '@amplicada/platform-core/frontend';
import { LifeBuoyIcon } from 'lucide-react';
import { moduleManifest } from '../contracts/manifest.js';
import { SupportChatWidget } from './features/support-chat-widget/index.js';
import { supportChatMyThreadQueryOptions, supportChatMyThreadsQueryOptions } from './lib/query-options.js';
import { supportChatFrontendLocales } from './locales/index.js';
import { MyThreadPage } from './pages/my-thread/index.js';
import { MyThreadsPage } from './pages/my-threads/index.js';
import { SupportChatAdminPage } from './pages/support-chat-admin/index.js';

export const supportChatFrontendModule: FrontendModule = {
  ...moduleManifest,
  locales: { frontend: { ru: supportChatFrontendLocales.ru, en: supportChatFrontendLocales.en } },

  setup(context) {
    const apps = context.services.resolve<AdminAppsService>('admin:apps');
    apps.register({
      id: 'support-chat',
      titleKey: 'support-chat:app_title',
      descriptionKey: 'support-chat:app_description',
      icon: LifeBuoyIcon,
      iconClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
      order: 10,
      component: SupportChatAdminPage,
    });

    context.extensions.contribute('floating', { component: SupportChatWidget, order: 10 });

    // Портал: список «Мои обращения» и страница обращения; виджет рядом продолжает активное
    // (свежее) обращение. Метка навигации — статичная строка, поэтому переводится на старте.
    const api = context.services.resolve<ApiClient>(API_CLIENT_TOKEN);

    context.routes.register('/support', <MyThreadsPage />, {
      layout: 'app',
      loader: async () => {
        await context.queryClient.ensureQueryData(supportChatMyThreadsQueryOptions(api));
        return null;
      },
    });
    context.routes.register('/support/new', <MyThreadPage />, { layout: 'app' });
    context.routes.register('/support/:id', <MyThreadPage />, {
      layout: 'app',
      loader: async ({ params }) => {
        if (params.id) await context.queryClient.ensureQueryData(supportChatMyThreadQueryOptions(api, params.id));
        return null;
      },
    });

    context.navigation.register({
      id: 'support-chat-my',
      label: i18n.t('support-chat:portal_title'),
      path: '/support',
      icon: LifeBuoyIcon,
      order: 10,
    });
  },
};
