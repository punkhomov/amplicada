---
title: module-hr — Data Model
type: plan
tier: 2
date: 2026-07-23
status: draft
---

# module-hr — Data Model

## Философия

Система должна выдерживать **реальный хаос** оргструктуры: матричное подчинение, проектные команды, исторические срезы, кастомные поля клиентов. Никакой жёсткой иерархии — вместо неё слои:

| Слой | Назначение |
|------|-----------|
| **Юридический** | Юрлица, ЦФО — для бухгалтерии и приказов |
| **Административный** | Подразделения, штатное расписание — для HR и ТК |
| **Функциональный** | Проекты, виртуальные команды — для матричного управления |
| **Ролевой** | Роли и теги — для гибких срезов и прав |

## Матрица историчности

| Уровень | Паттерн | Сущности |
|---------|---------|----------|
| **1 — Справочники** | `validFrom`/`validTo` в одной таблице | job_family, position_grade, position_template, work_schedule, tag, role |
| **2 — Структуры с иерархией** | Node + Version (две таблицы) | legal_entity, department, staff_unit, cost_center, virtual_team |
| **3 — События/факты** | `startDate`/`endDate`, без версий | employee_appointment, team_member |

---

## Сущности (в порядке зависимостей)

### Уровень 1: Справочники (validFrom/validTo)

#### 1. `hr_job_family` — Семейство должностей

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `uuid PK` | |
| `code` | `varchar(50) unique` | `ENG`, `HR`, `SALES` |
| `name` | `varchar(255)` | «Разработка», «Управление персоналом» |
| `description` | `text` | |
| `validFrom` | `date` | |
| `validTo` | `date` nullable | |
| `isActive` | `boolean default true` | |

#### 2. `hr_position_grade` — Грейд внутри семьи

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `uuid PK` | |
| `familyId` | `uuid FK → hr_job_family.id` | |
| `code` | `varchar(50)` | `G1`, `G2` |
| `name` | `varchar(255)` | «Младший», «Специалист» |
| `orderIndex` | `integer` | |
| `minSalary` | `numeric(12,2)` | |
| `maxSalary` | `numeric(12,2)` | |
| `validFrom` | `date` | |
| `validTo` | `date` nullable | |
| `isActive` | `boolean default true` | |

UNIQUE(familyId, code)

#### 3. `hr_position_template` — Типовая должность

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `uuid PK` | |
| `code` | `varchar(50) unique` | `DEV`, `HR_SPEC` |
| `name` | `varchar(255)` | «Разработчик» |
| `familyId` | `uuid FK → hr_job_family.id` nullable | |
| `category` | `varchar(50)` | `manager`, `specialist`, `worker` |
| `description` | `text` | |
| `validFrom` | `date` | |
| `validTo` | `date` nullable | |
| `isActive` | `boolean default true` | |

#### 4. `hr_work_schedule` — График работы

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `uuid PK` | |
| `code` | `varchar(50) unique` | `STANDARD`, `SHIFT` |
| `name` | `varchar(255)` | «5/2», «Сменный 2/2» |
| `hoursPerWeek` | `numeric(4,1)` | |
| `description` | `text` | |

#### 5. `hr_tag` — Теги

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `uuid PK` | |
| `name` | `varchar(100)` | «Секретно», «Удалёнка» |
| `scope` | `varchar(50)` | `department`, `user`, `staff_unit` |

Линк-таблицы: `hr_department_tag`, `hr_user_tag`, `hr_staff_unit_tag`.

#### 6. `hr_role` — Роль (процессная)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `uuid PK` | |
| `code` | `varchar(50) unique` | `MENTOR`, `APPROVER` |
| `name` | `varchar(255)` | |
| `description` | `text` | |

Линк-таблица `hr_user_role` (userId, roleId, scopeType, scopeId, validFrom, validTo).

---

### Уровень 2: Структуры (Node + Version)

Паттерн: **якорь** (`_node`) — бессмертный, на него ссылаются FK. **Версия** (`_version`) — снимок атрибутов на период.

Все `_version`-таблицы содержат audit trail:
| Поле | Тип | Описание |
|------|-----|----------|
| `createdByUserId` | `uuid FK → identity_user.id` | Кто создал версию |
| `createdAt` | `timestamptz default now()` | Когда |
| `sourceDocumentId` | `uuid nullable` | Документ-основание (приказ) |
| `comment` | `text nullable` | Комментарий к изменению |

#### 7. `hr_legal_entity_node` + `hr_legal_entity_version`

