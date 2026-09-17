---
title: "Support Chat — API, данные и интеграция"
type: reference
updated: 2026-09-17
verified_commit: 5767b800
---

# Support Chat — API, данные и интеграция

Код: `src/backend/routes.ts`, `src/backend/services/`, `src/backend/schemas/`.
Все маршруты требуют аутентификации (401 без сессии); те же права, что и у остальной
админки — отдельной роли поддержки нет.

## Модель данных

| Таблица | Ключевые поля | Примечания |
|---|---|---|
| `support_chat.threads` | `id`, `user_id` (unique), `status` (`open`/`closed`), `updated_at`, `user_last_read_at`, `admin_last_read_at` | один тред на пользователя, FK на `core.identity_user` |
| `support_chat.messages` | `id`, `thread_id`, `author_id` (nullable), `author_role` (`user`/`admin`/`ai`), `body`, `created_at` | FK на тред с `ON DELETE CASCADE`; у роли `ai` автора-пользователя нет |

Миграции — `migrations/0000_init.sql` и `migrations/0001_ai_author.sql` (роль `ai`,
nullable `author_id`), применяются bootstrap'ом под именем `support-chat`.
Таблицы не участвуют в Document System: это обычные таблицы модуля.

Непрочитанные считаются по отметкам `user_last_read_at` / `admin_last_read_at`
(`src/backend/services/helpers.ts`): сообщение собеседника после отметки — непрочитанное.
Для подсчёта поддержки учитываются только сообщения роли `user`
(`src/backend/services/support-chat-service.ts`, `listThreads`).
Отправка сообщения пользователем обновляет его отметку и переоткрывает закрытый тред.

## Backend-сервис (задел под AI)

Модуль публикует сервис `support-chat` (`context.services.register('support-chat', service)`,
`src/backend/setup.ts`). Публичный контракт — `SupportChatBackendService`
(`src/contracts/backend.ts`):

| Метод | Поведение |
|---|---|
| `appendMessage({ threadId, authorRole, body, authorId? })` | Пишет сообщение от любой роли (включая `ai`), обновляет `updated_at` и публикует SSE-события |
| `getThreadMessages(threadId)` | Сообщения треда со статусом |

Будущий AI-провайдер подключается отдельным модулем: резолвит `support-chat`, слушает
новые обращения (события `support-chat.message.created`) и отвечает через `appendMessage`.
Отправка через сервис (а не прямой INSERT) гарантирует SSE-доставку и корректные счётчики.

## HTTP API

Пользовательские маршруты:

| Метод и путь | Тело | Ответ |
|---|---|---|
| `GET /api/support-chat/thread` | — | `{ thread: SupportThreadDto \| null }` |
| `POST /api/support-chat/thread/messages` | `{ body }` | `{ thread: SupportThreadDto }` (создаёт тред при первом сообщении) |
| `POST /api/support-chat/thread/read` | — | `{ ok: true }` |

Маршруты поддержки:

| Метод и путь | Тело | Ответ |
|---|---|---|
| `GET /api/support-chat/admin/threads` | — | `SupportAdminThreadDto[]` |
| `GET /api/support-chat/admin/threads/:id` | — | `SupportAdminThreadDetailDto` |
| `POST /api/support-chat/admin/threads/:id/messages` | `{ body }` | `{ thread }` |
| `POST /api/support-chat/admin/threads/:id/read` | — | `{ ok: true }` |
| `PATCH /api/support-chat/admin/threads/:id` | `{ status: 'open' \| 'closed' }` | `{ thread }` |

Ограничения: тело сообщения — непустая строка до 4000 символов (`SUPPORT_CHAT_MESSAGE_MAX_LENGTH`),
иначе 400; неизвестный тред — 404; `SupportThreadDto` содержит `messages`, `status`,
`unreadCount` с точки зрения получателя.

## SSE

| Поток | Путь | Что приходит |
|---|---|---|
| Пользователь | `GET /api/support-chat/events` | только события своего треда |
| Поддержка | `GET /api/support-chat/admin/events` | все события |

События (`src/contracts/index.ts`): `support-chat.message.created` и
`support-chat.thread.updated`; payload — `{ threadId, userId, authorRole, status, messageId? }`.
Соединение держится keep-alive-комментарием каждые 20 секунд, закрывается по `close` запроса.
Доставка идёт через Redis-канал `support-chat:events`, поэтому события доходят до клиента
независимо от того, какая реплика API их опубликовала. Устройство — [explanation/realtime.md](../explanation/realtime.md).

## Frontend

Транскрипты собраны на вендоренном `MessageScroller` из кита core
(`@amplicada/platform-core/frontend/ui/message-scroller`): якорь на сообщениях
пользователя, автопрокрутка у live edge, кнопка «к последнему».

Общий рендер сообщений — `widgets/chat-transcript` (`ChatTranscript`):
подпись автора только на первом сообщении группы, подряд идущие сообщения одной роли
схлопываются, время — внутри пузыря на последнем сообщении группы, у входящих групп —
аватар. Собственные сообщения уходят вправо (`ownRole`: `user` для виджета, `admin`
для админки). Группировка — чистый хелпер `lib/grouping.ts` с unit-тестами.

Виджет (`features/support-chat-widget`) подключён к точке `floating` и открывается
карточкой снизу-справа (`Card`, не Sheet). Админ-страница (`pages/support-chat-admin`)
регистрируется как приложение `admin:apps` с id `support-chat`. Composer рендерится
внутри `MessageScrollerProvider` — только так доступен `useMessageScroller().scrollToEnd()`
после отправки.

## Интеграция с админкой и core

- Виджет пользователя подписывается на точку расширения `floating` (`src/frontend/setup.tsx`),
  смонтированную в `RootLayout` (`platform-core/src/frontend/layouts/root-layout.tsx`).
  Без авторизации виджет не рендерится и не открывает SSE.
- Админ-приложение регистрируется в сервисе `admin:apps` с id `support-chat` и рендерится
  хостом `/admin/apps/:appId` (`module-admin`).
- Зависимости: обязательный peer `@amplicada/module-admin` (сервис и layout `admin`),
  `platform-core`, `fastify`, `drizzle-orm`, `react`. Порядок setup задаёт генератор
  приложений по peer-зависимостям.
