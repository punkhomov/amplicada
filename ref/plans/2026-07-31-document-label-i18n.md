---
title: Перевод document/field label'ов (backend-side, через request.t)
type: plan
tier: 4
status: implemented
date: 2026-07-31
---

# План: перевод document/field label'ов

**Статус (2026-07-31):** Реализовано полностью. Фаза A (резолвер + все 5 роутов +
`exportDataFiltered`-исключение) и Фаза B/C (перевод label'ов во всех модулях, включая
`module-hr-request`, изначально пропущенный при скоупинге плана — см. таблицу ниже) — готовы.
По ходу вскрылся и починен независимый баг инфраструктуры — см. "Незапланированная находка" ниже.

Третий кусок i18n-работы этой сессии, после `ref/plans/2026-07-13-i18n.md` (frontend UI-строки) и
`ref/plans/2026-07-31-backend-i18n.md` (backend error messages, Фаза A). Отдельный план, а не
продолжение первых двух — механизм принципиально другой (см. "Решение").

## Текущая проблема

Document/field-метаданные (`FieldMetadata.label`/`helpText`/`placeholder`/`options[].label`,
`ListFieldMeta.label`, `DocumentType.label`, `DashboardTopic`/`Section`/`Link`/`Item`.label) —
~260 строк на русском, зашитых прямо в `label: 'Подразделения'`-литералы при регистрации типов
документов (`docs.register`, `docs.objects.extend`, `docs.lists.extend`,
`docs.dashboard.registerTopic/Section/Link`) в ~30 файлах разных модулей. Эти строки едут по HTTP
как есть и рендерятся дженерик-компонентами (`field-widget.tsx`, `admin-document-card.tsx`,
`admin-document-list.tsx`, `admin-dashboard.tsx`) без единого `t()`.

## Решение: backend-side, не frontend-side

Рассматривался вариант "backend отдаёт ключ, фронт переводит через уже готовый i18next" (дешевле:
ноль нового backend-кода, переиспользует всю инфраструктуру из `2026-07-13-i18n.md`). Отклонён по
двум причинам:

1. **Владение.** Document/field-система — backend-концепция (`contracts/documents.ts`), её
   регистрируют backend-модули. Разнесение "что такое поле" (backend) и "как оно называется"
   (frontend locale-файл) — рассинхронизация владения: разработчик добавляет поле в одном пакете,
   обязан не забыть добавить перевод в другом.
2. **Экспорт CSV/JSON — не React.** `admin-document-list.tsx`'s `handleExport`/`handleExportView`
   и `admin-import-dialog.tsx`'s чтение `column.label`/`type.label` работают с `label` как с сырым
   содержимым файла — заголовки колонок CSV, `typeName` в алерте импорта. Это не проходит через
   React-рендер, `t()` там взять неоткуда. Если `label` станет ключом, выгруженный файл покажет
   пользователю `hr:department_label` вместо текста — конкретная, не гипотетическая поломка.

Значит перевод должен произойти **на бэкенде**, до отправки ответа. Здесь используется та же
`request.t`-инфраструктура, что и в `2026-07-31-backend-i18n.md` (Фаза A) — наконец находится ей
применение.

## Ключевое архитектурное решение: где именно резолвить

`BackendDocumentRuntime` (`contracts/backend/document-runtime.ts`) — общий интерфейс, которым
пользуются route-хендлеры **всех** модулей (все модули регистрируют свои типы документов в один
`context.documents`, а `/admin/registry/documents/:type` и `/admin/documents/:type` в
`module-admin` обслуживают **любой** зарегистрированный тип дженерик-кодом — в этом весь смысл
document-системы). Менять сигнатуры его методов — широкий blast radius.

Проверено по реальным вызовам (`module-admin/src/backend/routes/{registry,documents}.ts`): почти
все методы, отдающие label-содержащие структуры, возвращают **простые объекты после `await`** —
резолвить их можно постфактум, в самом route-хендлере, не трогая `document-runtime.ts` и не меняя
интерфейс:

| Route | Runtime-метод | Что резолвить | Как |
|---|---|---|---|
| `GET /registry/documents` (dashboard) | — (читает `context.documents.dashboard` напрямую) | `topics[].label`, `sections[].label`, `items[].label` | ✅ постфактум в самом хендлере |
| `GET /registry/documents/:type` | `getRegistryMeta()` | `DocumentTypeMeta.label` + вложенное дерево `EnrichedPage → EnrichedGroup → EnrichedExtension.fields: FieldMetadata` | ✅ постфактум |
| `GET /documents/:type` | `list()` | `DocumentListResult.type.label` + `columns: Record<string, ListFieldMeta>` | ✅ постфактум |
| `GET /documents/:type/:id` (card) | `getRegistryMeta()` (для страниц) | то же дерево, что registry | ✅ постфактум |
| `GET /documents/:type/export` | `exportData()` | `DocumentExportResult.type.label` + `columns` | ✅ постфактум |
| `GET /documents/:type/export-view` | `exportDataFiltered()` | заголовки CSV/JSON — формируются **внутри** метода, пока стримит `ReadableStream` | ⚠️ **исключение** — резолвить постфактум нельзя, байты уже улетели. `t` прокинут внутрь `document-runtime.ts` как опциональный параметр `exportDataFiltered(type, params, format, t?)` |
| `getListConfig()` | — | `ListConfigResult` | Метод сейчас **нигде не вызывается** (grep по всему workspace — 0 call sites, кроме объявления). Резолвер написать по аналогии, но не приоритет |

