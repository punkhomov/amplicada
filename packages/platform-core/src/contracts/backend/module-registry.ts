export interface RegisteredBackendModule {
  id: string;
  name: string;
  version: string;
  dependencies?: string[];
}

export interface BackendModuleRegistry {
  register(module: RegisteredBackendModule): void;
  getAll(): RegisteredBackendModule[];
  getById(id: string): RegisteredBackendModule | undefined;
}
