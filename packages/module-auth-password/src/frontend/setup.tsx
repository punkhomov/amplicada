import { registerToolbarAction } from '@amplicada/module-admin/frontend';
import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { i18n } from '@amplicada/platform-core/frontend';
import { moduleManifest } from '../contracts/manifest.js';
import { ChangePasswordAction } from './features/change-password/index.js';
import { authLocales } from './locales/index.js';
import { LoginPage } from './pages/login/index.js';

export const authPasswordFrontendModule: FrontendModule = {
  ...moduleManifest,
  locales: { frontend: { ru: authLocales.ru, en: authLocales.en } },

  setup(context) {
    context.routes.register('/login', <LoginPage />, { layout: 'public' });
    context.slots.register('auth:login-page', LoginPage);

    registerToolbarAction({
      id: 'change-password',
      label: i18n.t('auth-password:change_password_action'),
      documentType: 'user',
      component: ChangePasswordAction,
    });
  },
};
