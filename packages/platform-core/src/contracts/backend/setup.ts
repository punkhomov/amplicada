import type { DocumentRegistry } from '../documents.js';
import type { EventBus } from '../event-bus.js';
import type { Lifecycle } from '../lifecycle.js';
import type { ServiceRegistry } from '../service-registry.js';
import type { BackendExtensionPointRegistry } from './extension-point.js';
import type { BackendMigrationRegistry } from './migration.js';
import type { BackendModuleRegistry } from './module-registry.js';
import type { BackendPipeline } from './pipeline.js';
import type { BackendRegistry } from './registry.js';
import type { BackendRouteRegistry } from './route-registry.js';
import type { TaskScheduler } from './tasks.js';

export interface BackendSetupContext {
  services: ServiceRegistry;
  routes: BackendRouteRegistry;
  extensions: BackendExtensionPointRegistry;
  registry: BackendRegistry;
  modules: BackendModuleRegistry;
  eventBus: EventBus;
  lifecycle: Lifecycle;
  pipeline: BackendPipeline;
  migrations: BackendMigrationRegistry;
  documents: DocumentRegistry;
  tasks: TaskScheduler;
}
