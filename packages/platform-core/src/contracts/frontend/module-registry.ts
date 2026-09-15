export interface RegisteredModule {
  id: string;
  name: string;
  version: string;
  dependencies?: string[];
}

export interface FrontendModuleRegistry {
  register(module: RegisteredModule): void;
  getAll(): RegisteredModule[];
  getById(id: string): RegisteredModule | undefined;
}
