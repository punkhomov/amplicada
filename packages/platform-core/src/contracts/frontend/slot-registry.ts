import type { ComponentType } from 'react';

export interface FrontendSlotRegistry {
  register(name: string, component: ComponentType): void;
  override(name: string, component: ComponentType): void;
  get(name: string): ComponentType | null;
  has(name: string): boolean;
}
