import type { HTTPMethods } from 'fastify';
import type { BackendRouteDefinition, BackendRouteHandler, BackendRouteRegistry } from '../contracts/backend/route-registry.js';

export class RouteRegistryImpl implements BackendRouteRegistry {
  private routes: BackendRouteDefinition[] = [];

  register(method: HTTPMethods, path: string, handler: BackendRouteHandler): void {
    this.routes.push({ method, path, handler });
  }

  getAll(): BackendRouteDefinition[] {
    return [...this.routes];
  }
}
