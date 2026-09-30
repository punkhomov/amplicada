# Docs Two Tracks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Документация доступна в двух местах из одного источника `packages/*/docs/`: версионный per-module сайт на GitHub Pages (трек 1, первым) и встроенная справка установленной версии на самом инстансе (трек 2).

**Architecture:** Трек 1 — CI по тегу `<pkg>@vX.Y.Z` собирает VitePress только этого пакета в ветку `gh-pages` (`/<pkg>/<ver>/` + `/<pkg>/latest/` + `versions.json`), zip доки — в Release тега; Actions artifacts только транспорт. Трек 2 — backend `GET /api/help/:module/*` (whitelist + `audience`-фильтр + сессия) + React-вьювер (`react-markdown`/`remark-gfm`/`rehype-sanitize` в стилях кита), авторегистрация `/help/:module/*` и записи `admin:apps`. На инстансе одна версия — установленная.

**Tech Stack:** VitePress 1.x (трек 1, standalone — Vue не касается приложения), GitHub Actions + `gh-pages` branch, `react-markdown` + `remark-gfm` + `rehype-sanitize` (трек 2), Fastify 5, React 19 + React Router 7, `node:test`, Playwright (трек 2 смоук).

**Spec:** `ref/adr/08-docs-two-tracks.md` (план спорит от ADR — исполнитель читает оба).

**Статус: `draft` (2026-09-30).**

## Global Constraints

- Только `pnpm`; политика workspace (`ignoreScripts`, `trustPolicy: no-downgrade`, `minimumReleaseAge`) не меняется — новые зависимости вьювера проходят обычный гейт.
- `packages/*/docs` остаются чистым Markdown (VitePress-ready): без HTML/JSX — иначе поедет и Pages-сборка, и санитайзер трека 2.
- `ref/` не публикуется ни в треке 1, ни в треке 2.
- Обратная совместимость данных не требуется (политика проекта), но формат тегов `<pkg>@vX.Y.Z` фиксируется ADR и не меняется молча.
- Dev остановлен перед работой, поднят после (AGENTS.md).

## Review Focus

- Тег не того формата (`v1.0.0` без пакета) не должен деплоить доку молча — workflow падает с понятной ошибкой.
- `versions.json` после concurrent-релизов двух пакетов не должен терять записи (atomic update через чтения ветки `gh-pages`, не append вслепую).
- Prune не должен сносить `latest` и версии, на которые ссылается `_compat.json`/релизы.
- Вьювер не должен отдавать `audience: dev` наружу и рендерить сырой HTML из Markdown (XSS через community-модуль).
- Community-модуль без `docs/` не должен ломать каталог справки — тихое отсутствие, не 500.

---

### Task 0: Контракт `audience` + разметка существующих docs

**Files:**
- Modify: `packages/*/docs/**/*.md` (front matter += `audience: user|admin|dev`)
- Modify: `.agents/skills/module-docs/references/docs-templates.md` (поле `audience` в шаблон)

**Interfaces:**
- Produces: правило «один файл — одна аудитория», которое потребляют Task 2 (фильтр роутов) и Task 3 (бэкенд-фильтр).

- [ ] **Step 1:** Разметить существующие страницы: `tutorial.md` и пользовательские `how-to` → `user`; `reference/` → `admin`; `explanation/` → по смыслу; всё про внутренности — `dev`.
- [ ] **Step 2:** Обновить шаблон front matter в `module-docs` (`audience` обязательное).
- [ ] **Step 3:** Проверка: `vitepress build` любого пакета зелёный (VitePress роняет сборку на битых ссылках — уже тест).
- [ ] **Step 4:** Commit `docs: audience contract`.

### Task 1: Трек 1 — `docs-site/` + CI per-tag (первым)

**Files:**
- Create: `packages/docs-site/package.json`, `packages/docs-site/build-pkg.mjs` (копирует `packages/<pkg>/docs` → сборочный корень, подставляет `base: /<pkg>/<ver>/`, генерирует селектор версий из `versions.json`)
- Create: `.github/workflows/docs.yml` (триггер `push: tags: ['*@v*']`; джобы: validate-tag → build → deploy-gh-pages → release-zip)
- Create: `.github/workflows/docs-prune.yml` (крон, держать 5 миноров на пакет, не трогать `latest`)

**Interfaces:**
- Consumes: теги `<pkg>@vX.Y.Z` (парсинг `pkg`, `ver`; иное → fail с сообщением).
- Produces: `https://<owner>.github.io/<repo>/<pkg>/<ver>/`, `/<pkg>/latest/`, `versions.json`, `docs-<pkg>-<ver>.zip` в Release.

