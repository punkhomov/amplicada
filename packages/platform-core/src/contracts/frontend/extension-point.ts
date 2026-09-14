import type { ComponentType } from 'react';

export interface ExtensionContribution {
  id: string;
  component: ComponentType;
  order?: number;
  meta?: Record<string, unknown>;
}

export interface FrontendExtensionPointRegistry {
  contribute(pointId: string, contribution: Omit<ExtensionContribution, 'id'>): void;
  getAll(pointId: string): ExtensionContribution[];
}
