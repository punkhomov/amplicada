import type { ServiceRegistry } from '../../contracts/service-registry.js';

export class FrontendServiceRegistryImpl implements ServiceRegistry {
  private services = new Map<string, unknown>();

  register<T = unknown>(token: string, implementation: T): void {
    this.services.set(token, implementation);
  }

  resolve<T = unknown>(token: string): T {
    const service = this.services.get(token);
    if (!service) {
      throw new Error(`Service "${token}" is not registered`);
    }
    return service as T;
  }

  has(token: string): boolean {
    return this.services.has(token);
  }
}
