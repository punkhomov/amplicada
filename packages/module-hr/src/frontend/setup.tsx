import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { frontendManifest } from '../contracts/manifest.js';
import { hrLocales } from './locales/index.js';

export const hrFrontendModule: FrontendModule = {
  ...frontendManifest,
  locales: { frontend: { ru: hrLocales.ru } },

  setup(_context) {
    // HR расширяет документ user через backend document registry.
    // Frontend не требует регистрации собственных роутов или компонентов.
  },
};
