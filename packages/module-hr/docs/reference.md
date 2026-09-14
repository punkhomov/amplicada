# Справочник: схема БД, HrStructureService, документы

Факты для поиска по конкретному вопросу. За рациональным устройством — в [explanation.md](./explanation.md),
за пошаговыми рецептами — в [how-to.md](./how-to.md). Все сведения сверены с исходным кодом пакета
(`packages/module-hr/src`), не с планом в `ref/plans/2026-07-23-hr-data-model.md`.

## Схема БД (`backend/schemas/`, миграции `0001_hr_data_model.sql`, `0002_document_index_fk.sql`)

Все таблицы живут в pg-схеме `hr` (`hrSchema = pgSchema('hr')` в `_schema.ts`), поэтому имя таблицы
в SQL — `hr.department_node`, а не `hr_department_node`. Drizzle-константа при этом называется
`hrDepartmentNode` — префикс остался только в имени переменной.

Три уровня историчности (см. [explanation.md](./explanation.md#три-уровня-историчности-и-почему)).

### Уровень 1 — справочники (`validFrom`/`validTo` в одной таблице)

| Таблица | Ключевые колонки | Примечания |
|---|---|---|
| `hr.job_family` | `code` (unique), `name`, `validFrom`/`validTo`, `isActive` | — |
| `hr.position_grade` | `familyId` → `hr.job_family`, `code`, `orderIndex`, `minSalary`/`maxSalary` | `UNIQUE(family_id, code)` — только в SQL, не в Drizzle-схеме (см. известные хвосты ниже) |
| `hr.position_template` | `code` (unique), `familyId` nullable, `category` | — |
| `hr.work_schedule` | `code` (unique), `hoursPerWeek` | Без `validFrom`/`validTo` — статичный справочник |
| `hr.tag` + `hr.department_tag`/`hr.user_tag`/`hr.staff_unit_tag` | `name` (unique), `scope` | Junction-таблицы **без FK** на `department_node`/`staff_unit_node` (только на `tag_id`) — известный пробел |
| `hr.role` + `hr.user_role` | `code` (unique) | `hr.user_role` содержит `validFrom`/`validTo`, но их никто не проверяет на пересечение |

### Уровень 2 — Node + Version

Паттерн: `_node` — бессмертный якорь (identity), `_version` — снимок атрибутов на период. Все
`_version`-таблицы: `createdByUserId` (uuid NOT NULL → `core.identity_user`), `createdAt`,
`sourceDocumentId` (nullable), `comment` (nullable).

| Node | Version | Особые поля node | Особые поля version |
|---|---|---|---|
| `hr.legal_entity_node` (`code`) | `hr.legal_entity_version` | — | `shortName`, `fullName`, `inn`, `kpp` |
| `hr.department_node` (`code`) | `hr.department_version` | — | `parentNodeId`, `path` (materialized), `headUserId`, `type`, `orderIndex` |
| `hr.cost_center_node` (`code`) | `hr.cost_center_version` | — | `parentNodeId`, `legalEntityNodeId`, `isActive` |
| `hr.staff_unit_node` (`code`, `departmentNodeId`, `templateId`) | `hr.staff_unit_version` | `departmentNodeId`/`templateId` — identity, не версионируются | `gradeId`, `legalEntityNodeId`, `costCenterNodeId`, `quantity`, `minSalary`/`maxSalary`, `isActive` |
| `hr.virtual_team_node` (`code`, `projectStartDate`, `projectEndDate`) | `hr.virtual_team_version` | Проектные даты — бизнес-факт о команде, не версия | `name`, `type`, `leadUserId`, `departmentNodeId`, `isActive` |

`hr.department_version.path` и `hr.cost_center_version.parentNodeId` — единственные reparent-able
связи; у остальных Node+Version сущностей родителя нет.

**Exclusion constraint** на всех пяти `_version`-таблицах (требует `CREATE EXTENSION btree_gist`):

```sql
ALTER TABLE "hr"."department_version" ADD CONSTRAINT "department_version_no_overlap"
  EXCLUDE USING gist ("node_id" WITH =, daterange("valid_from", COALESCE("valid_to", 'infinity'), '[]') WITH &&);
```

Он же — последняя линия обороны, если `HrStructureService` каким-то образом пропустит пересечение дат
(в норме не должен: вся мутация версий проходит только через сервис).

### Уровень 3 — события (`startDate`/`endDate`, без версий)

| Таблица | Ключевые поля |
|---|---|
| `hr.employee_appointment` | `userId` nullable, `staffUnitNodeId`, `isPrimary`, `employmentType`, `startDate`, `endDate`, `terminationReason`, `workScheduleId` |
| `hr.team_member` | `teamNodeId`, `userId`, `roleInTeam`, `participationPercent`, `startDate`, `endDate` |

`hr.team_member` не имеет своего сервисного метода в `HrStructureService` — управляется напрямую (нет
version-конфликтов, которые нужно было бы охранять).

### Связь с документной моделью (`0002_document_index_fk.sql`)

Все 11 «якорных» таблиц (`*_node` и справочники) получили FK `id → core.document_index(id)`. Строка
индекса — источник id и состояния документа (`deleted_at`, `stale`, `created_by_user_id`), своей
«базовой таблицы» у типа документа больше нет. Практическое следствие для module-hr: **строку узла
нельзя вставить раньше строки индекса**, поэтому id всегда берётся из
`documentRuntime.allocateDocumentId(...)` (в `HrStructureService.create*`) либо приходит готовым в
`save()` (когда пишет карточка).

## HrStructureService (`backend/services/hr-structure-service.ts`)

Единственный писатель в `hr_*_node`/`hr_*_version`. Резолвится через
`context.services.resolve<HrStructureService>(HR_STRUCTURE_SERVICE_TOKEN)` (`HR_STRUCTURE_SERVICE_TOKEN`
экспортируется из `@amplicada/module-hr/contracts`, класс — из `@amplicada/module-hr/backend`).

### `AuditInfo` (обязательный параметр каждой мутации)

```typescript
interface AuditInfo {
  performedByUserId: string;
  sourceDocumentId?: string | null;
  comment?: string | null;
  /** Разрешает effectiveDate в прошлом (импорт/ручная корректировка администратором). */
  isSystemCorrection?: boolean;
}
```

### `EffectiveDate = string | null` — две разные операции

Параметр `effectiveDate` каждой мутации версий принимает `null`, и это не «значение по умолчанию», а
отдельная семантика:

| Значение | Что это значит | Что делает `writeVersion` |
|---|---|---|
| `null` (`CARD_CORRECTION`) | **коррекция записи** — «мы записали факт неверно» | правит текущую версию на месте, границы интервала не двигаются, новой строки нет |
| дата | **новый факт с этой даты** | закрывает текущую версию `dayBefore(date)`, вставляет новую |

Карточка документа всегда передаёт `null`: она generic CRUD-форма без поля «действует с», то есть
источником valid-time событий быть не может. Дату передают только явные операции (`deactivateX`,
`transferEmployee`, будущие «приказы»). Проверка «дата не в прошлом» на коррекции не применяется —
`assertValidEffectiveDate` выходит сразу при `null`.

Отдельный случай: дата, не превышающая `validFrom` текущей версии, тоже трактуется как коррекция —
иначе получился бы интервал `[today, today-1]`, запрещённый exclusion-констрейнтом. Именно это
роняло правку документа в день его создания.

### `ServiceOpts` — folding в чужую транзакцию

```typescript
interface ServiceOpts { db?: BackendDbService }
```
Все методы: `method(..., opts: ServiceOpts = {})` — без `opts.db` открывают свою транзакцию
(`this.deps.db.transaction(...)`), с `opts.db` выполняются в переданной (см. `WorkflowEngine.inTransaction`
в `module-workflow` — идентичный паттерн).

### Методы по сущностям

| Сущность | Create | Update | Reparent | Deactivate |
|---|---|---|---|---|
| Department | `createDepartment(input, audit, opts?)` | `updateDepartmentAttributes(nodeId, changes, effectiveDate, audit, opts?)` | `reparentDepartment(nodeId, newParentNodeId, effectiveDate, audit, opts?)` — каскадом обновляет `path` у всех потомков | `deactivateDepartment(nodeId, effectiveDate, audit, opts?)` |
| CostCenter | `createCostCenter(...)` | `updateCostCenterAttributes(...)` | `reparentCostCenter(...)` (без каскада — у ЦФО нет `path`) | `deactivateCostCenter(...)` |
| LegalEntity | `createLegalEntity(...)` | `updateLegalEntityAttributes(...)` | — (нет иерархии) | `deactivateLegalEntity(...)` |
| StaffUnit | `createStaffUnit(...)` | `updateStaffUnitAttributes(...)` | — | `deactivateStaffUnit(...)` |
| VirtualTeam | `createVirtualTeam(...)` | `updateVirtualTeamAttributes(...)` + отдельно `updateVirtualTeamProjectDates(nodeId, { projectStartDate?, projectEndDate? }, opts?)` (node, не версия) | — | `deactivateVirtualTeam(...)` |
| Employee (Level 3) | — | `transferEmployee(userId, newStaffUnitNodeId, effectiveDate, audit, extra?, opts?)` — закрывает текущее назначение, открывает новое | — | — (нет отдельного увольнения, только через `endDate` назначения) |

`buildDepartmentPath(db, parentNodeId, code)` — единственный **публичный** приватный-по-смыслу метод:
переиспользуется document-слоем для bootstrap первой версии, когда строка узла уже заведена
`ensureNodeRow`, а версии ещё нет (см.
[explanation.md](./explanation.md#почему-запись-версии-терпит-отсутствие-текущей-версии)).

### Guard rails → ошибки (`services/errors.ts`)

| Класс | `statusCode` | Когда бросается |
|---|---|---|
| `VersionOverlapError` | 409 | Insert упёрся в exclusion constraint (`23P01`) — перехватывается в `versioning.ts` |
| `NodeHasActiveAppointmentsError` | 400 | `deactivate*` при наличии активных (`endDate IS NULL`) `hr.employee_appointment`, ссылающихся на закрываемый узел (department — через штатные единицы, cost-center/legal-entity — через `hr.staff_unit_version`, staff-unit — напрямую) |
| `InvalidEffectiveDateError` | 400 | `effectiveDate` в прошлом и `audit.isSystemCorrection` не `true` |
| `ParentCycleDetectedError` | 400 | Reparent создал бы цикл в иерархии (обход цепочки `parentNodeId` вверх) |

Ни одна из них не мапится в `fastify.setErrorHandler` — HTTP-роутов у сервиса нет (см. ниже). Если
ошибка долетает до Fastify через `docs.objects.extend(...).save`, её подхватывает **generic fallback** в
`module-admin`'s `setErrorHandler` (`error.statusCode ?? 500`) — именно поэтому все четыре класса имеют
`statusCode`, а не `status`, как у `DocumentRuntimeError` в `platform-core`.

### `versioning.ts` / `version-mode.ts` — единственная точка записи версий

```typescript
writeVersion<T>(db, table, { nodeId, effectiveDate, values, audit }): Promise<T>
```

Сам читает текущую версию, сам выбирает ветку (`versionWriteMode`), сам переносит неизменённые поля
со старой версии на новую (всё, кроме `NOT_CARRIED`: `id`, `nodeId`, `validFrom`, `validTo`,
`createdAt`, `createdByUserId`, `sourceDocumentId`, `comment`). Ловит `23P01` через
`isPgErrorCode(err, PG_EXCLUSION_VIOLATION)` → `VersionOverlapError`.

Пришёл на смену `closeCurrentAndInsertVersion(close, insert)`: тот ничего не знал о данных, поэтому
сборка значений дублировалась во всех девяти вызывающих, а решение «коррекция или новый интервал»
принять было негде.

`version-mode.ts` — чистая часть, без импортов (поэтому покрыта тестами без БД):

| Функция | Что делает |
|---|---|
| `versionWriteMode(currentValidFrom, effectiveDate)` | `'correction'` \| `'new-interval'` — см. таблицу `EffectiveDate` выше |
| `dayBefore(dateStr)` | `validTo` закрываемой версии = `effectiveDate - 1 день` (не `CURRENT_DATE - 1`) — позволяет планировать изменения на будущую дату |
| `definedOnly(values)` | выкидывает `undefined`: в частичном сохранении это «поле не трогаем», а не «обнули» |
| `todayIso()` | `YYYY-MM-DD` |

**Важно про `23P01`.** До 2026-08-06 перехват был мёртвым: drizzle 0.45 заворачивает ошибку запроса в
`DrizzleQueryError` и кладёт оригинал в `cause`, поэтому проверка `'code' in err` не срабатывала
никогда и `VersionOverlapError` не доходила до пользователя ни разу. Сейчас код драйвера ищется
обходом цепочки `cause` (`findPgError`/`isPgErrorCode` в `platform-core`).

## Регистрация документов (`backend/documents/`)

11 типов, все с `module: 'hr'`, `section: HR_STRUCTURE_SECTION` (`'hr-structure'`, зарегистрирован в
`docs.dashboard.registerSection` внутри `registerHrDocuments`) и `layout: { [DocumentPages.DEFAULT]:
{ [DocumentGroups.DEFAULT]: {} } }` (пустой `GroupLayout` → legacy 3-колоночная сетка, см.
`DocumentExtension.layout` в `platform-core/contracts/documents.ts`). `label` — ключ i18n
(`'hr:department_label'`), не готовая строка.

**Id типов не содержат префикса `hr-`** — модуль указан отдельным полем `module`, а UI собирает
`module:id` там, где нужна глобальная уникальность. Переименовано 2026-08-06 вместе с таблицами.

| `docId` | Файл | Запись (`docs.objects.extend`) | Список (`docs.lists.extend`) |
|---|---|---|---|
| `job-family` | `job-family.ts` | auto (`schema` + `idColumn`) | auto (`schema` + `foreignKey`) |
| `position-grade` | `position-grade.ts` | auto | auto |
| `position-template` | `position-template.ts` | auto | auto |
| `work-schedule` | `work-schedule.ts` | auto | auto |
| `tag` | `tag.ts` | auto, `deletable: true` (единственный удаляемый) | auto |
| `role` | `role.ts` | auto | auto |
| `legal-entity` | `legal-entity.ts` | custom `load`/`save` → `ensureNodeRow` + `updateLegalEntityAttributes` | два расширения: `key: 'node'` + версия (`joinType: 'inner'`, `joinOn: isNull(validTo)`) |
| `department` | `department.ts` | custom, + bootstrap-ветка первой версии, + `reparentDepartment` при смене `parentNodeId` | два расширения, как выше |
| `cost-center` | `cost-center.ts` | custom, аналогично department (без `path`) | два расширения |
| `staff-unit` | `staff-unit.ts` | custom → `updateStaffUnitAttributes` | два расширения (на узле три колонки: `code`, `departmentNodeId`, `templateId`) |
| `virtual-team` | `virtual-team.ts` | custom → `updateVirtualTeamAttributes` + `updateVirtualTeamProjectDates` | два расширения |

`extendUserDoc` (`user.ts`) — расширение core-документа `'user'` полями `hr.user_profile`
(табельный номер, ФИО, даты приёма/увольнения...), не новая сущность.

### `ensureNodeRow` — кто заводит строку узла

Раньше строку `*_node` вставлял generic `create()` из «базовой таблицы типа». Базовой таблицы больше
нет, поэтому узел заводит сам `save` расширения — через `ensureNodeRow(db, table, id, values)`
(`documents/node-row.ts`). Это UPDATE-then-INSERT, а не `ON CONFLICT DO UPDATE`: Postgres проверяет
`NOT NULL` при формировании кортежа, **до** разрешения конфликта, а карточка при частичном сохранении
присылает не все обязательные колонки. Лишний запрос платится только при первом сохранении.

Пустой `values` (правка, не задевшая колонок узла) проверку не отменяет: строки может ещё не быть, и
тогда вставка версии упала бы на внешнем ключе.

### `constants.ts`

```typescript
export const SYSTEM_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; // сидированный admin из platform-core/migrations/0000_init.sql
export const HR_STRUCTURE_SECTION = 'hr-structure';
export const CARD_CORRECTION: null = null;
export function today(): string // new Date().toISOString().slice(0, 10)
```

`SYSTEM_USER_ID` — заглушка для `createdByUserId`/`AuditInfo.performedByUserId`: actor запроса
доезжает до `core.document_index` (`created_by_user_id`/`updated_by_user_id`), но до `ext.save` — нет,
поэтому `hr_*_version.created_by_user_id` пишется системным пользователем (см.
[explanation.md](./explanation.md#почему-systemuserid-а-не-реальный-пользователь)).

`CARD_CORRECTION` — тот самый `null`, который карточка передаёт вместо даты. Раньше на его месте были
`today()` + `isSystemCorrection: true`, и любая правка опечатки порождала новую версию.

## Почему у пяти Node+Version документов по два list-расширения

`ListExtension.listFetch` (свой запрос вместо generic-пути) **удалён из платформы** в августе 2026 —
он молча терял фильтры, сортировку и колонки в экспорте. Node+Version документы переведены на
generic-путь: inner join на актуальную версию (`joinOn: t => isNull(t.validTo)`) даёт ровно одну
строку на узел, то есть решает ровно ту задачу, ради которой `listFetch` и был.

Расширений именно два, потому что колонки живут в двух таблицах: `code` — на узле (`key: 'node'`,
`foreignKey: 'id'`), остальное — на версии (`foreignKey: 'nodeId'`). До этого `code` подхватывался
фолбэком `buildListSelect` на «базовую таблицу типа», которой больше нет.

Побочный эффект для пользователя: ключ колонки в сохранённых настройках таблицы сменился с
`hr:base:code` на `hr:node:code`. Сохранённый фильтр по старому ключу даёт 400 — лечится очисткой
`admin-table-settings` в localStorage.

## Известные хвосты (не баги в смысле «не работает», но стоит держать в голове)

- `UNIQUE(family_id, code)` (`hr.position_grade`) и `UNIQUE(department_node_id, code)`
  (`hr.staff_unit_node`) — есть в `migrations/0001_hr_data_model.sql`, отсутствуют в Drizzle-схеме
  (`hr-position-grade.ts`/`hr-staff-unit-node.ts`). Дрейф между кодом схемы и миграцией; следующий
  `drizzle-kit generate` их не увидит (сам `drizzle-kit` в проект пока не подключён — миграции пишутся
  руками).
- `hr.department_tag.department_node_id`/`hr.staff_unit_tag.staff_unit_node_id` — без FK на
  соответствующий `_node` (только `tag_id` — FK). Не мешает работе, но допускает orphan-ссылки.
- **Экспорт и импорт разъехались по `id`.** `importData` умеет сохранять id (берёт его из item'а,
  резервирует через `indexCreated`, отвечает 409 на чужой тип и на удалённый документ), а `exportData`
  этот id **не отдаёт** — `loadExtension` вырезает `idColumn` из результата. То есть round-trip через
  экспорт всё ещё создаёт новые строки, и FK-поля (`departmentNodeId`, `parentNodeId`...) после
  реимпорта укажут на неверные id. Экспортируется только текущий срез (`validTo IS NULL`), не история
  версий. Подробнее — [explanation.md](./explanation.md#экспортимпорт-не-restore).
- `hr.team_member`, `hr.user_role`, `hr.department_tag`/`hr.user_tag`/`hr.staff_unit_tag` — без
  constraint на непересечение дат и без сервисных методов; мутируются напрямую через generic document
  CRUD, если для них вообще будут карточки (сегодня — нет, только схемы).
- **Внутридневного следа правок нет.** Две коррекции за день перетирают `created_by_user_id`/`comment`
  друг друга: коррекция правит строку версии на месте. Отдельного append-only журнала «кто и когда что
  исправил» в hr нет (в `module-workflow` такой есть — `workflow.audit_log`).
- `widget: 'reference'` на полях-ссылках (`parentNodeId`, `headUserId`, `legalEntityNodeId`...)
  **не реализован в UI** — `FieldWidget` в `module-admin` не имеет для него ветки и рендерит обычный
  текстовый инпут. Практически это значит, что связи на карточках задаются вписыванием UUID руками.
- `FieldMetadata.required` расставлен по полям, но **не читается никем** — ни валидации на бэкенде, ни
  маркера на фронтенде. Декоративен до реализации валидации в `DocumentRuntime`.
- Bulk import, SQL-вьюхи (`v_department_current` и т.п.), правило «без временных дыр между версиями» —
  сознательно не реализованы (см. [explanation.md](./explanation.md#осознанно-отложено)).
