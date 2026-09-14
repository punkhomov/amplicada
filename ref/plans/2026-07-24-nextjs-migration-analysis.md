---
title: Переход на Next.js — анализ препятствий
type: plan
tier: 4
status: draft
date: 2026-07-24
---

# План: Переход на Next.js — анализ препятствий

> **Статус:** Draft.
>
> **Ключевой вывод:** Миграция возможна, но runtime module registration
> несовместима с SSR. Без немедленной потребности в SEO/SSR
> миграция неоправданна — текущая Vite SPA даёт ту же функциональность
> без накладных расходов Next.js.

---

## Контекст

Текущая архитектура:

- `apps/web` — Vite + React 19 SPA. Сборка, дев-сервер, прокси на API.
- `apps/api` — Fastify 5. Полностью отдельный процесс.
- Модули (`module-*`) — npm-пакеты с subpath exports: `./frontend`,
  `./backend`, `./contracts`. Фронтенд-модули импортируются в `main.tsx`.
- Роутинг: React Router v7, `createBrowserRouter`, дерево собирается
  через `buildModuleRouteTree(context)`.
- Компонентная подстановка: `context.slots.register()`, `context.extensions`
  — динамическая регистрация `Slot`/`ExtensionPoint` в рантайме браузера.
- Data fetching: TanStack React Query 5 — всё на клиенте.
- FSD v2.1: каждый модуль имеет `pages/`, `widgets/`, `features/`, `entities/`.

---

## Проблема 1. Extension-система несовместима с SSR

Текущий паттерн:

```tsx
// Модуль A
context.slots.register('employee-card', DefaultEmployeeCard);

// Модуль B (клиентская сборка)
context.slots.register('employee-card', CustomEmployeeCard);

// Потребление
<Slot name="employee-card" props={employee} />
```

`Slot` — runtime-механизм: регистрация происходит в `bootstrapFrontend()`,
компонент выбирается по строковому ключу в браузере. Next.js Server Components
не могут выполнить этот код — для SSR нужно знать точный компонент
на этапе сборки или запроса.

### Варианты решения

| Вариант | SSR | Сложность |
|---------|:---:|:---------:|
| **A.** Оставить `'use client'` на страницах со слотами | ❌ SSR не работает | Низкая |
| **B.** Build-time codegen: просканировать модули, смержить регистрации, сгенерировать `slots.ts` | ✅ | Высокая |
| **C.** Отказаться от runtime slots в пользу пропсов / compose-паттерна | ✅ | Средняя (рефакторинг модулей) |
| **D.** Next.js catch-all + React Router внутри (фактически SPA) | ❌ | Низкая |

**Вариант A** лишает смысла миграцию на Next.js.
**Вариант B** технически реализуем: скрипт анализирует вызовы
`context.slots.register` во всех модулях и генерирует статическую
таблицу компонентов. Но это ещё один слой сборки, который надо
поддерживать.
**Вариант D** — Next.js ради Next.js, без выгоды.

---

## Проблема 2. Программный роутинг vs файловая система

Сейчас:

```tsx
context.routes.register('/employees', <EmployeeListPage />, { layout: 'app' });
context.routes.register('/employees/:id', <EmployeeDetailPage />, { layout: 'app' });

// сборка
const router = createBrowserRouter([
  { element: <RootLayout />, children: buildModuleRouteTree(context) },
]);
```

Next.js App Router требует:

```
app/(app)/employees/page.tsx
app/(app)/employees/[id]/page.tsx
```

Модули не знают, где они будут лежать в файловой структуре Next.js.
Миграция означает перенос каждого `context.routes.register()` в файл
на диске. Для сохранения модульности — codegen (скрипт создаёт файлы
роутов на основе регистраций) или единый catch-all с ручным матчингом.

---

## Проблема 3. FSD + модули не ложатся на App Router

Сейчас структура модуля:

```
module-hr/
  src/
    frontend/
      pages/        ← страницы
      widgets/
      features/
      entities/
      shared/
```

В Next.js ожидается:

```
apps/web/
  app/
    (app)/
      employees/
        page.tsx    ← импортирует из module-hr
        [id]/
          page.tsx
```

Страницы физически переезжают в `apps/web/app/`. Модуль перестаёт
быть самодостаточным — его страницы размазаны по хостинговому
приложению.

### Варианты

- **Codegen:** скрипт на этапе `build` генерирует файлы в `apps/web/app/`
  на основе метаданных из модулей.
