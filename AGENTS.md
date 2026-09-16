# System Instructions

## Codebase Navigation & Analysis
- **First**: When exploring the project, start with `ref/README.md` (document map) and `ref/context.md` (active context).
- **Before changing a package**: read `packages/<pkg>/docs/index.md` + `ref/notes/<pkg>.md` — accepted decisions, rejected alternatives and known gaps live there; don't re-propose without new evidence. Writing/updating them — skill `module-docs`.
- **Primary**: Use `codebase-memory-mcp` tools for searching, exploring and analysis (project=path-to-the-project-amplicada). Fallback to grep/glob when MCP unavailable. `search_graph`/`trace_path`/`get_architecture` work well; `search_code` is weaker than plain grep (its `path_filter` is a regex over the full path, not a glob).
- **External docs**: Use `Context7` MCP for third-party library docs (React, Fastify, Drizzle, etc.).

## Dependency Management
- `pnpm install` only. No npm/yarn.

## Build & Scripts
- Use `pnpm` scripts for everything. Turborepo orchestrates builds.
- `pnpm build` — topological (core → modules → apps). `pnpm dev` — persistent watch.
- All packages build with bare `tsc`. Only `apps/web` uses Vite.
- All packages extend root `tsconfig.json` with `"extends": "../../tsconfig.json"`.

## Package Structure

Every package shares the same layout:

```
package/
├── src/
│   ├── contracts/     ← shared types (used by both backend & frontend)
│   ├── backend/       ← Fastify code
│   │   ├── index.ts   ← barrel export
│   │   ├── setup.ts   ← module registration hook
│   │   ├── schemas/   ← Drizzle ORM table definitions
│   │   ├── documents/ ← entity wrappers (access patterns over schemas)
│   │   ├── services/  ← business logic (optional)
│   │   └── routes/    ← Fastify route handlers (optional)
│   └── frontend/      ← React code
│       ├── index.ts   ← barrel export
│       ├── setup.tsx  ← module registration hook
│       ├── components/← reusable UI components
│       ├── pages/     ← route-level pages
│       └── lib/       ← utilities, registries
├── migrations/        ← Drizzle SQL migrations
├── package.json       ← triple-export pattern (see below)
└── tsconfig.json
```

This layout is identical for `platform-core` and every module. Modules and core use the same conventions (`documents/`, `schemas/`, `services/`, `routes/`).

### Triple-export pattern

Every package exposes exactly 4 entry points in `package.json`:
- `./backend` → `dist/backend/index.js`
- `./frontend` → `dist/frontend/index.js`
- `./contracts` → `dist/contracts/index.js`
- `./frontend/tailwind.css` → `src/frontend/tailwind.css`

## Data & Migrations Policy

Проект в активной разработке, продакшена нет, данные в БД одноразовые.

- **Обратная совместимость данных не требуется.** Не писать миграции ради сохранения пользовательских
  данных (сохранённые настройки таблиц, фильтры, черновики и т.п.) — при поломке формата база
  сбрасывается (`docker compose down -v`).
- **Схемные миграции пишутся всегда** — они нужны, чтобы bootstrap с нуля поднимался.
- **Каждый такой пропуск отмечать**: в плане или описании изменения явно писать, что
  формат сломан без миграции и почему это допустимо. Когда продакшен появится, этот список —
  исходник для решения, что делать.

## Key Conventions

- **Service Locator**: `context.services.resolve('serviceName')` — singular, no DI container.
- **Module registration**: backend `setup(registry, context)`, frontend `setup(registry)` — called by app bootstrap.
- **Extension points**: both backend and frontend registries support extension points for cross-module hooks.
- **Workflow engine**: BPM-like engine in `module-workflow`. Other modules register delegates via `extension-point`.
- **Drizzle schemas**: every entity has a `schema/*.ts` (table def) and `documents/*.ts` (typed access layer).
- **Migrations**: per-package in `migrations/`, applied at bootstrap by drizzle's runtime migrator. `drizzle-kit` is **not** wired up — SQL files and `migrations/meta/_journal.json` are written by hand.
- **Document ids come from the index**: `core.document_index` is the primary table — it issues ids and holds document state. Any code inserting a document row outside `DocumentRuntime` must take its id from `allocateDocumentId(type, tx)` first, or the FK will reject it.

## Project Layout

```
amplicada/
├── packages/
│   ├── platform-core/          ← infrastructure (routing, auth, event bus, migrations, document runtime, storage, tasks)
│   ├── module-auth-password/   ← password auth (bcrypt + server sessions)
│   ├── module-hr/              ← HR entities (org structure, Node+Version). Has its own docs/ (Diátaxis)
│   ├── module-hr-request/      ← request portal on top of workflow
│   ├── module-hr-poll/         ← polls and poll responses
│   ├── module-workflow/        ← BPM engine (processes, nodes, transitions, delegates)
│   ├── module-admin/           ← management UI over core infrastructure
│   ├── module-hr-appraisal/    ← placeholder
│   ├── module-hr-assessment/   ← placeholder
│   ├── module-hr-learning/     ← placeholder
│   ├── module-social-blog/     ← placeholder
│   └── module-social-messenger/← placeholder
├── apps/
│   ├── api/                    ← Fastify server entry (imports active modules, bootstraps)
│   └── web/                    ← Vite + React SPA entry (imports active modules, renders)
├── ref/                        ← documentation (ADR, plans, guides)
└── turbo.json                  ← Turborepo config (build/dev/typecheck tasks)
```

### Apps entry points

- `apps/api/src/index.ts` — creates Fastify app, imports all active modules, calls `bootstrap`, listens on `:3000`.
- `apps/web/src/main.tsx` — React entry, imports all frontend modules, renders `<FrontendProvider>`.

### Build order

`platform-core` → modules → `apps/api` + `apps/web`

## Empty modules

`module-hr-appraisal`, `module-hr-assessment`, `module-hr-learning`, `module-social-blog`, `module-social-messenger` are **empty directories** — no `package.json`, no source, not pnpm workspace members, and not in git at all (git does not track empty dirs). They are placeholders for planned work, nothing more. Do not look for code there, and do not assume the directory exists in a fresh clone.

## Documentation (`ref/`)

| Need | Go to |
|------|-------|
| Document map + rules | `ref/README.md` |
| Active context (loaded into prompt) | `ref/context.md` |
| Package docs for consumers (Diátaxis, VitePress-ready) | `packages/<pkg>/docs/index.md` |
| Why a package works this way (rationale, rejected, gaps) | `ref/notes/<pkg>.md` |

Tiers: `adr/` (architecture decisions), `notes/` (package rationale), `plans/` (target state), `guides/` (how-to).

After meaningful work, update relevant plans, guides, package docs (`packages/<pkg>/docs/`) and `ref/notes/<pkg>.md`. Mark outdated docs `status: superseded`.

## Tech Stack (quick ref)

- Runtime: Node 20+, pnpm 11.10, TypeScript 7 (type stripping, no build step aside from tsc)
- Backend: Fastify 5, Drizzle ORM 0.45 (PostgreSQL), Pino, Redis
- Frontend: React 19, React Router 7, TanStack React Query 5, Tailwind CSS v4, shadcn/ui
- Workflow: @xyflow/react (visual editor)
- Linting: Biome 2.4
