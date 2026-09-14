import type { FrontendSetupContext } from './setup.js';

export interface FrontendModule {
  id: string;
  name: string;
  version: string;
  dependencies?: string[];
  locales?: {
    frontend?: Record<string, Record<string, string>>;
  };
  setup(context: FrontendSetupContext): void | Promise<void>;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}
