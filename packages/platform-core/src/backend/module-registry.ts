import type { BackendModuleRegistry, RegisteredBackendModule } from '../contracts/backend/module-registry.js';

export class BackendModuleRegistryImpl implements BackendModuleRegistry {
  private modules = new Map<string, RegisteredBackendModule>();

  register(module: RegisteredBackendModule): void {
    this.modules.set(module.id, module);
  }

  getAll(): RegisteredBackendModule[] {
    return [...this.modules.values()];
  }

  getById(id: string): RegisteredBackendModule | undefined {
    return this.modules.get(id);
  }
}
