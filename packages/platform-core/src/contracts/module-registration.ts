import { type ModuleDependencyNode, sortModules } from './module-graph.js';

interface ModuleMetadata extends ModuleDependencyNode {
  name: string;
  version: string;
  dependencies?: string[];
}

/** Both bootstraps validate first and expose the entire composition before any setup. */
export function registerModules<T extends ModuleMetadata>(modules: T[], registry: { register(module: ModuleMetadata): void }): T[] {
  const ordered = sortModules(modules);
  for (const mod of ordered) {
    registry.register({ id: mod.id, name: mod.name, version: mod.version, dependencies: mod.dependencies });
  }
  return ordered;
}
