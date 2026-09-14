# How-to: работа с HrStructureService

Практические рецепты для авторов других модулей (будущий workflow-делегат реорганизации,
`module-hr-request` и т.п.) и для тех, кто добавляет новую Node+Version сущность в сам module-hr.
Примеры — реальный код из `module-hr` (пять уже мигрированных документов), а не гипотетические. За
объяснением «почему» — в [explanation.md](./explanation.md), за полным списком методов — в
[reference.md](./reference.md).

## Как получить `HrStructureService` из своего модуля

```typescript
import { HR_STRUCTURE_SERVICE_TOKEN } from '@amplicada/module-hr/contracts';
import type { HrStructureService } from '@amplicada/module-hr/backend';

setup(context) {
  const hrStructureService = context.services.resolve<HrStructureService>(HR_STRUCTURE_SERVICE_TOKEN);
}
```

**Порядок загрузки модулей.** Как и у `WORKFLOW_ENGINE_TOKEN`, `resolve()` упадёт на старте, если
`module-hr` не зарегистрирован раньше вашего модуля в массиве `bootstrap()` (`apps/api/src/index.ts`).

## Как обновить атрибуты отдела (типовой сценарий — переименование, смена руководителя)

Сначала решите, что вы делаете: **новый факт** или **исправление записи**. Это разные операции, и
`effectiveDate` — то место, где выбор объявляется.

### Новый факт с датой (приказ, реорганизация)

```typescript
await hrStructureService.updateDepartmentAttributes(
  departmentNodeId,
  { name: 'Отдел удержания клиентов', headUserId: newHeadUserId },
  '2026-08-01', // с этой даты действует новая версия; текущая закрывается 2026-07-31
  {
    performedByUserId: currentUser.id, // реальный actor, если он у вас есть (в отличие от карточки документа)
    sourceDocumentId: orderId, // ссылка на приказ — необязательно, но желательно для аудита
    comment: 'Переименование согласно приказу №45',
  },
);
```

### Исправление записи (опечатка — «отдел всегда так назывался»)

```typescript
await hrStructureService.updateDepartmentAttributes(
  departmentNodeId,
  { name: 'Отдел удержания клиентов' },
  null, // коррекция: правит текущую версию на месте, новой строки в истории не появится
  { performedByUserId: currentUser.id, comment: 'Исправлена опечатка' },
);
```

Так же поступает карточка документа — она передаёт `CARD_CORRECTION` (это и есть `null`), потому что
поля «действует с» в форме нет. Не подставляйте `today()` вместо `null`: правка в день создания версии
даст интервал «с сегодня по вчера» и упрётся в exclusion-констрейнт.

Оба варианта: поля, не переданные в `changes`, наследуются с текущей версии — перечитывать и копировать
всё вручную не нужно. `undefined` означает «не трогать», а не «обнули» (`definedOnly`).

Если `effectiveDate` — дата в прошлом и вы не передали `isSystemCorrection: true`, бросит
`InvalidEffectiveDateError` (400). На `null` эта проверка не применяется: коррекция даты не заявляет.

## Как переподчинить отдел (с каскадом `path`)

```typescript
await hrStructureService.reparentDepartment(
  departmentNodeId,
  newParentNodeId, // или null — сделать корневым
  '2026-08-01',
  { performedByUserId: currentUser.id, sourceDocumentId: orderId, comment: 'Реорганизация' },
);
```

Одной транзакцией: закрывает текущую версию отдела, создаёт новую с пересчитанным `path`, затем обходит
**всех** прямых и транзитивных потомков (`cascadeDepartmentPath`) и тоже создаёт им новые версии с
обновлённым `path` (остальные атрибуты потомков не меняются). Перед этим проверяет, что
`newParentNodeId` не находится ниже `departmentNodeId` в текущей иерархии — иначе
`ParentCycleDetectedError` (400).

## Как закрыть (ликвидировать) отдел или штатную единицу

```typescript
await hrStructureService.deactivateDepartment(departmentNodeId, '2026-12-31', audit);
```

Проверяет, нет ли активных (`endDate IS NULL`) `hr.employee_appointment` у штатных единиц этого отдела —
если есть, бросает `NodeHasActiveAppointmentsError` (400) с советом сначала оформить перевод/увольнение.
**Каскад не срабатывает автоматически**: закрытие отдела не закрывает дочерние отделы/штатные единицы —
это сознательное решение исходного плана (`ref/plans/2026-07-23-hr-data-model.md`, правило 4), не баг.
`deactivateStaffUnit` делает ту же проверку напрямую по назначениям (без промежуточного обхода штатных
единиц).

