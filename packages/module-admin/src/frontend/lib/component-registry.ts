import type { ComponentType } from 'react';

// biome-ignore lint/suspicious/noExplicitAny: произвольные пропсы от места рендера
type ExtensionComponent = ComponentType<any>;

const registry = new Map<string, ExtensionComponent>();

export function registerComponent(moduleId: string, component: ExtensionComponent): void {
  registry.set(moduleId, component);
}

export function getComponent(moduleId: string): ExtensionComponent | undefined {
  return registry.get(moduleId);
}
