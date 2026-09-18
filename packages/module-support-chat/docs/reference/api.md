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
| `support_chat.threads` | `id`, `user_id`, `status` (`open`/`pending`/`solved`/`closed`), `kind` (`question`/`incident`), `severity`, `incident_thread_id`, `resolved_by`, `close_reason`, `resolved_at`, `closed_at`, `created_at`, `updated_at`, `user_last_read_at`, `admin_last_read_at` | обращений у пользователя может быть несколько (unique снят в `0003`), FK на `core.identity_user`, индекс `(user_id, updated_at DESC)` |
| `support_chat.messages` | `id`, `thread_id`, `author_id` (nullable), `author_role` (`user`/`admin`/`ai`), `body`, `attachment_key`, `attachment_name`, `attachment_mime`, `attachment_size`, `created_at` | FK на тред с `ON DELETE CASCADE`; у роли `ai` автора-пользователя нет; вложение опционально, `body` при нём может быть пустым |

Миграции — `0000_init.sql`, `0001_ai_author.sql` (роль `ai`), `0002_attachments.sql`
(вложения), `0003_multi_threads.sql` (несколько обращений) и `0004_lifecycle_and_incidents.sql`
(статусы «чей ход», атрибуты закрытия, инциденты), применяются bootstrap'ом под
именем `support-chat`.

### Жизненный цикл

Статус отвечает на вопрос «чей ход»:

| Статус | Кто действует | Как попадают |
|---|---|---|
| `open` | поддержка | создание, сообщение пользователя, возврат в работу |
| `pending` | пользователь | поддержка отметила «ждём ответа» |
| `solved` | пользователь подтверждает | поддержка пометила «решено» |
| `closed` | никто | пользователь закрыл сам или поддержка (решение/дубликат) |

Сообщение пользователя переоткрывает любое состояние (`→ open`), ответ поддержки
переоткрывает `solved`/`closed`. Пользователь сам закрывает и переоткрывает своё
обращение (`canUserSetStatus`). При закрытии фиксируются `resolved_by`, `close_reason`
(`resolved`/`not_relevant`/`duplicate`), `resolved_at`, `closed_at`; возврат в работу
их очищает. Автозакрытие `solved` по таймеру пока не реализовано (см. пробелы в notes).

### Инциденты

`kind = incident` — отдельный вид записи с `severity` (`low`…`critical`); обычные
обращения могут быть привязаны к инциденту через `incident_thread_id` (дубли).
Поддержка меняет вид/серьёзность/привязку через `PATCH /admin/threads/:id` и рассылает
обновление всем привязанным обращениям через `POST /admin/threads/:id/broadcast`
(сообщение от роли `admin` в каждый тред). Полноценный ITSM (problem/known error) — вне
текущего объёма.
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
| `appendMessage({ threadId, authorRole, body, authorId?, attachment? })` | Пишет сообщение от любой роли (включая `ai`), обновляет `updated_at` и публикует SSE-события |
| `getThreadMessages(threadId)` | Сообщения треда со статусом |

Будущий AI-провайдер подключается отдельным модулем: резолвит `support-chat`, слушает
новые обращения (события `support-chat.message.created`) и отвечает через `appendMessage`.
Отправка через сервис (а не прямой INSERT) гарантирует SSE-доставку и корректные счётчики.

## HTTP API

Пользовательские маршруты:

| Метод и путь | Тело | Ответ |
|---|---|---|
| `GET /api/support-chat/thread` | — | `{ thread: SupportThreadDto \| null, unreadTotal }` — активное (свежее по `updated_at`) обращение для виджета |
| `POST /api/support-chat/thread/messages` | `{ body, attachment? }` | `{ thread }` — продолжает активное обращение, создаёт его, если обращений ещё нет |
| `POST /api/support-chat/thread/read` | — | `{ ok: true }` — отметка активного обращения |
| `GET /api/support-chat/threads` | — | `SupportUserThreadSummaryDto[]` — все обращения пользователя со сводкой |
| `POST /api/support-chat/threads` | `{ body, attachment? }` | `{ thread }` — новое обращение с первым сообщением |
| `GET /api/support-chat/threads/:id` | — | `{ thread }`; чужое обращение — 404 |
| `POST /api/support-chat/threads/:id/messages` | `{ body, attachment? }` | `{ thread }` |
| `POST /api/support-chat/threads/:id/read` | — | `{ ok: true }` |
| `PATCH /api/support-chat/threads/:id` | `{ status: 'open' \| 'closed', closeReason? }` | `{ thread }` — пользователь закрывает/переоткрывает сам |
| `POST /api/support-chat/attachments` | multipart-часть `file` | `SupportAttachmentUploadDto` — токен для отправки сообщения |
| `GET /api/support-chat/attachments/:messageId` | — | файл (inline для картинок и PDF, иначе `Content-Disposition: attachment`) |

Маршруты поддержки:

