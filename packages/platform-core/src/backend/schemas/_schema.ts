import { pgSchema } from 'drizzle-orm/pg-core';

/** Namespace всех таблиц platform-core. Изолирует core-инфраструктуру от таблиц модулей. */
export const coreSchema = pgSchema('core');
