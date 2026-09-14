/**
 * Сидируется в platform-core/migrations/0000_init.sql — гарантированно существует в любой БД.
 * Временная заглушка для createdByUserId, пока document API не прокидывает actor'а запроса
 * (BackendDocumentRuntime.create/update не принимают request.user). Заменить на реального
 * пользователя, когда появится сквозное прокидывание actor'а.
 */
export const SYSTEM_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

/** Dashboard-секция для всех документов module-hr (см. registerHrDocuments в ./index.ts). */
export const HR_STRUCTURE_SECTION = 'hr-structure';

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `effectiveDate` для правок через карточку. Карточка — generic CRUD-форма без поля «действует с»,
 * поэтому она не заявляет дату вступления в силу: её правка — коррекция записи, а не новый факт.
 * Раньше здесь подставлялось `today()` вместе с `isSystemCorrection: true` (флаг существовал только
 * чтобы обойти проверку «дата не в прошлом»), и любая правка опечатки порождала новую версию.
 * См. ref/plans/2026-08-05-document-model/05-hr-versioning.md.
 */
export const CARD_CORRECTION: null = null;