- [ ] **Step 1:** `docs-site/`: скрипт сборки одного пакета + локальный прогон `pnpm --filter docs-site build:pkg module-admin 0.0.0-test` → каталог с `index.html`.
- [ ] **Step 2:** `docs.yml`: validate-tag (regex `^[^@]+@v\d+\.\d+\.\d+$`), build, deploy в `gh-pages` (читать существующий `versions.json` из ветки → merge → push, не перезапись).
- [ ] **Step 3:** Релизный zip: `docs-<pkg>-<ver>.zip` аттачем к Release тега (долгоживущий архив; artifact шага — `retention-days: 1`, только транспорт).
- [ ] **Step 4:** Prune-workflow: старше 5 миноров на пакет удалять из `gh-pages`, из Releases не удалять.
- [ ] **Step 5:** Проверка живьём: тестовый тег `docs-site@v0.0.0-test` → curl `200` на `/docs-site/0.0.0-test/` и `/docs-site/latest/` + запись в `versions.json`; тестовый тег и папку удалить.
- [ ] **Step 6:** Commit `ci: per-module versioned docs`.

### Task 2: Трек 2 — backend `GET /api/help/:module/*`

**Files:**
- Modify: `packages/platform-core/src/contracts/backend/*` (контракт `help: DocsService` по образцу `storage`/`notification`), новый модуль или расширение core — решить в `setup` по месту (`packages/platform-core/src/backend/services/docs-service.ts`)
- Test: `packages/platform-core/src/backend/services/docs-service.test.ts`

**Interfaces:**
- `GET /api/help/:moduleId` → индекс (дерево из `index.md` + front matter), `GET /api/help/:moduleId/*path` → `{ title, body, audience, version }`.
- Фильтр: `audience: dev` не отдаётся никогда; `admin` — только аутентифицированным; чтение с диска пакета (`<pkgDir>/docs`), whitelist пути (нет `..`), установленный `version` из `package.json`.

- [ ] **Step 1:** Тесты: несуществующий модуль → 404; `..` → 400/404; `audience: dev` → 404 для всех; `admin` без сессии → 401.
- [ ] **Step 2:** Реализация сервиса + регистрация роутов в `setup` (образец: `storage-service.ts`).
- [ ] **Step 3:** `pnpm --filter <pkg> build && pnpm --filter <pkg> test`, плюс `app.inject()`-прогон роутов.
- [ ] **Step 4:** Commit `feat: help API`.

### Task 3: Трек 2 — фронтенд-вьювер + `registerModuleHelp`

**Files:**
- Create: `packages/platform-core/src/frontend/pages/help/...` (каталог, статья, сайдбар из индекса API) — стили кита, шина `useRequireAuth` по скопам
- Modify: `packages/module-admin/src/frontend/index.tsx` (авторегистрация `admin:apps` `{ id: 'help-<pkg>' }`), `apps/web` роут `/help/:moduleId/*` (layout `app`)
- Modify: `packages/*/package.json` (`files[]` += `docs`), контракты манифеста (`amplicada.docs` или наличие `docs/index.md` — зафиксировать в Task 3 решением)

**Interfaces:**
- Consumes: Task 2 API.
- Produces: `registerModuleHelp(context, { moduleId })` — модуль вызывает одной строкой в `setup()`; нет `docs/` → тихое отсутствие.

- [ ] **Step 1:** Зависимости вьювера (`react-markdown`, `remark-gfm`, `rehype-sanitize`) через обычный pnpm-гейт.
- [ ] **Step 2:** Страницы каталога и статьи + `rehype-sanitize` без исключений (попытка вставить `<script>` в тестовой md → вырезано).
- [ ] **Step 3:** Playwright-смоук (песочница, headless): логин → `/help/module-admin` рендерится; без логина user-статья доступна/недоступна согласно решению по скопам; dev-страница отсутствует в выдаче.
- [ ] **Step 4:** Commit `feat: in-app help viewer`.

### Task 4: Карты и закрытие

**Files:**
- Modify: `packages/<pkg>/docs/index.md` (карты покрытия, freshness), `ref/notes/<pkg>.md` (записи D-xxx: `rejected` SaaS/Outline, `deferred` FTS), `ref/README.md` (статус плана), `ref/context.md` (ключевые слова `help`, `versions.json`)

- [ ] **Step 1:** Обновить карты docs/notes по скиллу `module-docs` §3.
- [ ] **Step 2:** План → `status: implemented` (или подзадачи, оставшиеся открытыми, — явно списком).
