import type { BackendMigrationEntry, BackendMigrationRegistry } from '../contracts/backend/migration.js';

export class MigrationRegistryImpl implements BackendMigrationRegistry {
  private entries: BackendMigrationEntry[] = [];

  register(moduleId: string, migrationsPath: string): void {
    this.entries.push({ moduleId, migrationsPath });
  }

  getAll(): BackendMigrationEntry[] {
    return [...this.entries];
  }
}