**Уточнение по факту реализации:** внутри `exportDataFiltered` выяснилось, что CSV-ветка вообще не использует `.label` для заголовков колонок — там заголовки это сырые `${module}:${field}`-ключи (`document-runtime.ts:799`), не текст. Значит `t` реально нужен только JSON-ветке (`typeMeta.label` + `exportColumns[module][field].label`, встроенные прямо в JSON-пейлоад файла). CSV экспорт не тронут вообще — резолвить там нечего.

## Изменения по файлам

### Фаза A — Резолвер + инфраструктура ✅

| Файл | Действие |
|------|----------|
| `packages/module-admin/src/backend/lib/resolve-document-labels.ts` | ✅ **Создан** — `resolveRegistryMeta`, `resolveListResult`, `resolveExportResult`, `resolveDashboardResponse` (+ приватные `resolveTypeMeta`/`resolveListColumns`/`resolveFieldMetadata`/`resolveExtension`/`resolveGroup`/`resolvePage`). Общий `tl(t, label)` — `t(label, { defaultValue: label })`, чтобы ещё-не-сконвертированные модули (сырой русский текст вместо ключа) проходили через `t()` без изменений, а не падали на `:`/`.`-парсинге i18next |
| `packages/module-admin/src/backend/routes/registry.ts` | ✅ **Изменён** — оба хендлера резолвят через `request.t` перед `return` |
| `packages/module-admin/src/backend/routes/documents.ts` | ✅ **Изменён** — `list`, card (`:id`), `export` резолвят постфактум; `export-view` передаёт `request.t` в `exportDataFiltered` |
| `packages/platform-core/src/backend/services/document-runtime.ts` | ✅ **Изменён** — `exportDataFiltered` получил опциональный 4-й параметр `t?: TFunction`; локальный `tl()`-хелпер применяется к `typeMeta.label` и `exportColumns[module][field].label` только в JSON-ветке (CSV не использует `.label`, см. выше) |
| `packages/platform-core/src/contracts/backend/document-runtime.ts` | ✅ **Изменён** — сигнатура `exportDataFiltered` в `BackendDocumentRuntime` |
| `packages/module-admin/package.json` | ✅ **Изменён** — добавлен `i18next` в `devDependencies` (нужен только для `import type { TFunction }`, стирается на рантайме, поэтому не peer/runtime dependency) |

**Незапланированная находка и починка:** `request.t` не резолвился в типах `module-admin` — оказалось, что `.d.ts`-файлы, объявленные как *source*-файлы (`types/fastify.d.ts`, ambient `declare module 'fastify'`), `tsc` **не копирует в `dist/`** при сборке (это касается и уже существовавшего `platform-core/src/backend/session.d.ts` — та же болезнь, просто никто раньше не импортировал `request.session` за пределами `platform-core`, поэтому не всплывало). Починено через переименование `types/fastify.d.ts` → `types/fastify.ts` (тот же ambient-контент, просто как обычный `.ts`-source, который `tsc` уже нормально эмиттит в `dist/backend/types/fastify.d.ts`) + side-effect `import './types/fastify.js';` в `platform-core/src/backend/index.ts`, чтобы augmentation подтягивалась в граф компиляции любого пакета, импортирующего что угодно из `@amplicada/platform-core/backend`. `session.d.ts` **не тронут** — сейчас ни один пакет кроме `platform-core` не читает `request.session` напрямую, чинить незачем, но это тот же скрытый баг на будущее.

### Фаза B/C — Перевод конкретных label'ов, по модулям ✅

Изначально задумывалась как инкрементальная (тот же принцип, что и в `2026-07-13-i18n.md`), но по
факту сделана одним проходом сразу по всем модулям.

