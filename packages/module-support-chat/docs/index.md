---
title: "Support Chat — обзор"
type: index
package: module-support-chat
updated: 2026-09-17
verified_commit: 5767b800
---

# Support Chat

> Потребительская документация. Рационал решений, отвергнутые альтернативы и известные
> пробелы — в `ref/notes/module-support-chat.md`.

`module-support-chat` — первое встроенное приложение админки: обращения пользователей
и ответы поддержки. Пользователь пишет в плавающий чат на любой странице приложения,
поддержка отвечает из приложения `/admin/apps/support-chat`.

Что входит: API обращений и сообщений, SSE-доставка изменений, вложения (S3-хранилище
core, картинки превью), плавающий виджет пользователя, портальная страница
«Мои обращения» (список обращений и история переписки), админ-приложение (список
обращений, переписка, ответ, закрытие), транскрипты на вендоренном `MessageScroller`.

Что осознанно не входит: уведомления по почте, разграничение прав поддержки. Под будущий AI-провайдер заложены роль `ai`
и публичный сервис `support-chat` (`appendMessage`) — сам провайдер не реализован.

## Публичная поверхность

| Что | Как | Где в коде |
|---|---|---|
| HTTP API | `/api/support-chat/...` | `src/backend/routes.ts` |
| SSE событий | `support-chat.message.created`, `support-chat.thread.updated` | `src/contracts/index.ts` |
| Таблицы | `support_chat.threads`, `support_chat.messages` | `src/backend/schemas/` |
| Frontend-виджет | точка расширения `floating` | `src/frontend/setup.tsx` |
| Портал пользователя | роуты `/support`, `/support/new`, `/support/:id`, пункт навигации | `src/frontend/pages/my-threads`, `src/frontend/pages/my-thread` |
| Админ-приложение | сервис `admin:apps`, id `support-chat` | `src/frontend/setup.tsx` |
| DTO и константы | `@amplicada/module-support-chat/contracts` | `src/contracts/index.ts` |

## Карта документации

| Раздел | Файл |
|---|---|
| Первый контакт | — нет |
| Задачи | — нет |
| Справочник | [reference/](./reference/index.md) |
| Концепции | [explanation/](./explanation/index.md) |

## Карта покрытия

| Подсистема | Где описана |
|---|---|
| Точки расширения (сервисы, события) | [reference/api.md](./reference/api.md) |
| Вложения (хранилище, лимиты, доступ) | [reference/api.md](./reference/api.md) |
| HTTP API | [reference/api.md](./reference/api.md) |
| Схема БД и миграции | [reference/api.md](./reference/api.md) |
| Backend-сервис `support-chat` (задел под AI) | [reference/api.md](./reference/api.md) |
| Документы, списки, дашборд | — не используются (обычные таблицы модуля) |
| Задачи и фоновые процессы | — нет (SSE вместо воркеров) |
| Frontend (FSD, роуты, слоты) | [reference/api.md](./reference/api.md) |
| Конфиг: env, зависимости, порядок | [reference/api.md](./reference/api.md) |
| Интеграции и потребители | [reference/api.md](./reference/api.md) |
| Ограничения для потребителя | [explanation/realtime.md](./explanation/realtime.md), `ref/notes/module-support-chat.md` |

## Freshness

- Сверено с кодом: `2026-09-17`, коммит `5767b800`, рабочее дерево грязное (ветка `feat/support-chat-app`).
- Живой прогон API: «пользователь пишет → поддержка отвечает → прочтение → закрытие/переоткрытие»
  и SSE-доставка проверены против локального dev-стека; `appendMessage` от роли `ai`
  проверен прямым вызовом собранного сервиса.
- Не проверено вживую: визуальный вид виджета, админ-приложения и портальной страницы в браузере.
