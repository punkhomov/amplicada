import { registerToolbarAction } from '@amplicada/module-admin/frontend';
import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { i18n } from '@amplicada/platform-core/frontend';
import { moduleManifest } from '../contracts/manifest.js';
import { PASSWORD_LOGIN_PATH } from '../contracts/paths.js';
import { ChangePasswordAction } from './features/change-password/index.js';
import { authLocales } from './locales/index.js';
import { LoginPage } from './pages/login/index.js';

export const authPasswordFrontendModule: FrontendModule = {
  ...moduleManifest,
  locales: { frontend: { ru: authLocales.ru, en: authLocales.en } },

  setup(context) {
    // Свой URL вне платформенного app-layout: платформа не рендерит логин, а лишь редиректит
    // неавторизованного пользователя на loginUrl метода, который публикует узел.
    context.routes.register(PASSWORD_LOGIN_PATH, <LoginPage />, { layout: 'public' });

    registerToolbarAction({
      id: 'change-password',
      label: i18n.t('auth-password:change_password_action'),
      documentType: 'user',
      component: ChangePasswordAction,
    });
  },
};
