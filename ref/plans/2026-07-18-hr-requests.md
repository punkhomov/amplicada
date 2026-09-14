---
title: module-hr-request — портальные заявки поверх module-workflow
type: plan
tier: 2
status: implemented
date: 2026-07-18
---

# module-hr-request — портальные заявки поверх module-workflow

Первый доменный потребитель движка `module-workflow`
([2026-07-16-workflow.md](2026-07-14-workflow/2026-07-16-workflow.md)). Базовый дизайн, «не
запариваясь»: несколько портальных страниц, минимум новых механизмов.

## Текущая проблема

1. `module-workflow` — инфраструктура: движок, редактор, админские страницы. Портального UI для
   сотрудника (создать заявку, заполнить поля, отправить, согласовать) нет — это было явно вне
   скоупа.
2. Generic runtime API (`/api/workflows/*`) не должен быть поверхностью для портала: у каждого
   потребителя движка — своё доменное API. Заявки — первый такой потребитель.
3. Заявке нужен черновик до попадания в workflow (сотрудник заполнил, но не отправил) — у движка
   такого состояния нет и не должно быть.
4. Неочевиден UX статусов: отдельного справочника статусов в движке нет намеренно — статус это
   нода графа. Нужно спроектировать, как это выглядит для пользователя.

## Решение

Новый пакет `@amplicada/module-hr-request`: таблица `hr_requests` (черновик + поля + ссылка на
`process_instance`), собственное API `/api/hr-requests/*`, реестр типов заявок в коде, портальные
страницы (layout `app`). Плюс три небольшие доработки в `module-workflow`, которые нужны любому
программному потребителю (не только заявкам).

## Доработки module-workflow (пререквизит, мелкие)

1. **Движок как сервис**: `WorkflowEngine` сейчас создаётся внутри `setup()` и доступен только
   роутам. Регистрируем его в `context.services('workflow-engine')` — потребители вызывают
   `startProcess`/`executeAction`/`loadPendingTask`/`loadFrozenConfig` in-process. Экспортировать
   токен `WORKFLOW_ENGINE_TOKEN` из contracts (по образцу `WORKFLOW_REGISTRY_TOKEN`).
2. **Generic-делегат `process-initiator`** («Инициатор заявки»): резолвит исполнителя из
   `context.startedBy` (движок уже пишет его при старте). Регистрируется самим `module-workflow` —
   он не доменный, нужен всем (черновик-нода, «вернуть автору на доработку»). Единственный
   делегат, который движок регистрирует сам, — осознанное исключение из «module-workflow
   делегатов не регистрирует» (он не знает домена и здесь его по-прежнему не знает).
3. **`outcome` на End-ноде** (для UX статусов, см. ниже): опциональное поле
   `outcome?: 'success' | 'failure'` в `EndNode` + селектор «Тип завершения» в properties panel
   редактора. Движок его не интерпретирует — чисто витринная семантика для бейджей.

## Модель данных

```sql
CREATE TABLE hr_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type varchar(100) NOT NULL,              -- код типа заявки (= код workflow, см. реестр типов)
  title varchar(255) NOT NULL,             -- заголовок для списков, генерится формой типа
  fields jsonb NOT NULL DEFAULT '{}',      -- поля формы (link, description, cost, ...)
  status varchar(20) NOT NULL DEFAULT 'draft',  -- draft | submitted (дальше статус живёт в process)
  process_instance_id uuid REFERENCES process_instances(id),  -- null, пока черновик
  created_by uuid NOT NULL REFERENCES identity_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);
CREATE INDEX idx_hr_requests_created_by ON hr_requests(created_by, status);
```

Ключевое: **черновик — не workflow-состояние**. До `submit` заявка живёт только в `hr_requests`,
процесса не существует. При submit: поля копируются в `payload`, вызывается
`engine.startProcess(type, payload, userId)`, сохраняется `process_instance_id`,
`status = 'submitted'`. После submit поля заявки в `hr_requests` становятся read-only витриной —
источник истины для маршрутизации — `payload` процесса (правки «на доработке» идут через
`executeAction` с payload-patch и синхронизируются обратно в `fields`).

## Реестр типов заявок

В коде, без БД (v1): тип заявки = код workflow + форма.

```typescript
// contracts
interface RequestTypeDefinition {
  code: string;          // = workflows.code (напр. 'external-training')
  label: string;         // 'Заявка на внешнее обучение'
  buildTitle: (fields: Record<string, unknown>) => string;  // заголовок для списков
}
// frontend-реестр дополнительно: FormComponent (React-форма полей типа)
```

