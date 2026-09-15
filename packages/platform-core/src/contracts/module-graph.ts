/** Pure graph validation shared by build tooling and both runtime bootstraps. */
export interface ModuleDependencyNode {
  id: string;
  dependencies?: readonly string[];
}

export function sortModules<T extends ModuleDependencyNode>(modules: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const mod of modules) {
    if (typeof mod.id !== 'string' || !mod.id.trim()) throw new Error('Module id must be a non-empty string');
    if (byId.has(mod.id)) throw new Error(`Duplicate module "${mod.id}"`);
    if (
      mod.dependencies !== undefined &&
      (!Array.isArray(mod.dependencies) || mod.dependencies.some(id => typeof id !== 'string' || !id.trim()))
    ) {
      throw new Error(`Invalid dependencies of module "${mod.id}"`);
    }
    byId.set(mod.id, mod);
  }
  const result: T[] = [];
  const visited = new Set<string>();
  const path: string[] = [];
  function visit(id: string): void {
    if (path.includes(id)) throw new Error(`Module dependency cycle: ${[...path, id].join(' -> ')}`);
    if (visited.has(id)) return;
    const mod = byId.get(id);
    if (!mod) throw new Error(`Missing module dependency: ${[...path, id].join(' -> ')}`);
    path.push(id);
    for (const dependency of mod.dependencies ?? []) visit(dependency);
    path.pop();
    visited.add(id);
    result.push(mod);
  }
  for (const mod of modules) visit(mod.id);
  return result;
}
