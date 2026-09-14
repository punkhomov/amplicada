import type { ComponentType, ReactNode } from 'react';

export interface NavigationItem {
  id: string;
  label: string;
  path: string;
  icon?: ComponentType | ReactNode;
  order?: number;
  parent?: string;
  permissions?: string[];
}

export interface FrontendNavigationRegistry {
  register(item: NavigationItem): void;
  getAll(): NavigationItem[];
}