Backend-реестр — `Map` в сервисе `hr-requests-types` (по образцу delegate-реестра). Первый тип —
`external-training` с полями: `link` (ссылка на обучение), `description` (обоснование),
`cost` (стоимость, number — по нему Gateway в графе: `payload.cost < 20000`).

Сам workflow-граф для типа рисуется в админке как обычно — модуль его не создаёт и не валидирует,
только требует, чтобы `workflows.code` совпадал с `type` (submit упадёт понятной ошибкой, если
workflow не опубликован).

## API (`/api/hr-requests`, auth по образцу module-workflow)

| Метод | Путь | Что |
|---|---|---|
| `GET` | `/types` | Список зарегистрированных типов (для страницы «создать») |
| `POST` | `/` | Создать черновик `{ type, fields }` |
| `GET` | `/my` | Мои заявки (+ статус, см. UX ниже) |
| `GET` | `/inbox` | Заявки, ждущие моего действия (JOIN `workflow_tasks` pending по assignee с `hr_requests`) |
| `GET` | `/:id` | Заявка + статус + `availableActions`/`isAssignee` + таймлайн (прокси к engine) |
| `PATCH` | `/:id` | Правка `fields`/`title` — **только draft и только автором** |
| `POST` | `/:id/submit` | Старт процесса (только draft, только автор) |
| `POST` | `/:id/actions/:action` | Действие согласующего `{ comment?, fields? }` — обёртка над `engine.executeAction` (проверка assignee — как в module-workflow), `fields` мержится в payload-patch и в `hr_requests.fields` |
| `DELETE` | `/:id` | Удалить — только draft, только автор |

Портал ходит **только** сюда; generic `/api/workflows/*` остаётся для админки и отладки.

## UX статусов (ответ на «неочевидно, что отдельных статусов нет»)

Статус заявки — вычисляемое поле, которое бэкенд отдаёт готовым в каждом списке/детали:

```typescript
interface RequestStatus {
  kind: 'draft' | 'in-progress' | 'done-success' | 'done-failure';
  label: string;  // что показывать в бейдже
}
```

- `draft` → label «Черновик» (серый бейдж);
- процесс идёт → `kind: 'in-progress'`, **label = label текущей UserTask-ноды** из frozen-конфига
  («На согласовании у руководителя», «Согласование HR») — то есть названия статусов админ задаёт,
  называя ноды в редакторе, отдельного справочника нет и не нужно;
- процесс завершён → label = label End-ноды («Согласована» / «Отклонена»), `kind` — из
  `EndNode.outcome` (`success` → зелёный, `failure` → красный, не задан → нейтральный).

Резолв label'ов — по `process_instances.current_state` + конфиг версии; конфиги версий кэшируются
в памяти (immutable — кэш безопасен), так что `/my`-список не читает конфиг на каждую строку.

## Страницы портала (layout `app`)

| Роут | Что |
|---|---|
| `/requests` | Мои заявки: таблица (тип, заголовок, статус-бейдж, дата) + кнопка «Создать» + вкладка/секция «Входящие» (инбокс согласующего) |
| `/requests/new/:type` | Форма типа (из frontend-реестра), «Сохранить черновик» / «Отправить» (create+submit) |
| `/requests/:id` | Карточка: поля, статус, таймлайн (переиспользуем подход process-timeline-page), кнопки действий с комментарием — если я согласующий; редактирование — если draft и я автор |

Навигация: `context.navigation.register({ label: 'Заявки', path: '/requests' })`.

## Зависимости

| Что | Направление |
|---|---|
| `module-hr-request` → `module-workflow` | contracts (токены, типы) + engine из services. Required-зависимость |
| `module-hr-request` → `module-hr` | **нет** — делегаты графа ссылаются по строковым id, модулю заявок они не нужны |

Новых npm-пакетов нет.

## Изменения по файлам

### module-workflow (пререквизит)

| Файл | Действие |
|------|----------|
| `src/contracts/registry.ts` | `WORKFLOW_ENGINE_TOKEN` |
| `src/contracts/graph.ts` | `EndNode.outcome?: 'success' \| 'failure'` |
| `src/backend/setup.ts` | Создавать engine всегда (не только при `app`), `services.register(WORKFLOW_ENGINE_TOKEN, engine)`; регистрация делегата `process-initiator` |
| `src/backend/delegates.ts` | Создать — `processInitiatorProvider` |
| `src/frontend/components/properties-panel.tsx` | Селектор «Тип завершения» для End-ноды |

