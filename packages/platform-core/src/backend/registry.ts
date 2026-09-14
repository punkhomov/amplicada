import type { BackendRegistry, BackendRegistryEntry, BackendRegistryKey } from '../contracts/backend/registry.js';

export class RegistryImpl implements BackendRegistry {
  private entries = new Map<string, BackendRegistryEntry>();

  private toKey(key: BackendRegistryKey): string {
    return `${key.type}:${key.id}`;
  }

  register<T>(key: BackendRegistryKey<T>, value: T, metadata?: Record<string, unknown>): void {
    this.entries.set(this.toKey(key), { key, value, metadata });
  }

  get<T>(key: BackendRegistryKey<T>): T | undefined {
    return this.entries.get(this.toKey(key))?.value as T | undefined;
  }

  getAll<T>(type: string): BackendRegistryEntry<T>[] {
    const results: BackendRegistryEntry<T>[] = [];
    for (const entry of this.entries.values()) {
      if (entry.key.type === type) {
        results.push(entry as BackendRegistryEntry<T>);
      }
    }
    return results;
  }

  has(key: BackendRegistryKey): boolean {
    return this.entries.has(this.toKey(key));
  }

  remove(key: BackendRegistryKey): void {
    this.entries.delete(this.toKey(key));
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
