import type { FastifyInstance } from 'fastify';
import type { BackendSetupContext } from './setup.js';

export interface BackendModule {
  id: string;
  name: string;
  version: string;
  dependencies?: string[];
  locales?: {
    backend?: Record<string, Record<string, string>>;
  };
  setup(context: BackendSetupContext, app?: FastifyInstance): void | Promise<void>;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}
