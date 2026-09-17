---
title: Вендоренный UI-кит — состояние
type: notes
tier: 2
status: implemented
date: 2026-09-17
---

# UI-кит: состояние

Источник истины — реестр `base-nova` и команда
`pnpm --filter @amplicada/platform-core ui:sync` (скачивает весь индекс).
Потребительский справочник — `packages/platform-core/docs/reference/ui-kit.md`,
рационал — `ref/notes/platform-core.md`.

## Синхронизируются (`add --all`)

```
accordion alert alert-dialog aspect-ratio attachment avatar badge breadcrumb bubble button
button-group calendar card carousel chart checkbox collapsible combobox command context-menu dialog
direction drawer dropdown-menu empty field hover-card input input-group input-otp item kbd label
marker menubar message message-scroller native-select navigation-menu pagination popover progress
questionnaire radio-group resizable scroll-area select separator sheet sidebar skeleton slider
spinner switch table tabs textarea toast toggle toggle-group tooltip
```

Плюс `hooks/use-mobile.ts` (registry-зависимость `sidebar`). Реестровый `form` пишется
в `field.tsx`.

## Вне синхронизации

| Файл | Причина |
|---|---|
| `ui/sonner.tsx` | `sonner` отсутствует в индексе реестра `base-nova`; обновляется руками |
| `ui/ext-table.tsx` | собственный компонент, не из реестра |

## Статусы реестра

| Компонент | Статус |
|---|---|
| `toast` | deprecated в реестре (замена — `sonner`), но установлен и обновляется |
| `message-scroller`, `questionnaire` | установлены 2026-09-17, runtime-примитивы `@shadcn/react@0.3.1` |

Composite-примеры из документации shadcn (`data-table`, `date-picker`, `typography`)
не устанавливаются — это страницы-рецепты, не registry:ui.
