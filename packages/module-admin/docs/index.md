---
title: "module-admin — обзор"
type: index
package: module-admin
updated: 2026-09-17
verified_commit: 463862e6
---

# module-admin

> Потребительская документация. Рационал решений, отвергнутые альтернативы и известные
> пробелы — в `ref/notes/module-admin.md`.

Админка платформы: управление документами и инфраструктурой ядра. Пакет даёт общий CRUD по типам
документов, реестр типов на дашборде, лог доставок уведомлений и конструктор шаблонов уведомлений
с ручной рассылкой.

Осознанно не входит: собственная модель прав (весь `/api/admin` закрыт только аутентификацией),
фоновые процессы и задачи (живут в `platform-core`), rich-text редактор шаблонов.

## Публичная поверхность

| Что | Как | Где в коде |
|---|---|---|
| HTTP (общий CRUD) | `/api/admin/documents/:type` | `src/backend/routes/documents.ts` |
| HTTP (уведомления) | `/api/admin/notifications`, `POST /api/admin/notifications/send-template` | `src/backend/routes/notifications.ts` |
| Документы | типы `notification-template`; вклады модулей в карточки через `context.documents` | `src/backend/documents/notification-template.ts` |
| Frontend | страницы `/admin/*`, layout `admin`, компонент `notification-template-editor`, действие `notification-template-send` | `src/frontend/index.tsx` |
| Сервисы для модулей | `admin:toolbar` (действия карточки), `registerComponent` (ячейки карточки), `registerTableAction` (действия списка) | `src/frontend/index.tsx` |

## Зависимости и порядок загрузки

- Требует `@amplicada/platform-core` (peer): сервисы `auth-service`, `db`, `document-runtime`,
  `notification`, `storage`.
- Модулей-соседей не требует; вклады других модулей (auth-password, hr, notification-email)
  появляются в карточках автоматически через реестр документов.
- Свою миграцию `0000_init` регистрирует в `setup` до маршрутов.

## Карта документации

| Раздел | Файл |
|---|---|
| Первый контакт | — нет |
| Задачи | — нет |
| Справочник | [reference/](./reference/index.md) |
| Концепции | — нет |

## Карта покрытия

| Подсистема | Где описана |
|---|---|
| Точки расширения (токены, сервисы) | [reference/composition.md](./reference/composition.md) |
| HTTP API | [reference/notification-templates.md](./reference/notification-templates.md) — покрыт только раздел уведомлений |
| Схема БД и миграции | [reference/notification-templates.md](./reference/notification-templates.md) |
| Документы, списки, дашборд | [reference/notification-templates.md](./reference/notification-templates.md) — на примере шаблонов |
| Задачи и фоновые процессы | — нет |
| Frontend (FSD, роуты, слоты) | [reference/composition.md](./reference/composition.md); компоненты карточки — `reference/notification-templates.md` |
| Конфиг: env, зависимости, порядок | [reference/composition.md](./reference/composition.md) |
| Интеграции и потребители | [reference/composition.md](./reference/composition.md) |
| Ограничения для потребителя | [reference/notification-templates.md](./reference/notification-templates.md) |

## Freshness

- Сверено с кодом: 2026-09-17, коммит `463862e6`; рабочее дерево грязное (фича шаблонов
  уведомлений ещё не закоммичена).
- Проверено вживую на поднятой инфраструктуре: bootstrap применил миграцию `admin`, шаблон
  создан и прочитан через document-runtime, `send-template` вернул `400`/`404`/`200`,
  письмо доставлено в Mailpit.
- Не проверено вживую: UI-карточка и диалог отправки в браузере, поведение при
  неподтверждённых адресах (сейчас покрыто логикой канала).
