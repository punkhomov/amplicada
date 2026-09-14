# module-hr

Данные и запись оргструктуры платформы: справочники (грейды, шаблоны должностей, графики работы,
роли, теги), орг-иерархия (юрлица, ЦФО, подразделения, штатное расписание, виртуальные команды) и
события (назначения на штатную единицу, участие в команде). Единственный писатель структурных
таблиц — `HrStructureService`, резолвится через `HR_STRUCTURE_SERVICE_TOKEN`. Процессный домен
(заявки на приём/перевод/увольнение) живёт отдельно — в `module-hr-request` поверх
`module-workflow`, этот пакет только хранит и версионирует данные, на которые те процессы ссылаются.

## Документация

| Документ | Когда читать |
|---|---|
| [docs/tutorial.md](./docs/tutorial.md) | Первый раз в модуле — постройте дерево отделов через админку, без кода. |
| [docs/how-to.md](./docs/how-to.md) | Решаете конкретную задачу: вызвать `HrStructureService` из своего модуля, переподчинить отдел, перевести сотрудника, добавить новую Node+Version сущность по этому же паттерну. |
| [docs/reference.md](./docs/reference.md) | Нужен факт: схема БД, полный список методов сервиса, коды ошибок, список зарегистрированных документов. |
| [docs/explanation.md](./docs/explanation.md) | Нужно понять устройство: три уровня историчности, почему появился сервис, `SYSTEM_USER_ID`, известные ограничения. |

Документы в `docs/` написаны по прочтению исходников `src/` и являются источником истины наравне с
кодом. История решений — в `ref/plans/2026-07-23-hr-data-model.md`. Где план и код
расходятся — код побеждает.

## Быстрые факты

- Точка расширения: `HR_STRUCTURE_SERVICE_TOKEN` (`'hr-structure-service'`) — резолвится через
  `context.services.resolve(...)`, экспортируется из `@amplicada/module-hr/contracts`; класс
  `HrStructureService` — из `@amplicada/module-hr/backend`.
- HTTP-роутов у сервиса нет (сознательно, см. [explanation.md](./docs/explanation.md#почему-у-hrstructureservice-нет-http-роутов)) —
  сегодняшний потребитель один: карточка документа в `module-admin` (`/api/admin/documents/hr-*`),
  вызывающая сервис in-process из `save()`.
- 11 типов документов в разделе дашборда «HR-структура» (`HR_STRUCTURE_SECTION`).
- Модуль должен грузиться **после** `module-workflow` (`moduleManifest.dependencies = ['workflow']`,
  `contracts/manifest.ts`) — резолвит `WORKFLOW_REGISTRY_TOKEN` в своём `setup()` для регистрации
  делегата `fixed-assignee`.
- Миграция `migrations/0001_hr_data_model.sql` — все таблицы, FK, индексы и exclusion constraints
  (`EXCLUDE USING gist`, требует `btree_gist`) против пересечения дат версий.
