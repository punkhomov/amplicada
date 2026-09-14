---
title: amplicada — Active Project Context
type: context
tier: 2
date: 2026-08-08
---

# amplicada — Active Project Context

Platform for modular business applications. Compile-time modules as npm packages. Each client gets a custom build with selected modules. One core package (`@amplicada/platform-core`), feature modules extend it.

## Key Concepts

- **Core owns identity** — `identity_user` table (id, login, created_at). Modules extend via FK (`password_credential.user_id` references `identity_user.id`).
- **`core.document_index` первичен** — id документа рождается там (`allocateDocumentId`), там же живёт состояние (`deleted_at`, `stale`, actor-штампы). Своей «базовой таблицы» у типа документа нет: все данные пишут расширения. Любая вставка документной строки в обход рантайма обязана сначала взять id из индекса — иначе FK.
- **One package per module** — not split frontend/backend. Subpath exports (`./backend`, `./frontend`, `./contracts`) prevent React leaking into backend.
- **Server-side sessions** — `@fastify/session` + Redis. HMAC-signed cookie. `AuthServiceImpl` uses `request.session.set/get/destroy`.
- **Per-module Drizzle migrations** — each module has its own `migrations/` with independent `_journal.json`. Bootstrap: core migrations → module migrations → routes → start.
- **Frontend extension system** — `ModuleRoutes` groups routes by layout, `Slot` replaces components, `ExtensionPoint` adds UI contributions.
- **Headless UI** — core provides logic+a11y without styles. Apps style via Tailwind. Modules consume from slots.
- **Tailwind v4** — each module has `tailwind.css` with `@source "../"` to scan its files. Apps import these via `@import` in `index.css`.
- **Auth redirect on 401** — global `QueryCache`/`MutationCache` `onError` + `useCurrentUser` сохраняют `auth:redirect` в `sessionStorage`. `LoginPage` читает и редиректит после входа.
- **FSD v2.1 for frontend** — каждый модуль следует Feature-Sliced Design (ADR-003). Слои: `app/`, `pages/`, `widgets/`, `features/`, `entities/`, `shared/`. Импорт только вниз. Public API через index.ts.

## Keywords for Searching

| Keyword | Where |
|---------|-------|
| `BackendModule`, `FrontendModule` | contracts/frontend/module.ts, contracts/backend/module.ts |
| `FSD`, `Feature-Sliced Design` | ADR-003, ref/guides/module-structure.md |
| `FrontendSetupContext` | 9 registries: layouts, routes, slots, extensions, navigation, modules, services, eventBus, lifecycle |
| `BackendSetupContext` | 10 registries: services, routes, extensions, registry, modules, eventBus, lifecycle, pipeline, migrations, documents |
| `createApp`, `bootstrap` | backend/app.ts — backend entry point |
| `createFrontendApp`, `bootstrapFrontend` | frontend/app.tsx — frontend entry point |
| `ModuleRoutes` | frontend/components/module-routes.tsx — layout grouping |
| `layouts.register("public")`, `"app"` | Default layouts registered in createFrontendApp |
| `@source "../"` | Tailwind v4 — scan module source for classes |
| `@import "...tailwind.css"` | Must be in apps/web/src/index.css per module |
| `bcrypt.compare` | Password hashing in module-auth-password/backend/plugin.ts |
| `PasswordAuthProvider` | auth-password JOINs identityUser + passwordCredential |
| `BackendStorageService`, `StorageServiceImpl` | S3-compatible object storage, service token `storage` — contracts/backend/storage.ts, backend/services/storage-service.ts |
| `allocateDocumentId`, `indexCreated` | document-runtime.ts — резервирование id в `core.document_index` перед вставкой строки |
| `writeVersion`, `versionWriteMode`, `CARD_CORRECTION` | module-hr: коррекция записи vs новый интервал версии |
| `getObjectStream`, `StorageGetStreamOptions` | потоковое чтение из S3 с `Range` → `206` |

## Current Priorities