| Метод и путь | Тело | Ответ |
|---|---|---|
| `GET /api/support-chat/admin/threads` | — | `SupportAdminThreadDto[]` |
| `GET /api/support-chat/admin/threads/:id` | — | `SupportAdminThreadDetailDto` |
| `POST /api/support-chat/admin/threads/:id/messages` | `{ body, attachment? }` | `{ thread }` |
| `POST /api/support-chat/admin/threads/:id/read` | — | `{ ok: true }` |
| `PATCH /api/support-chat/admin/threads/:id` | `{ status?, closeReason?, kind?, severity?, incidentThreadId? }` | `{ thread }` |
| `POST /api/support-chat/admin/threads/:id/broadcast` | `{ body }` | `{ recipients }` — сообщение во все привязанные к инциденту обращения |

Ограничения: до 4000 символов текста (`SUPPORT_CHAT_MESSAGE_MAX_LENGTH`) — 400 при превышении;
сообщение без текста допустимо, если есть вложение, и наоборот; неизвестный тред — 404;
`SupportThreadDto` содержит `messages`, `status`, `unreadCount` с точки зрения получателя.

## Вложения

Файл лежит в S3-хранилище core (сервис `storage`), в БД — только метаданные.
Поток: `POST /attachments` (multipart, лимит 10 МБ, имя санитизируется, ключ
`support-chat/<userId>/<uuid><ext>`) → ответ-токен → `POST .../messages` с
`attachment: { key, name, mime, size }`. Сервис принимает ключ, только если он принадлежит
участнику разговора (префикс владельца треда или автора), — чужой/подделанный ключ даёт 400.
Скачивание идёт через API, а не напрямую из S3: доступ тот же, что у админских роутов.
Файлы-картинки рендерятся превью в пузыре, остальные — чипом с именем и размером.

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
подряд идущие сообщения одной роли схлопываются, время — внутри пузыря на последнем
сообщении группы. Имя автора (логин; у `ai` — локализованное) и тег роли
(`role_admin` → «Поддержка», `ai` → «ИИ-помощник», в админке у пользователя —
«Клиент») — первой строкой внутри пузыря первого сообщения группы. Аватар входящей
группы — на последнем сообщении, на остальных остаётся пустой слот `MessageAvatar`,
который держит гуттер: пузыри группы стоят по одной левой границе (канон `Message`).
Собственные сообщения уходят вправо (`ownRole`: `user` для виджета, `admin` для
админки); вложения рисуются превью или чипом. Группировка — чистый хелпер
`lib/grouping.ts` с unit-тестами, формат размера — `lib/format.ts`.

Виджет (`features/support-chat-widget`) подключён к точке `floating` и открывается
карточкой снизу-справа (`Card`, не Sheet): шапка с подзаголовком, пустое состояние
на компоненте `Empty`, композер внизу; бейдж считает непрочитанное по всем обращениям,
кнопка в шапке ведёт на страницу «Мои обращения». Виджет всегда показывает активное
(свежее) обращение.

Портальные страницы: `pages/my-threads` на `/support` — список обращений (статус,
вид/серьёзность инцидента, превью последнего сообщения, непрочитанное, кто отвечал,
число сообщений) и `pages/my-thread` на `/support/:id` и `/support/new` — история
переписки с продолжением в композере, кнопками «Закрыть обращение»/«Переоткрыть» и
строкой «кто решил и почему»; при открытии обращение помечается прочитанным. Пункт
навигации «Мои обращения» регистрируется модулем.

Админка: фильтр списка по статусу, действия по статусу (вернуть в работу, ждём ответа,
решено, закрыть, закрыть как дубликат), управление инцидентом (сделать инцидентом с
серьёзностью, понизить, привязать/отвязать обращение), список связанных обращений и
рассылка обновления по инциденту.

Админ-страница (`pages/support-chat-admin`) регистрируется как приложение
`admin:apps` с id `support-chat`.

Общий композер — `widgets/chat-composer`: скрытый `<input type="file">` за кнопкой «+»,
загрузка вложения отдельным запросом (чип с именем и размером до отправки), отправка
маленькой круглой кнопкой. Композер рендерится внутри `MessageScrollerProvider` —
только так доступен `useMessageScroller().scrollToEnd()` после отправки.

## Интеграция с админкой и core

- Виджет пользователя подписывается на точку расширения `floating` (`src/frontend/setup.tsx`),
  смонтированную в `RootLayout` (`platform-core/src/frontend/layouts/root-layout.tsx`).
  Без авторизации виджет не рендерится и не открывает SSE.
- Админ-приложение регистрируется в сервисе `admin:apps` с id `support-chat` и рендерится
  хостом `/admin/apps/:appId` (`module-admin`).
- Зависимости: обязательный peer `@amplicada/module-admin` (сервис и layout `admin`),
  `platform-core`, `fastify`, `drizzle-orm`, `react`. Порядок setup задаёт генератор
  приложений по peer-зависимостям.
