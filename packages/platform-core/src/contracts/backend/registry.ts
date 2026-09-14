export interface BackendRegistryKey<_T = unknown> {
  type: string;
  id: string;
}

export interface BackendRegistryEntry<T = unknown> {
  key: BackendRegistryKey<T>;
  value: T;
  metadata?: Record<string, unknown>;
}

export interface BackendRegistry {
  register<T>(key: BackendRegistryKey<T>, value: T, metadata?: Record<string, unknown>): void;
  get<T>(key: BackendRegistryKey<T>): T | undefined;
  getAll<T>(type: string): BackendRegistryEntry<T>[];
  has(key: BackendRegistryKey): boolean;
  remove(key: BackendRegistryKey): void;
  clear(): void;
  readonly size: number;
}
