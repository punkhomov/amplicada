import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export type BackendDbService = NodePgDatabase<Record<string, never>>;