- **Catch-all + React Router:** всё живёт в `app/[[...slug]]/page.tsx`,
  модули не меняются. SSR не работает.
- **Monorepo-level Next.js config:** кастомный `loadConfig` импортирует
  страницы напрямую из модулей — не поддерживается Next.js.

---

## Проблема 4. Tailwind v4 через Vite-плагин

Сейчас Tailwind v4 подключён через `@tailwindcss/vite` — плагин Vite.
В Next.js Tailwind v4 работает через PostCSS (`postcss.config.mjs`
с `@tailwindcss/postcss`). Миграция тривиальна, но:

- Надо менять `postcss.config.mjs`.
- Надо проверять, что `@source`-директивы из модулей корректно
  сканируются через PostCSS (должно работать, но не тестировалось).

---

## Проблема 5. Vite-specific оптимизации

`vite.config.ts` содержит:

- `rollupOptions.output.manualChunks` — ручная нарезка чанков
  (vendor-react, vendor-charts, vendor-ui и т.д.).
- `tailwindcss()` + `react()` плагины.
- Dev-сервер с прокси `/api` → Fastify.

В Next.js:
- `manualChunks` аналога нет — Next.js сам решает, как нарезать бандл.
- Прокси настраивается через `next.config.js` → `rewrites()`.
- HMR качественно другой (Turbopack vs Vite).

---

## Проблема 6. React Router-зависимости

`apps/web` тянет `react-router-dom`. При переезде на Next.js App Router
React Router не нужен. Компоненты используют `<Link>`, `<Navigate>`,
`useNavigate()`, `useParams()`, `useSearchParams()`.

Миграция:

- `<Link to={...}>` → `import Link from 'next/link'`
- `useNavigate()` → `router.push()` из `next/navigation`
- `useParams()` → `params` prop в Server Component
- `useSearchParams()` → `useSearchParams()` из `next/navigation`
- `<Navigate to="/login" replace />` → `redirect()` или `router.replace()`

Работа есть, но она механическая. Главная проблема — композиция:
в React Router роуты собираются программно, в Next.js — статически.

---

## Резюме препятствий

| Препятствие | Серьёзность | Решение |
|-------------|:-----------:|---------|
| Extension-система (слоты) не работает в SSR | **CRITICAL** | Codegen или отказ от SSR |
| Программный роутинг несовместим с файловой структурой | **HIGH** | Codegen или catch-all SPA |
| Страницы модулей размазаны по `app/` | **HIGH** | Codegen или catch-all |
| Tailwind v4 плагин для Vite | **LOW** | PostCSS-миграция |
| Vite manualChunks / proxy | **LOW** | Rewrites в next.config |
| React Router → next/navigation | **MEDIUM** | Механический рефакторинг |

---

## Стратегия

### Фаза 0 (сейчас): ничего не делать

Vite SPA решает все текущие задачи. SSR не нужен — это бизнес-приложение,
не публичный сайт. Extension-система и модульный роутинг — ключевые
архитектурные фичи, которые Next.js не даёт бесплатно.

### Фаза 1 (когда понадобится SSR для публичных страниц)

Создать второй entry — `apps/web-portal`, Next.js-приложение, которое
импортирует **те же модули**, но рендерит выбранные страницы серверно:

- `apps/web` — основное SPA (остаётся на Vite).
- `apps/web-portal` — Next.js App Router с ограниченным набором
  публичных страниц (логин, портал сотрудника, лендинг).

Публичные страницы не используют слоты/extension points — значит,
проблемы 1-3 их не касаются. Модули поставляют только данные
(contracts + services), а не UI-компоненты со слотами.

### Фаза 2 (полная миграция, если необходимо)

Требует:
1. Build-time codegen для слотов, роутов, extension points.
2. Рефакторинг всех модулей: `useNavigate` → `next/navigation`.
3. Перенос страниц из модулей в `apps/web/app/` (codegen или руками).
4. Переход с Vite на Turbopack.

**Оценка:** 1-2 недели разработки codegen-инфраструктуры + 1 неделя
на миграцию каждого модуля, который использует слоты.

---

## Связанные документы

- `adr/01-architecture.md` — архитектурные решения (модульность, core)
- `guides/module-system.md` — модульная система, FrontendSetupContext
- `plans/2026-07-13-frontend-core-reorg.md` — как появилась текущая
  extension-система
- README — стек технологий