```text
hr_legal_entity_node
  id uuid PK
  code varchar(50) unique    // ИНН / код юрлица — не меняется

hr_legal_entity_version
  id uuid PK
  nodeId uuid FK → hr_legal_entity_node.id
  shortName varchar(100)
  fullName varchar(500)
  inn varchar(20)
  kpp varchar(20)
  validFrom date
  validTo date nullable
  // + audit trail поля
```

#### 8. `hr_department_node` + `hr_department_version`

```text
hr_department_node
  id uuid PK
  code varchar(50) unique    // CRM, BSS — не меняется

hr_department_version
  id uuid PK
  nodeId uuid FK → hr_department_node.id
  parentNodeId uuid FK → hr_department_node.id nullable
  name varchar(255)
  shortName varchar(100)
  headUserId uuid FK → identity_user.id nullable
  type varchar(50)           // division, department, sector, group
  orderIndex integer default 0
  validFrom date
  validTo date nullable
  metadata jsonb
  // + audit trail поля
```

**path:** стратегия описана в разделе Правила (см. ниже).

#### 9. `hr_cost_center_node` + `hr_cost_center_version`

```text
hr_cost_center_node
  id uuid PK
  code varchar(50) unique    // IT-DEV — не меняется

hr_cost_center_version
  id uuid PK
  nodeId uuid FK → hr_cost_center_node.id
  parentNodeId uuid FK → hr_cost_center_node.id nullable
  name varchar(255)
  legalEntityNodeId uuid FK → hr_legal_entity_node.id nullable
  validFrom date
  validTo date nullable
  isActive boolean default true
  metadata jsonb
  // + audit trail поля
```

#### 10. `hr_staff_unit_node` + `hr_staff_unit_version`

```text
hr_staff_unit_node
  id uuid PK
  code varchar(50)           // CRM-DEV-001 — не меняется
  departmentNodeId uuid FK → hr_department_node.id
  templateId uuid FK → hr_position_template.id
  // grade, legalEntity, costCenter — в версии, не в якоре

hr_staff_unit_version
  id uuid PK
  nodeId uuid FK → hr_staff_unit_node.id
  gradeId uuid FK → hr_position_grade.id nullable
  legalEntityNodeId uuid FK → hr_legal_entity_node.id
  costCenterNodeId uuid FK → hr_cost_center_node.id nullable
  quantity numeric(6,2) default 1
  minSalary numeric(12,2) nullable
  maxSalary numeric(12,2) nullable
  isActive boolean default true
  validFrom date
  validTo date nullable
  metadata jsonb
  // + audit trail поля
```

UNIQUE(departmentNodeId, code) — на уровне node.

#### 11. `hr_virtual_team_node` + `hr_virtual_team_version`

`validFrom/validTo` — период действия версии (конфигурации), единообразно с остальными Node+Version сущностями. `projectStartDate/projectEndDate` — отдельные бизнес-даты команды как проекта, не меняются при переименовании/смене лида; лежат в якоре, а не в версии, чтобы не путать «когда действует этот снимок атрибутов» с «когда живёт сама команда».

```text
hr_virtual_team_node
  id uuid PK
  code varchar(50) unique          // SQUAD-MOBILE-01 — не меняется
  projectStartDate date nullable   // бизнес-дата старта проекта/команды
  projectEndDate date nullable     // бизнес-дата закрытия

hr_virtual_team_version
  id uuid PK
  nodeId uuid FK → hr_virtual_team_node.id
  name varchar(255)
  type varchar(50)           // project, squad, tribe, working_group
  leadUserId uuid FK → identity_user.id nullable
  departmentNodeId uuid FK → hr_department_node.id nullable
  validFrom date
  validTo date nullable
  isActive boolean default true
  metadata jsonb
  // + audit trail поля
```

`hr_team_member` ссылается на `hr_virtual_team_node.id`, не на version.

---

### Уровень 3: События (startDate/endDate, без версий)

#### 12. `hr_employee_appointment` — Назначение на штатную единицу

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `uuid PK` | |
| `userId` | `uuid FK → identity_user.id` nullable | |
| `staffUnitNodeId` | `uuid FK → hr_staff_unit_node.id` | |
| `isPrimary` | `boolean default true` | |
| `employmentType` | `varchar(50) default 'full-time'` | |
| `startDate` | `date` | |
| `endDate` | `date` nullable | |
| `terminationReason` | `varchar(50)` nullable | |
| `workScheduleId` | `uuid FK → hr_work_schedule.id` nullable | |
| `metadata` | `jsonb` | |

**Правило:** Никогда не обновляй `staffUnitNodeId` в существующем назначении. Перевод = закрыть старое (`endDate = вчера`), создать новое.

