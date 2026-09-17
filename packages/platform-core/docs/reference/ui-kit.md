---
title: "UI-кит: вендоренные компоненты shadcn/ui"
type: reference
updated: 2026-09-17
verified_commit: ce72875d
order: 10
---

# UI-кит: вендоренные компоненты shadcn/ui

Справочник по вендоренному UI-киту `platform-core`: что лежит в `src/frontend/ui/`
и `src/frontend/hooks/use-mobile.ts`, как он подключается потребителями и чем
управляется синхронизация с upstream.

## Где что лежит

| Что | Путь в коде | Комментарий |
|---|---|---|
| Компоненты | `src/frontend/ui/*.tsx` (63 файла) | upstream shadcn/ui, style `base-nova` (примитивы Base UI) |
| Хук сайдбара | `src/frontend/hooks/use-mobile.ts` | приходит как registry-зависимость `sidebar` |
| Конфиг shadcn | `components.json` | alias `ui` → `@/ui`, CSS → `src/frontend/styles/base.css` |
| Скрипт синхронизации | `scripts/shadcn-sync.mjs` | CLI + постпроцессор импортов |
| Токен `cn` | `src/frontend/lib/utils.ts` | `export { cn } from 'cn'` |
| Тема и токены | `src/frontend/styles/base.css` | `@theme inline` + CSS-переменные, обновляется CLI |

## Подключение потребителем

Компоненты — часть публичной поверхности через deep import:

```tsx
import { type ApiClient, useApiClient } from '@amplicada/platform-core/frontend';
import { Card, CardContent, CardHeader } from '@amplicada/platform-core/frontend/ui/card';
```

Публичный export `subpath` — `./frontend/*` в `package.json` (`types`/`import` → `dist/frontend/*`).
Внутри репозитория модули (например `module-admin`) импортируют так же — и в исходниках,
и после сборки.

`cn` доступен двумя способами: из пакета `cn` напрямую (так делают вендоренные файлы)
и из барреля `@amplicada/platform-core/frontend` (`src/frontend/index.ts:65`).

## Инварианты вендоренных файлов

- Импорты только относительные, с расширением `.js` (`./button.js`, `../hooks/use-mobile.js`).
  Абсолютные alias-пути (`@/ui/...`) запрещены: `tsc` не переписывает пути при emit,
  и собранный `dist` сломался бы у потребителей.
- Директива `"use client"` снята (это не RSC-приложение). upstream CLI 4.21 её оставляет,
  зачистка — часть `ui:sync`.
- Локальные правки в `src/frontend/ui/**` и `hooks/use-mobile.ts` не вносятся: следующая
  синхронизация перезапишет файл. Кастомизация — через обёртки, `className` или
  собственные файлы рядом (`ext-table.tsx` — исключение, он не из реестра).
- Biome не проверяет и не форматирует `ui/` и `hooks/use-mobile.ts` — формат upstream
  сохраняется как есть (`biome.json`).

## Синхронизация

| Команда | Что делает |
|---|---|
| `pnpm --filter @amplicada/platform-core ui:sync` | скачивает/перезаписывает все компоненты (`add --all --yes --overwrite`) и нормализует импорты |
| `pnpm --filter @amplicada/platform-core ui:sync button card` | точечно обновляет/добавляет компоненты |
| `pnpm --filter @amplicada/platform-core ui:check` | офлайн-проверка нормализации; падает, если остались alias-импорты или `"use client"` |

Установка зависимостей при синке перехватывается (шим `pnpm`/`npm`/`yarn`/`bun`):
CLI пишет только файлы, зависимости репозитория не трогает. Новые зависимости реестра
добавляются руками. Пошагово — [Как обновить UI-кит](../how-to/sync-ui-kit.md).

## Зависимости кита

| Пакет | Зачем | Версия |
|---|---|---|
| `cn` | слияние классов, замена `clsx` + `tailwind-merge` | `0.2.6` |
| `@shadcn/react` | примитивы `message-scroller` и `questionnaire` | `0.3.1` |
| `@base-ui/react` | примитивы остальных компонентов | `^1.7.0` |
| `shadcn` | CLI синхронизации, `@import "shadcn/tailwind.css"` в `base.css` | `^4.21.0` |
| `recharts` | `chart.tsx` | `3.10.1` |

## Ограничения

- `sonner.tsx` и `ext-table.tsx` вне потока синхронизации: `sonner` больше не входит
  в индекс реестра, `ext-table` — собственный компонент. Оба обновляются руками.
- `toast.tsx` в реестре помечен deprecated (замена — `sonner`) и обновляется как все.
- Версия `cn` зафиксирована; апгрейд до `0.3.x` — плановая задача после выхода
  версии из карантина `minimumReleaseAge` (см. `ref/notes/platform-core.md`).
- Браузерный смоук `message-scroller` и `questionnaire` не прогонялся.
