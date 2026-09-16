import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { FrontendModule, FrontendSetupContext } from '../contracts/frontend/index.js';
import { registerModules } from '../contracts/module-registration.js';
import { FrontendContext, useFrontendContext } from './frontend-context.js';
import { AppLayout } from './layouts/app-layout.js';
import { PublicLayout } from './layouts/public-layout.js';
import { API_CLIENT_TOKEN, createApiClient } from './lib/api-client.js';
import { createI18n, type LocaleResources } from './lib/i18n.js';
import { createQueryClient } from './lib/query-client.js';
import { coreLocales } from './locales/index.js';
import { FrontendEventBusImpl } from './registries/event-bus.js';
import { FrontendExtensionPointRegistryImpl } from './registries/extension-point.js';
import { FrontendLayoutRegistryImpl } from './registries/layout-registry.js';
import { FrontendLifecycleImpl } from './registries/lifecycle.js';
import { FrontendModuleRegistryImpl } from './registries/module-registry.js';
import { FrontendNavigationRegistryImpl } from './registries/navigation.js';
import { FrontendRouteRegistryImpl } from './registries/route-registry.js';
import { FrontendServiceRegistryImpl } from './registries/service-registry.js';
import { FrontendSlotRegistryImpl } from './registries/slot-registry.js';

export interface FrontendApp {
  context: FrontendSetupContext;
  queryClient: QueryClient;
}

export function createFrontendApp(): FrontendApp {
  const layouts = new FrontendLayoutRegistryImpl();
  layouts.register('public', PublicLayout);
  layouts.register('app', AppLayout);

  const queryClient = createQueryClient();

  const context: FrontendSetupContext = {
    layouts,
    routes: new FrontendRouteRegistryImpl(),
    slots: new FrontendSlotRegistryImpl(),
    extensions: new FrontendExtensionPointRegistryImpl(),
    navigation: new FrontendNavigationRegistryImpl(),
    modules: new FrontendModuleRegistryImpl(),
    services: new FrontendServiceRegistryImpl(),
    eventBus: new FrontendEventBusImpl(),
    lifecycle: new FrontendLifecycleImpl(),
    queryClient,
  };

  context.services.register(API_CLIENT_TOKEN, createApiClient());

  return { context, queryClient };
}

export async function bootstrapFrontend(modules: FrontendModule[], context: FrontendSetupContext): Promise<void> {
  modules = registerModules(modules, context.modules);
  const resources: LocaleResources = {};
  for (const mod of modules) {
    if (mod.locales?.frontend) {
      for (const [lang, strings] of Object.entries(mod.locales.frontend)) {
        resources[lang] ??= {};
        resources[lang][mod.id] = strings;
      }
    }
  }
  for (const [lang, strings] of Object.entries(coreLocales)) {
    resources[lang] ??= {};
    resources[lang].core = strings;
  }
  const i18nInstance = createI18n(resources);
  i18nInstance.on('languageChanged', () => {
    context.queryClient.invalidateQueries();
  });

  for (const mod of modules) {
    await mod.setup(context);
  }
  for (const mod of modules) {
    await mod.start?.();
  }
}

export function FrontendProvider({
  context,
  queryClient,
  children,
}: {
  context: FrontendSetupContext;
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <FrontendContext.Provider value={context}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrontendContext.Provider>
  );
}

export { useFrontendContext };
