---
title: "platform-core — обзор"
type: index
package: platform-core
updated: 2026-09-30
verified_commit: 61bed2d7
---

# platform-core

> Потребительская документация. Рационал решений, отвергнутые альтернативы и известные
> пробелы — в `ref/notes/platform-core.md`.

`platform-core` — инфраструктурный пакет платформы: backend-каркас (роутинг, миграции,
документный рантайм, хранилище, задачи, сервисы) и frontend-каркас (FSD-слои, реестры,
роуты, слоты, UI-кит).

Документация пакета начата с UI-кита; остальные подсистемы пока не описаны (см. карту
покрытия). Осознанно не входит: бизнес-логика модулей — она живёт в `module-*`.

## Публичная поверхность (описанная часть)

| Что | Как | Где в коде |
|---|---|---|
| Компоненты UI | deep import `@amplicada/platform-core/frontend/ui/<name>` | `src/frontend/ui/*.tsx` |
| Токен `cn` | `export { cn }` из `cn` | `src/frontend/lib/utils.ts`, `src/frontend/index.ts:65` |
| Синхронизация кита | `pnpm --filter @amplicada/platform-core ui:sync \| ui:check` | `scripts/shadcn-sync.mjs` |
| Точки расширения UI | `context.extensions.contribute('<id>', { component })` | `src/frontend/registries/extension-point.ts` |
| Сервис storage | `context.services.resolve<BackendStorageService>('storage')` | `src/backend/services/storage-service.ts` |
| Сервис notification | `context.services.resolve<BackendNotificationService>('notification')` — контракт v2 | `src/backend/services/notification-service.ts` |

## Карта документации

| Раздел | Файл |
|---|---|
| Первый контакт | — нет |
| Задачи | [how-to/](./how-to/index.md) |
| Справочник | [reference/](./reference/index.md) |
| Концепции | [explanation/](./explanation/index.md) |

## Карта покрытия

| Подсистема | Где описана |
|---|---|
| Точки расширения (сервисы, токены) | — нет |
| Сервис storage (S3) | [reference/storage.md](./reference/storage.md) |
| Уведомления: сервис, шаблоны, outbox | [reference/notifications.md](./reference/notifications.md) |
| HTTP API | — нет |
| Схема БД и миграции | — нет |
| Документы, списки, дашборд | — нет |
| Задачи и фоновые процессы | — нет |
| Frontend: UI-кит | [reference/ui-kit.md](./reference/ui-kit.md) |
| Frontend: реестры, роуты, слоты, layouts | [reference/frontend-extension-points.md](./reference/frontend-extension-points.md) (точки расширения); остальное — нет |
| Конфиг: env, порядок загрузки | — нет |
| Интеграции и потребители | — нет |
| Ограничения для потребителя | [reference/ui-kit.md](./reference/ui-kit.md) (кит); остальное — нет |

## Freshness

- Сверено с кодом: `2026-09-30`, коммит `0551349`, ветка `feat/notifications` (контракт
  уведомлений v2, ADR-07).
- Storage проверен живым прогоном: API (листинг по папкам, `Range`/`206`, `inline`/`attachment`,
  CSP `sandbox`, загрузка, рекурсивное удаление) и браузерный e2e-смоук страницы `/admin/storage`
  в Playwright (логин, загрузка, превью текста/изображения, скачивание, навигация по папкам,
  удаление файла и папки). Найденный дефект SeaweedFS (пустая папка после удаления) закрыт
  добивкой маркера в `deletePrefix`. `copyObject`/`deleteObjects`, батчинг `deletePrefix` и
  оба режима `listObjects` (drain-all по умолчанию и постраничный `maxKeys`/`nextToken`)
  покрыты unit-тестами сервиса.
- Не проверено вживую: браузерный смоук `message-scroller`, `questionnaire`, `toast`;
  визуальная регрессия остальных компонентов после синка.
