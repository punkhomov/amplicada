import type { ExtensionContribution, FrontendExtensionPointRegistry } from '../../contracts/frontend/extension-point.js';

export class FrontendExtensionPointRegistryImpl implements FrontendExtensionPointRegistry {
  private points = new Map<string, ExtensionContribution[]>();
  private counter = 0;

  contribute(pointId: string, contribution: Omit<ExtensionContribution, 'id'>): void {
    if (!this.points.has(pointId)) {
      this.points.set(pointId, []);
    }
    this.points.get(pointId)?.push({
      ...contribution,
      id: `ext-${++this.counter}`,
    });
  }

  getAll(pointId: string): ExtensionContribution[] {
    return (this.points.get(pointId) ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
}
