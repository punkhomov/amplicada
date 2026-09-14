import type { ComponentType } from 'react';
import type { FrontendLayoutRegistry } from '../../contracts/frontend/layout-registry.js';

export class FrontendLayoutRegistryImpl implements FrontendLayoutRegistry {
  private layouts = new Map<string, ComponentType>();

  register(name: string, component: ComponentType): void {
    this.layouts.set(name, component);
  }

  get(name: string): ComponentType | undefined {
    return this.layouts.get(name);
  }
}
