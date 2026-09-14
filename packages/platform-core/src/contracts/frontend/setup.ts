import type { QueryClient } from '@tanstack/react-query';
import type { EventBus } from '../event-bus.js';
import type { Lifecycle } from '../lifecycle.js';
import type { ServiceRegistry } from '../service-registry.js';
import type { FrontendExtensionPointRegistry } from './extension-point.js';
import type { FrontendLayoutRegistry } from './layout-registry.js';
import type { FrontendModuleRegistry } from './module-registry.js';
import type { FrontendNavigationRegistry } from './navigation.js';
import type { FrontendRouteRegistry } from './route-registry.js';
import type { FrontendSlotRegistry } from './slot-registry.js';

export interface FrontendSetupContext {
  layouts: FrontendLayoutRegistry;
  routes: FrontendRouteRegistry;
  slots: FrontendSlotRegistry;
  extensions: FrontendExtensionPointRegistry;
  navigation: FrontendNavigationRegistry;
  modules: FrontendModuleRegistry;
  services: ServiceRegistry;
  eventBus: EventBus;
  lifecycle: Lifecycle;
  /** Тот же QueryClient, что использует FrontendProvider — для route loader'ов (ensureQueryData). */
  queryClient: QueryClient;
}