1. **Прогнать накопленное на живой БД.** Код с 2026-07-16 не проверялся против Postgres — включая
   переделку документной модели и переименование таблиц/типов. Сводный чек-лист — пункт 0 в
   `plans/2026-08-08-tech-debt-audit.md`.
2. **`module-hr-learning`** — курсы и SCORM-плеер, `plans/2026-08-08-module-learning/`. Блокеры в core
   (стриминг, `Range`, пагинация `listObjects`) закрыты, `04` (модель) и `02` (приём пакета) написаны
   и не прогнаны живьём. **Админская загрузка пакета сделана 2026-08-11**: панель контента на карточке курса — заливка с
   прогрессом, история версий, выбор текущей, опрос статуса распаковки. Попутно закрыты две дырки
   платформы — `documentId` в `DocumentCardContext` и разбор `{ error }` в `api-client` (до этого
   текст **любой** серверной ошибки выбрасывался, все 54 обработчика отвечают `{ error }`).
   **Подпланы `03` (раздача) и `05` (рантайм) сделаны 2026-08-11**: курс играет, `scorm-again` вживляется в точку входа
   внутри песочницы, коммиты пишутся в попытку. **SCORM 2004 поддержан наравне с 1.2.** Живьём
   не прогонялось. Главный риск к проверке — вложенные фреймы внутри пакета: у них свой opaque
   origin, и курс вроде Storyline до `window.parent.API` не дотянется. Дальше — `06` (каталог,
   назначение) и `07` (отчётность). Разбор пакетов вынесен в
   `packages/learning-parser`, план его развития — `plans/2026-08-09-learning-parser/` **закрыт
   целиком 2026-08-09**: все шесть фаз сделаны, форматы разбираются в глубину. Открытым осталось
   одно — имена записей ZIP в CP866 (развилка в подплане `03`).
   **Новый план `plans/2026-08-10-learning-parser-parity/`**: тот план мерил глубиной разбора, а
   мерить надо было пригодностью к употреблению. Библиотека разбирает формат глубже образца, но не
   умеет открыть zip — реализаций `PackageSource` она не поставляет, связка живёт у потребителя.
   Пять подпланов: входные двери, корпус ADL + сверка покрытия, XSD (`needs-decision`), опции
   разбора, поверхность и публикуемость. **`01` сделан 2026-08-10**: `zipSource`, `fileSource`,
   `directorySource`; контракты не менялись, `sourceOf` уехал из модуля в библиотеку. **`02` часть A
   сделана**: корпус из 209 настоящих пакетов (ADL CTS целиком), проходит без ошибок; найденные
   расхождения разобраны — два наших правила убраны как ложно срабатывающие на конформном контенте,
   рёберная форма `.pre` читается. **`04` (опции разбора) сделан**: `ParseOptions`
   со `strictness` и `disableRules`, реестр `ISSUE_CODES` из 35 кодов. **`05` сделан функционально**:
   объём пакета, вторые формы (`alsoDetected`), тест на JSON round-trip, `README` с таблицей кодов.
   Публикация упирается в настройку remote у репозитория.
   **Подплан `02` закрыт целиком**: из 141 файла образца 84
   про устройство Java-программы, из остальных 57 — `есть` 48, `иначе` 9, **`нет` 0**. Найденные
   сверкой четыре пробела закрыты 2026-08-11:
   подманифесты (`SubManifest`, поле `subManifests`), `contextTemplate` cmi5 на курсе и на единице,
   все языки подписей на пункте (`titles`/`descriptions`, у всех пяти форматов),
   `typicalLearningTimeSeconds` наверху. **Осталось по плану паритета: только `03` (XSD,
   `needs-decision`) и публикация.**
3. **Хвосты документной модели** — `plans/2026-08-05-document-model/`: `07` (расширения вхолостую,
   нужно решение) и `08` (валидация, оптимистичная блокировка, программный API).

4. **Технический долг** — `plans/2026-08-08-tech-debt-audit.md`: нереализованный `widget: 'reference'`
   (поля-ссылки редактируются вписыванием UUID), `exportData` без `id`, отсутствие `drizzle-kit` и CI.
