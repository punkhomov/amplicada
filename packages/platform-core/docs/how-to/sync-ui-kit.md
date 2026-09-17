---
title: "Как обновить или добавить компонент UI-кита"
type: how-to
updated: 2026-09-17
verified_commit: ce72875d
order: 10
---

# Как обновить или добавить компонент UI-кита

Для кого: разработчик `platform-core`. Предполагается: Node 24+, `pnpm install` выполнен.

## Предусловия

- Рабочее дерево чистое или изменения закоммичены: синк перезаписывает файлы поверх,
  и `git diff` — единственный способ увидеть, что изменил upstream.
- Есть сеть: CLI тянет реестр `ui.shadcn.com`.

## Шаги

### Обновить все компоненты

```bash
pnpm --filter @amplicada/platform-core ui:sync
```

Скрипт скачивает весь индекс реестра (`add --all --yes --overwrite`), переписывает
`src/frontend/ui/*` и нормализует импорты: alias → относительные с `.js`, снимает
`"use client"`. Установка зависимостей перехватывается шимом — `package.json` не меняется.

### Добавить или обновить один компонент

```bash
pnpm --filter @amplicada/platform-core ui:sync dialog tooltip
```

### Если реестр требует новые зависимости

CLI их не поставит (установка перехвачена). Посмотри вывод `shadcn` в конце синка,
выбери версию, проходящую политику возраста (`pnpm-workspace.yaml`), и добавь вручную:

```bash
pnpm add --filter @amplicada/platform-core <pkg>@<version>
```

## Проверка

1. `pnpm --filter @amplicada/platform-core ui:check` — второй прогон не должен ничего находить.
2. `git diff` — в диффе только изменения upstream и замена `@/...`-импортов; «шумных»
   переписываний (`"use client"`, `clsx`) быть не должно.
3. `pnpm typecheck && pnpm build` — типы и сборка по всей монорепе.
4. Если затронуты новые компоненты (`message-scroller`, `questionnaire`) — прогнать
   приложение в браузере (`pnpm dev`).

## Связанное

- [Справочник по UI-киту](../reference/ui-kit.md)
- [Почему кит вендорится и как устроен синк](../explanation/ui-kit-vendoring.md)
