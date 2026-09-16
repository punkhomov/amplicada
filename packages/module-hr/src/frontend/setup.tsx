import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { moduleManifest } from '../contracts/manifest.js';
import { hrLocales } from './locales/index.js';

export const hrFrontendModule: FrontendModule = {
  ...moduleManifest,
  locales: { frontend: { ru: hrLocales.ru } },

  setup(_context) {
    // HR расширяет документ user через backend document registry.
    // Frontend не требует регистрации собственных роутов или компонентов.
  },
};
