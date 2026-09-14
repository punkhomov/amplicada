export interface BackendExtensionPointRegistry {
  contribute<T = unknown>(pointId: string, contribution: T): void;
  getAll<T = unknown>(pointId: string): T[];
}
