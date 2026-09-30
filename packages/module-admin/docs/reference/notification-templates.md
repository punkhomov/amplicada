---
title: "Шаблоны уведомлений"
type: reference
updated: 2026-09-30
verified_commit: 0551349
order: 30
---

# Шаблоны уведомлений

Админский конструктор писем и ручная рассылка выбранным пользователям. Шаблон — документ-тип
ядра `notification-template` (таблица `core.notification_template`); `module-admin` — только UI
над типом: список, карточка, редактор, рассылка и лог доставок.

## Документ и схема

| Что | Значение | Где в коде |
|---|---|---|
| Тип документа | `notification-template` (`Documents.NOTIFICATION_TEMPLATE`), регистрирует platform-core | `platform-core/src/backend/documents/notification-template.ts` |
| Список | `/admin/notification-template` (generic CRUD админки) | `src/backend/routes/documents.ts` |
| Таблица | `core.notification_template` (миграция core `0007`) | `platform-core/migrations/0007_notification_contract_v2.sql` |
| Ссылка на дашборде | `/admin/notification-template` | `src/backend/index.ts` |

Поля документа:

| Поле | Тип | Обязательное | Комментарий |
|---|---|---|---|
| `name` | text | да | название шаблона в списке |
| `subject` | text | да | тема письма; поддерживает `{{path}}` |
| `locale` | select (`ru`, `en`) | нет | локаль для резолва code-шаблонов |
| `body` | text (plain text) | да | обязательная текстовая часть |
| `html` | text | нет | если пусто — уходит только `body`; подстановки экранируются |
| `sender` | select | нет | имя из `SMTP_SENDERS`; пусто — дефолтный `SMTP_FROM` |
| `attachments` | манифест | нет | объекты storage; загрузка/снятие — отдельными роутами |

`body`, `html`, `sender` и `attachments` редактируются компонентом
`notification-template-editor`; `subject`, `name`, `locale` — обычные поля карточки. Компонент
заменяет бакет extension'а целиком, поэтому остальные поля он сохраняет сам.

### Code-шаблоны (fixtures)

Модули могут объявлять шаблоны кодом (`context.documents.fixtures.register`, ключ
`fixture_key = '<code>:<locale>'`). Тип включён в `fixtureReadonly`: правка и удаление
fixture-строки отклоняются `409` (сервер) и заблокированы в UI — карточка показывает бейдж
«Из кода», список — колонку «Из кода». Источник истины — код: `reconcileFixtures` перезаписывает
строку на каждом bootstrap.

## HTTP API

Все роуты — под общим guard'ом `/api/admin` (`src/backend/index.ts`).

| Метод | Путь | Тело / query | Ответ |
|---|---|---|---|
| `GET` | `/api/admin/notifications` | `status`, `kind`, `userId`, `batchId`, `limit`, `offset` | `{ items, total }` |
| `GET` | `/api/admin/notifications/senders` | — | `{ senders: string[] }` |
| `POST` | `/api/admin/notifications/send-template` | `{ templateId: string, userIds: string[] }` | `SendBatchResult` |
| `POST` | `/api/admin/notifications/batch/:batchId/retry` | — | `{ retried: number }` |
| `POST` | `/api/admin/notifications/:id/retry` | — | `{ ok: true }` |
| `POST` | `/api/admin/notifications/template-attachments?templateId=…` | multipart, поле `file` | `{ attachments }` |
| `DELETE` | `/api/admin/notifications/template-attachments` | `{ templateId, storageKey }` | `{ attachments }` |

Правила рассылки (`src/backend/routes/notifications.ts`):

- отправляется **сохранённая** версия шаблона: UI блокирует кнопку на несохранённой карточке;
- `userIds` нормализуются: только непустые uuid, без дублей, не больше `ADMIN_BROADCAST_MAX_RECIPIENTS` (200) — `src/backend/lib/normalize-recipients.ts`;
- рассылка идёт через `notification.sendMany({ userIds, kind: 'admin.broadcast', content: { template: { id } } })`: один `batchId` на запуск, по строке на получателя, **без eager** — доставку добирает worker-диспетчер;
- ответ — `SendBatchResult` (`batchId`, `total`, `queued`, `skipped`, `failed`, `deduped`); `skipped` — получатели без канала или подтверждённого адреса, `failed` — ошибки постановки строки;
- `kind` рассылки — `admin.broadcast`; в логе её видно фильтром по kind и batchId, там же «Повторить батч».

Вложения:

- ключ объекта — `notification-templates/<templateId>/<uuid>-<safe-name>` (`src/backend/lib/attachment-key.ts`);
- лимиты — `NOTIFICATION_ATTACHMENT_LIMITS`: 10 МиБ/файл, 20 МиБ/письмо; проверка на загрузке и на отправке (реальный размер через `headObject`);
- манифест пишется через document-runtime (fixture-шаблон получит `409`); при ошибке записи загруженный объект удаляется;
- снятие вложения удаляет объект из storage best-effort; при удалении шаблона объекты чистит `remove`-хук типа.

## Выбор получателей

Поиск — через общий список документов `user`: `GET /api/admin/documents/user` с фильтром
`contains` по колонке `core:base:login` (минимум 2 символа, лимит 20). Своего endpoint'а у фичи
нет; выбранные пользователи живут в состоянии диалога
(`src/frontend/widgets/user-picker/`).

## Ошибки

| Код | Когда |
|---|---|
| `400` | пустой или не-uuid `templateId`; не выбран ни один получатель; сумма вложений больше 20 МиБ |
| `401` | нет сессии (общий guard админки) |
| `404` | шаблон или вложение не найдены |
| `409` | правка/удаление fixture-шаблона; попытка вложения в fixture-шаблон |
| `413` | файл больше 10 МиБ |

## Ограничения

- Отложенная отправка (`scheduledAt`) и `dedupeKey` из UI не выставляются — они доступны
  потребителям контракта, у рассылки всегда «сейчас» без дедупликации.
- Rich-text редактора нет: `body` — plain text, `html` — произвольная разметка, предпросмотр
  рендерится в `iframe` с `sandbox=""` (скрипты не исполняются).
- Получатель — только пользователь платформы (`userIds` — id документов `user`); отправить на
  произвольный адрес нельзя.
- Потолок одного запуска — 200 получателей.
- Рассылка не транзакционна: часть получателей может быть пропущена, результат приходит
  счётчиками; повтор упавших — «Повторить батч».
- На узле `ROLE=web` без воркера строки батча остаются `pending` — статус виден в логе.
- Без `SMTP_HOST` (см. `module-notification-email`) канал не зарегистрирован, и все получатели
  попадут в `skipped`.
