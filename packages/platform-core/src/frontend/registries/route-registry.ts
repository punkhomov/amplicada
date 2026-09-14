import type { ReactNode } from 'react';
import type { FrontendRouteDefinition, FrontendRouteRegistry } from '../../contracts/frontend/route-registry.js';

export class FrontendRouteRegistryImpl implements FrontendRouteRegistry {
  private routes: FrontendRouteDefinition[] = [];

  register(path: string, element: ReactNode, options?: { layout?: string; meta?: Record<string, unknown> }): void {
    this.routes.push({ path, element, ...options });
  }

  getAll(): FrontendRouteDefinition[] {
    return [...this.routes];
  }
}
