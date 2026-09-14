import type { BackendExtensionPointRegistry } from '../contracts/backend/extension-point.js';

export class ExtensionPointRegistryImpl implements BackendExtensionPointRegistry {
  private points = new Map<string, unknown[]>();

  contribute<T = unknown>(pointId: string, contribution: T): void {
    if (!this.points.has(pointId)) {
      this.points.set(pointId, []);
    }
    this.points.get(pointId)?.push(contribution);
  }

  getAll<T = unknown>(pointId: string): T[] {
    return (this.points.get(pointId) ?? []) as T[];
  }
}
