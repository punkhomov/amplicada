import type { FrontendModuleRegistry, RegisteredModule } from '../../contracts/frontend/module-registry.js';

export class FrontendModuleRegistryImpl implements FrontendModuleRegistry {
  private modules = new Map<string, RegisteredModule>();

  register(module: RegisteredModule): void {
    this.modules.set(module.id, module);
  }

  getAll(): RegisteredModule[] {
    return [...this.modules.values()];
  }

  getById(id: string): RegisteredModule | undefined {
    return this.modules.get(id);
  }
}
