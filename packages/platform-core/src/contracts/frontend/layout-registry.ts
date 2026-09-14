import type { ComponentType } from 'react';

export interface FrontendLayoutRegistry {
  register(name: string, component: ComponentType): void;
  get(name: string): ComponentType | undefined;
}
