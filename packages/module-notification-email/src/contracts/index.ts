/**
 * Префикс namespace'а локалей модуля: им подписаны метки полей карточки пользователя
 * (`notification-email:field_email`), которые ядро переводит backend-локалями запроса.
 */
export const NOTIFICATION_EMAIL_LOCALE_SCOPE = 'notification-email';

/** Поля, которые модуль добавляет к документу `user` (см. `backend/documents/user.ts`). */
export const UserEmailFields = {
  EMAIL: 'email',
  VERIFIED_AT: 'verifiedAt',
} as const;
