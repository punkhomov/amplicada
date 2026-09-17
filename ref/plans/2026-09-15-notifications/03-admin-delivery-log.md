---
title: Админ-лог доставок уведомлений
type: plan
tier: 2
status: implemented
date: 2026-09-15
---

# 03. Админ-лог доставок

## Текущая проблема

Outbox с ретраями без видимости бесполезен: «письмо не пришло» нельзя отличить от «канал не
настроен», «адрес не подтверждён» и «SMTP отбил». Диспетчер пишет `last_error`, но смотреть его
можно только в БД.

## Решение

В `module-admin` — страница `/admin/notifications`: список доставок с фильтрами и ручным повтором,
поверх `listDeliveries`/`retry` из core-сервиса ([01](./01-core-service-and-outbox.md)). Это даёт
замкнутую проверку всей цепочки outbox → dispatcher → UI и точку операционной отладки почты.

## Backend

`packages/module-admin/src/backend/routes/notifications.ts` — под общим guard'ом `/api/admin`
(как остальные роуты admin):

| Метод | Путь | Поведение |
|-------|------|-----------|
| `GET` | `/notifications` | `listDeliveries({ status, kind, userId, limit, offset })` → `{ items, total }`; дефолт `limit=50`, максимум 200 |
| `POST` | `/notifications/:id/retry` | `retry(id)`; `{ ok: true }` или 404, если строку нельзя вернуть в pending |

Регистрация: `createNotificationRoutes(fastify, context)` в `module-admin/src/backend/index.ts`
внутри существующего плагина; сервис — `context.services.resolve<BackendNotificationService>('notification')`.

Там же — пункт на дашборде (`context.documents.dashboard.registerLink`):

```ts
context.documents.dashboard.registerLink('notifications', {
  path: '/admin/notifications',
  topic: DashboardTopics.SYSTEM,
  label: 'admin:dashboard_link_notifications',
  order: 30,
});
```

## Frontend

`packages/module-admin/src/frontend/pages/admin-notifications/` — по образцу `admin-task-detail`
(собственная страница под `layout: 'admin'`, loader с `ensureQueryData`).

- Контракты страницы — в `module-admin/src/contracts` (`NotificationDeliveryRow`, ответ списка) или
  реэкспорт `NotificationDelivery` из core-контрактов; админ-контракты уже собираются там, продолжить
  эту линию.
- Запрос: `['admin', 'notifications', { status, kind, userId, page }]` → `api.get('/admin/notifications', { query })`.
- Таблица: колонки **Создано · Канал · Kind · Получатель (userId/email) · Статус · Попытки · Ошибка**,
  действие **«Повторить»** для `failed`.
- Фильтры: статус (select: все/pending/sent/failed), kind (текст), userId (текст); пагинация
  limit/offset.
- Бейдж статуса из core UI (`Badge`), кнопки — `Button`, таблица — по образцу `admin-task-detail`.
- Роут `/admin/notifications` регистрируется **специфичным** путём — React Router ранжирует статический
  сегмент выше `/admin/:type`, конфликта с generic-списком документов нет.
- Locales `admin` (ru/en): заголовок, колонки, статусы, пустое состояние, ошибка.

## Изменения по файлам

| Файл | Действие |
|------|----------|
| `module-admin/src/backend/routes/notifications.ts` | + роуты списка/повтора |
| `module-admin/src/backend/index.ts` | регистрация роутов + dashboard link |
| `module-admin/src/frontend/pages/admin-notifications/**` | + страница, query-опции, loader |
| `module-admin/src/frontend/index.tsx` | + роут `/admin/notifications` |
| `module-admin/src/frontend/locales/{ru,en}.json` | + строки |
| `module-admin/src/contracts/**` | + типы строки доставки (или реэкспорт core) |

## Порядок реализации

- [x] Backend-роуты + dashboard link
- [x] Страница + роут + loader
- [x] Locales ru/en
- [x] `pnpm build && pnpm typecheck && pnpm lint`

## Проверка

1. Пустой outbox → страница показывает пустое состояние, а не ошибку.
2. `sent`-строка → видна со статусом `sent`, без кнопки повтора.
3. Строка `failed` (искусственно испортить SMTP) → видна, `last_error` показан, «Повторить» переводит
   в `pending`, диспетчер доставляет после починки SMTP.
4. Фильтры: статус/kind/userId сужают список; пагинация листает.
5. Пункт «Уведомления» на дашборде ведёт на страницу.