## Как перевести сотрудника на другую штатную единицу

```typescript
await hrStructureService.transferEmployee(
  userId,
  newStaffUnitNodeId,
  '2026-09-01',
  { performedByUserId: currentUser.id, sourceDocumentId: orderId, comment: 'Перевод в отдел разработки' },
);
```

Закрывает текущее активное назначение (`endDate = effectiveDate - 1 день`, `terminationReason:
'transfer'`) и создаёт новое с `startDate = effectiveDate`. **Никогда** не обновляйте
`hr.employee_appointment.staffUnitNodeId` напрямую через `UPDATE` — это нарушает правило «перевод = новое
назначение» из исходного плана и ломает историю назначений.

## Как добавить новую Node+Version сущность по этому же паттерну

Если понадобится шестая сущность с тем же паттерном (node + version + audit trail):

1. Схема: `hr-<entity>-node.ts` (только identity-поля, обычно `code`) и `hr-<entity>-version.ts`
   (изменяемые атрибуты + `validFrom`/`validTo` + audit trail поля — скопируйте набор из
   `hr-cost-center-version.ts` как самый простой пример с иерархией, или `hr-legal-entity-version.ts` —
   без неё). Обе таблицы объявляются через `hrSchema.table('<name>', ...)`.
2. Миграция: `CREATE TABLE` для обеих + `EXCLUDE USING gist` на `_version`-таблице (см.
   [reference.md](./reference.md#схема-бд-backendschemas-миграции-0001_hr_data_modelsql-0002_document_index_fksql) —
   скопируйте блок один в один, заменив имена таблиц) + **FK `id → core.document_index(id)` на
   `_node`-таблице** по образцу `0002_document_index_fk.sql`. Без него узел вставить не получится:
   документная модель требует, чтобы строка индекса существовала первой.
3. В `hr-structure-service.ts`: добавьте `Create<Entity>Input`/`Update<Entity>Attributes`, затем
   `create<Entity>`/`update<Entity>Attributes`/`deactivate<Entity>` по образцу `createCostCenter`/
   `updateCostCenterAttributes`/`deactivateCostCenter` — они самые короткие (без каскада `path`).
   Читать текущую версию самому не нужно: это делает `writeVersion`, он же решает, коррекция это или
   новый интервал. В `create<Entity>` id берите из
   `this.deps.documentRuntime.allocateDocumentId(NODE_DOC_TYPES.<entity>, db)`.
4. В `documents/<entity>.ts`: `docs.register(...)` + `docs.objects.extend(...)` с `load`/`save`, где
   `save` сперва зовёт `ensureNodeRow(tx, <entity>Node, id, definedOnly({ code }))`, а потом ваш
   `updateXAttributes` с `CARD_CORRECTION` (см. `cost-center.ts` целиком как шаблон — если у сущности
   есть `parentNodeId`, обязательно продублируйте bootstrap/reparent-развилку оттуда).
5. Списочные колонки — **два** `docs.lists.extend`: `key: 'node'` с `foreignKey: 'id'` под `code` и
   расширение версии с `foreignKey: 'nodeId'`, `joinType: 'inner'`, `joinOn: t => isNull(t.validTo)`.
6. Зарегистрируйте в `documents/index.ts`: добавьте импорт, вызов `register<Entity>Doc(docs,
   hrStructureService)` в `registerHrDocuments`.

## Как проверить миграцию локально

```bash
pnpm --filter @amplicada/module-hr typecheck
pnpm turbo typecheck   # весь монорепо — убедиться, что platform-core/module-admin тоже не сломались
pnpm --filter @amplicada/module-hr test
```

Миграции пакета применяются рантайм-мигратором drizzle (`migrate()` из
`drizzle-orm/node-postgres/migrator`) при старте `apps/api` — модуль лишь регистрирует путь
(`context.migrations.register('hr', migrationsPath)` в `setup.ts`). Отдельной команды на прогон в этом
пакете нет; после изменений запустите `pnpm --filter @amplicada/module-hr build` из корня.

**`drizzle-kit` в проект не подключён.** SQL-файл и запись в `migrations/meta/_journal.json` пишутся
руками; `drizzle-kit generate` схему не сверяет, поэтому расхождения между Drizzle-схемой и миграцией
никто не поймает автоматически (такие уже есть — см. «известные хвосты» в
[reference.md](./reference.md#известные-хвосты-не-баги-в-смысле-не-работает-но-стоит-держать-в-голове)).
