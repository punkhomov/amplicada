import type { ComponentType } from 'react';
import type { FrontendSlotRegistry } from '../../contracts/frontend/slot-registry.js';

export class FrontendSlotRegistryImpl implements FrontendSlotRegistry {
  private slots = new Map<string, ComponentType>();
  private overrides = new Map<string, ComponentType>();

  register(name: string, component: ComponentType): void {
    this.slots.set(name, component);
  }

  override(name: string, component: ComponentType): void {
    this.overrides.set(name, component);
  }

  get(name: string): ComponentType | null {
    return this.overrides.get(name) ?? this.slots.get(name) ?? null;
  }

  has(name: string): boolean {
    return this.overrides.has(name) || this.slots.has(name);
  }
}
