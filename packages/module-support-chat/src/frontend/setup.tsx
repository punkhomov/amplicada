import type { AdminAppsService } from '@amplicada/module-admin/frontend';
import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { LifeBuoyIcon } from 'lucide-react';
import { moduleManifest } from '../contracts/manifest.js';
import { SupportChatWidget } from './features/support-chat-widget/index.js';
import { supportChatFrontendLocales } from './locales/index.js';
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
      order: 10,
      component: SupportChatAdminPage,
    });

    context.extensions.contribute('floating', { component: SupportChatWidget, order: 10 });
  },
};