### module-hr-request (новый пакет, по шаблону module-workflow)

| Файл | Действие |
|------|----------|
| `package.json`, `tsconfig.json`, `migrations/0000_create_hr_requests.sql` | Скелет + таблица |
| `src/contracts/` | `RequestTypeDefinition`, DTO статуса/списков, `HR_REQUEST_TYPES_TOKEN` |
| `src/backend/schema.ts`, `types-registry.ts`, `status.ts` | Таблица, реестр типов, резолв `RequestStatus` (+ кэш конфигов) |
| `src/backend/routes.ts`, `setup.ts` | API из таблицы выше; регистрация типа `external-training` |
| `src/frontend/` | Реестр форм, 3 страницы, `setup.tsx` (роуты + navigation), `tailwind.css` |
| `apps/api`, `apps/web` | Подключить модуль (после `workflowModule`) |

## Порядок реализации

- [x] Доработки module-workflow (engine-сервис `WORKFLOW_ENGINE_TOKEN`, `process-initiator`,
      `EndNode.outcome` + селектор «Тип завершения» в панели)
- [x] Скелет пакета + миграция + contracts
- [x] Backend: реестр типов, резолв статуса (`status.ts` + `WorkflowConfigCache`), роуты, тип
      `external-training`
- [x] Frontend: список «Мои заявки» + секция «Ждут моего решения», форма создания, карточка заявки
      (редактирование черновика, действия согласующего, история)
- [x] Подключение в apps, build/typecheck/biome чисто, инвариант проверен

Статус: реализовано 2026-07-18, вживую не прогнано (раздел «Проверка» — за пользователем).

**Ревизия (та же дата): типы заявок переведены из кода в админку.** Раздел «Реестр типов заявок»
выше устарел: по решению пользователя типы управляются как отдельный Document «Типы заявок»
(`hr_request_types`: code/label/titleTemplate/formFields/portalEnabled; осознанно НЕ расширение
документа workflow — он универсален, тип заявки — конфиг потребителя). `buildTitle` →
шаблон-строка `{ключ}`-подстановок; React-форма → декларативные `RequestFormField[]` +
generic-рендерер на портале; мини-редактор полей — кастомный компонент группы карточки
(`registerComponent` наконец экспортирован из module-admin — закрыт хвост фазы 04 workflow-плана;
hr-requests получил peer-зависимость на module-admin). Версионности конфига формы нет (payload
самодостаточен); известное ограничение: переименование ключа поля не мигрирует условия Gateway
текущего графа (сверка-предупреждение при сохранении — отложена). Кодовый реестр
(`types-registry.ts`, `external-training.ts`, `ExternalTrainingForm`) удалён; `registerRequestForm`
оставлен как escape hatch для кастомных форм по коду типа. Тип external-training пересоздаётся
админом через UI.

Уточнения по ходу (первая итерация):
- В `RequestStatus.kind` добавлен пятый вариант `done` — End-нода без заданного `outcome`
  (нейтральный бейдж), план описывал только 4
- Черновики видны только автору на уровне `GET /:id` (404 для остальных) — план это явно не
  оговаривал
- DropdownMenu в ядре — Base UI, без `asChild` (Radix-паттерн) — триггер «Создать» стилизован
  className'ом по образцу admin-layout

## Проверка (сквозная, руками)

1. Нарисовать в админке граф `external-training`: Start → «На согласовании у руководителя»
   (fixed-assignee) → Gateway (`payload.cost < 20000` → «Согласование HR подразделения», default →
   «Согласование HR организации») → End «Согласована» (`outcome: success`); reject-рёбра → End
   «Отклонена» (`outcome: failure`)
2. Портал: создать черновик (статус «Черновик»), отправить → статус «На согласовании у
   руководителя», у согласующего заявка появилась в инбоксе
3. Approve при cost 15000 и 50000 → разные ветки HR
4. Дойти до конца → зелёный бейдж «Согласована»; reject → красный «Отклонена»
5. PATCH полей после submit → 4xx; правка черновика — ок

## Отложено

- Формы типов из декларативной схемы (генерация UI) — v1 пишет React-форму руками на тип
- Делегаты по оргструктуре (руководитель, HR подразделения/организации) — ждут `managerId` и
  сущностей подразделений в HR-домене; до них в графе живёт `fixed-assignee`
- Уведомления согласующему (инбокс пассивный, без пушей) — потенциально ServiceTask-нода + канал
  уведомлений, отдельная тема