| Модуль | Файлы с `label:` | Объём |
|---|---|---|
| `module-auth-password` | `src/backend/documents/user.ts` | ✅ 2 строки — пилот |
| `platform-core` (core documents) | `core-pages.ts`, `scheduled-task.ts`, `user-group.ts`, `user.ts` | ✅ ~26 |
| `module-admin` (dashboard topic/link) | `src/backend/index.ts` + `routes/registry.ts` (fallback-топик) | ✅ 3 |
| `module-hr-poll` | `poll.ts`, `poll-response.ts` | ✅ ~24 |
| `module-workflow` | `workflow.ts`, `process-instance.ts` | ✅ ~19 |
| `module-hr-request` | `request-type.ts` | ✅ ~12 — **не было в исходном скоупе плана**, найдено дополнительным grep'ом по всему `backend/` после того как остальные модули были готовы |
| `module-hr` | 13 файлов (`user.ts`, `department.ts`, `cost-center.ts`, `job-family.ts`, `legal-entity.ts`, `position-grade.ts`, `position-template.ts`, `role.ts`, `staff-unit.ts`, `tag.ts`, `virtual-team.ts`, `work-schedule.ts`, `index.ts`) | ✅ ~140+ — самый объёмный, сделан целиком |

Для каждого модуля: `label: 'Подразделения'` → `label: 'hr:department_label'` (ключ, namespace = `mod.id`,
та же конвенция, что и у frontend/backend error-переводов) + запись в новом
`packages/<module>/src/backend/locales/{ru,en}.json` + `locales.backend` в определении модуля
(поле уже есть в `BackendModule` с Фазы A `2026-07-31-backend-i18n.md`, просто до сих пор никто им
не пользовался).

**Сознательно вне скоупа** (не document/field-система, отдельный label-механизм):
- `module-workflow/src/backend/services/registry.ts` (`registerAssigneeProvider`/`registerValidatorProvider`/...) — labels делегатов workflow-движка, показываются в редакторе процессов, не проходят через `contracts/documents.ts`.
- `module-hr-request/src/backend/status.ts:30` (`label: 'Черновик'`) — статус заявки (kind/label дескриптор), не `FieldMetadata`.
- `module-workflow/src/backend/routes/processes.ts:62`, `module-hr-request/src/backend/routes.ts:141` — passthrough того же delegate-label'а через API, не новый хардкод.

**Ключевые переиспользуемые ключи внутри `hr`-namespace** (одна и та же RU-строка встречается в
нескольких документах модуля — например "Код"/"Название"/"Активно"/"Действует с"/"Действует по"):
единый `hr:field_code`, `hr:field_name`, `hr:field_active`, `hr:field_valid_from`, `hr:field_valid_to`
и т.д. вместо дублирования по документам — экономит записи в locale-файле и гарантирует
единообразный перевод одного и того же понятия во всех hr-документах.

## Порядок реализации

### Phase A — Резолвер ✅

- [x] Создать `resolve-document-labels.ts` с типизированными резолверами
- [x] Подключить в `registry.ts` (оба хендлера, включая dashboard)
- [x] Подключить в `documents.ts` (`list`, card, `export`)
- [x] `exportDataFiltered` — добавить `t?` параметр (по факту нужен только JSON-ветке, CSV не использует `.label`)
- [x] `pnpm build` — все 9 пакетов чисто
- [x] `pnpm biome lint` — без новых замечаний

### Phase B — Пилот на module-auth-password ✅

- [x] `user.ts` — 2 label'а → ключи (`auth-password:field_password_hash`, `auth-password:field_created_at`)
- [x] `module-auth-password/src/backend/locales/{ru,en}.json` + `locales.backend` в модуле (`setup.ts`)

### Phase C — Остальные модули ✅

- [x] `platform-core` core documents (`core-pages.ts`, `scheduled-task.ts`, `user-group.ts`, `user.ts`)
- [x] `module-admin` dashboard (`index.ts` + `routes/registry.ts` fallback-топик)
- [x] `module-hr-poll` (`poll.ts`, `poll-response.ts`)
- [x] `module-workflow` (`workflow.ts`, `process-instance.ts`)
- [x] `module-hr-request` (`request-type.ts`) — доп. модуль, найден после первого прохода
- [x] `module-hr` (все 13 файлов, целиком, не по частям)
- [x] `pnpm build` — все 9 пакетов чисто после каждого модуля и в финале
- [x] `pnpm biome lint` — без новых замечаний
- [x] Финальный grep `(label|helpText):\s*'[^']*[а-яА-ЯёЁ]` по всему `packages/*/src/backend/**` — 0
      незамеченных совпадений (кроме сознательно исключённого `status.ts`)
- [ ] **Не сделано:** живая проверка через реальный запрос (curl с `Accept-Language`, реальная БД) —
      недоступна в среде реализации, тот же паттерн, что и в `2026-07-31-backend-i18n.md`; де-факто
      верификация — typecheck + `biome lint` + код-ревью резолверов и всех converted-файлов

## Проверка

- [x] `pnpm build` — сборка без ошибок
- [x] `pnpm biome lint` — без новых замечаний
- [ ] Живой прогон (curl с `Accept-Language`, реальная БД) — недоступен в среде реализации
- [ ] Экспорт CSV/JSON конкретного типа документа с разными `Accept-Language` — заголовки колонок на
      нужном языке (когда появится живая среда для проверки)
