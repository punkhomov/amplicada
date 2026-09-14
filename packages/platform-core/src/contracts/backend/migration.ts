export interface BackendMigrationEntry {
  moduleId: string;
  migrationsPath: string;
}

export interface BackendMigrationRegistry {
  register(moduleId: string, migrationsPath: string): void;
  getAll(): BackendMigrationEntry[];
}