#### 13. `hr_team_member` — Участник команды

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `uuid PK` | |
| `teamNodeId` | `uuid FK → hr_virtual_team_node.id` | |
| `userId` | `uuid FK → identity_user.id` | |
| `roleInTeam` | `varchar(100)` | |
| `participationPercent` | `integer` | |
| `startDate` | `date` | |
| `endDate` | `date` nullable | |

---

## Схема связей

```
hr_legal_entity_node  1──N hr_legal_entity_version
hr_legal_entity_node  1──N hr_staff_unit_version    (через legalEntityNodeId)

hr_department_node    1──N hr_department_version
hr_department_node    1──N hr_staff_unit_node       (через departmentNodeId)
hr_department_node    (self-ref parentNodeId — в версии)

hr_cost_center_node   1──N hr_cost_center_version
hr_cost_center_node   (self-ref parentNodeId — в версии)
hr_cost_center_node   1──N hr_staff_unit_version    (через costCenterNodeId)

hr_staff_unit_node    1──N hr_staff_unit_version
hr_staff_unit_node    1──N hr_employee_appointment

hr_virtual_team_node  1──N hr_virtual_team_version
hr_virtual_team_node  1──N hr_team_member

hr_job_family         1──N hr_position_grade
hr_job_family         1──N hr_position_template

hr_position_template  1──N hr_staff_unit_node
hr_position_grade     1──N hr_staff_unit_version    (через gradeId)

identity_user         1──N hr_employee_appointment (nullable)
identity_user         1──N hr_team_member
identity_user         1──N hr_user_tag
identity_user         1──N hr_user_role

hr_employee_appointment N──1 hr_work_schedule (nullable)
```

## Типы документов в DocumentRegistry

| Тип | Сущность | Группа |
|-----|----------|--------|
| `hr-legal-entity` | hr_legal_entity_node (склейка) | BASE |
| `hr-cost-center` | hr_cost_center_node (склейка) | BASE |
| `hr-job-family` | hr_job_family | BASE |
| `hr-position-grade` | hr_position_grade | BASE |
| `hr-position-template` | hr_position_template | BASE |
| `hr-department` | hr_department_node (склейка) | BASE |
| `hr-staff-unit` | hr_staff_unit_node (склейка) | BASE |
| `hr-virtual-team` | hr_virtual_team_node (склейка) | BASE |

Для UI все Node+Version сущности отдаются **склеенными** — с атрибутами актуальной на сегодня версии. История версий — через отдельный эндпоинт.

`hr_user_profile` остаётся как расширение core `user` — без изменений.

## Правила (защита от хаоса)

1. **asOfDate** — любой запрос к оргструктуре, штатке или назначению принимает `asOfDate`. По умолчанию — сегодня.

2. **Никакого DELETE** — для department_node, staff_unit_node, legal_entity_node, virtual_team_node, cost_center_node — только закрытие версии (`validTo`) или назначения (`endDate`).

3. **Непересечение версий** — constraint (или проверка в коде): для одного `nodeId` версии не пересекаются по `[validFrom, validTo]`.

4. **Каскад не закрывается** — закрытие отдела/команды не закрывает автоматически штатки и назначения. Это делает HR вручную через переводы.

5. **Перевод = новое назначение** — никогда не обновляй `staffUnitNodeId` в существующем appointment.

6. **path (materialized path) — стратегия каскадного обновления:**
   Поле `path` в `hr_department_version` хранит материализованный путь (например `ROOT/IT/DEV`).
   При переподчинении отдела (смена `parentNodeId`):
   - В одной транзакции создаются новые версии для самого отдела и **всех его потомков** с обновлённым `path`.
   - Это редкая операция, поэтому стоимость каскада приемлема.
   - Альтернатива (вычисление через recursive CTE) не выбрана из-за потери производительности на глубоких деревьях при каждом чтении.
   - Вспомогательная функция `buildDepartmentPath(nodeId, asOfDate)` инкапсулирует логику.

7. **Якорь бессмертен** — в `_node` таблицах хранится только то, что определяет идентичность сущности. Изменяемые атрибуты (юрисдикция, финансы, грейд, название) — только в `_version`.

## Порядок реализации

1. Справочники: work_schedule → tag → role
2. job_family → position_grade → position_template
3. cost_center_node + cost_center_version
4. legal_entity_node + legal_entity_version
5. department_node + department_version (с materialized path + каскад)
6. staff_unit_node + staff_unit_version
7. employee_appointment
8. virtual_team_node + virtual_team_version → team_member

Каждый шаг: Drizzle-схема → документ + list-мета → регистрация → миграция.
