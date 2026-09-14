---
title: workflow — parallel/inclusive gateway (AND/OR-ветвление, множественные токены)
type: plan
tier: 2
status: implemented
date: 2026-07-22
---

# workflow — parallel/inclusive gateway

Вопрос 2 из [2026-07-22-workflow-gateway-determinism-and-parallelism.md](2026-07-22-workflow-gateway-determinism-and-parallelism.md),
выделен в отдельный план. Реализовано 2026-07-22 по прямому запросу — контракты, миграция+бэкфилл,
токенизированный движок (fork/join), валидация структурной парности split/join, роуты, потребители
(module-hr-request), минимальный UI редактора (переключатель режима gateway).

**Статус верификации: typecheck/build чисты по всей монорепе, biome чист по изменённым файлам —
вживую НЕ прогнано.** В этом окружении недоступен Docker/Postgres (dev-БД не поднята), поэтому
миграция (включая бэкфилл), рантайм fork/join и особенно конкурентность на join (`FOR UPDATE`,
lost-wakeup) не проверены ни одним реальным запуском — только рассуждением при написании кода.
Прежде чем полагаться на это в реальном процессе — обязательно прогнать вручную (см. «Проверка» в
конце) на dev-окружении с поднятой БД, в идеале с намеренно конкурентными действиями на parallel-join.

## Проблема

Сегодня движок принципиально однопоточный: `process_instances.current_state` — один `varchar`,
`executeAction` завершает "все pending-задачи инстанса" одним UPDATE без `taskId` (расчитано на
ровно одну), `loadPendingTask` — `.limit(1)`, `AssigneeProvider.resolve()` возвращает одного
пользователя. Нужны сценарии «все согласующие одобрили» (AND) и «хотя бы один одобрил» (OR/inclusive)
— это ветвление графа на несколько одновременно активных путей, а не просто несколько исполнителей на
одном шаге (то был бы другой, гораздо более узкий паттерн — quorum-approval на одной ноде, — он
рассматривался и отклонён в пользу полноценного ветвления по прямому запросу).

Известное препятствие для реального применения: `hr_user_profile` пока не имеет `managerId`/оргструктуры
(см. комментарий в `fixedAssigneeProvider`, `packages/module-hr/src/backend/workflow-delegates.ts`) —
этот план закрывает только движковую часть, HR-делегат "руководитель → все подчинённые" реализуется
отдельно и позже, на этой инфраструктуре.

## Решение — модель токенов

Движок обобщается с «одна текущая нода на инстанс» до «N одновременно активных токенов на инстанс»,
где N=1 — это в точности сегодняшнее поведение (без частных случаев в коде: обычный
последовательный граф просто никогда не форкается, ветка кода для параллелизма не активируется).

### Контракты (`contracts/graph.ts`)

```typescript
export interface GatewayNode extends WorkflowNodeBase {
  type: 'gateway';
  /** По умолчанию 'exclusive' — существующие опубликованные версии без поля продолжают работать как есть. */
  mode?: 'exclusive' | 'parallel' | 'inclusive';
}
```

`WorkflowEdge` не меняется. На `parallel`-split рёбра без `condition` (все исходящие берутся всегда).
На `inclusive`-split — как у `exclusive` (condition + одно `isDefault`), но берутся **все**
совпавшие рёбра, не первое; `isDefault` активируется, только если не совпало ни одно.

### Роль gateway-ноды — по структуре графа, не отдельным полем

- `outgoing.length > 1 && incoming.length <= 1` → **split**.
- `incoming.length > 1 && outgoing.length === 1` → **join**.
- `outgoing.length > 1 && incoming.length > 1` на одной ноде — **запрещено валидацией**: смешанный
  fork/join в одной ноде делает учёт токенов неоднозначным (нода одновременно и порождает, и
  поглощает токены за один проход). Если нужно и то, и то — две ноды.
- `mode: 'exclusive'` не меняется вообще: несколько входящих рёбер на exclusive-ноде — как и
  сегодня, "простое слияние" без ожидания (первый пришедший токен проходит сразу, для этого не нужна
  корреляция с другими токенами — этот случай уже работает, потому что exclusive никогда не форкает).

### Обязательная структурная парность split/join (валидация при публикации)

Каждый `parallel`/`inclusive` split обязан сходиться в **ровно одной** join-ноде того же `mode`,
причём join должен получать входящие ровно от всех веток этого split (не больше, не меньше — ни
одна ветка не может "выпрыгнуть" из блока мимо join, ни один посторонний узел не может влить своё
ребро в чужой join).

Алгоритм (рекурсивный обход, вложенные parallel/inclusive-блоки — как непрозрачный переход split→join
одного уровня вложенности за раз, "SESE"-регион):

```
validateParallelBlock(split):
  joinCandidate = null
  memo = {}   // один на весь split — общий между сиблингами, см. обоснование в walkBranch ниже
  for edge in split.outgoing:
    exit = walkBranch(edge.target, boundary=split, pathStack=[split.id], memo)
    if exit == null: continue          // ошибка уже записана внутри walkBranch
    if joinCandidate == null: joinCandidate = exit
    else if exit != joinCandidate: error("ветки split сходятся в разных узлах")
  if joinCandidate == null: return
  if joinCandidate.mode != split.mode: error("join.mode не совпадает со split.mode")
  if incoming(joinCandidate).length != split.outgoing.length: error("join ждёт не все ветки split")

walkBranch(nodeId, boundary, pathStack, memo):
  // pathStack — предки ТЕКУЩЕГО пути (для детекции циклов), НЕ общий "посещено когда-либо":
  // ромбовидное схождение двух веток в одном узле ДО join — не цикл, а легитимный DAG, его нельзя
  // путать с возвратом к предку по тому же пути. memo — кэш "nodeId → уже посчитанный exit",
  // безопасно шарить между сиблингами: результат walkBranch(nodeId) не зависит от того, через какую
  // ветвь мы в nodeId попали.
  if memo.has(nodeId): return memo.get(nodeId)
  if nodeId in pathStack: error("цикл внутри parallel-блока — запрещено в v1"); return null
  node = find(nodeId)
  if node.type == 'end':
    result = null; error(`ветка завершается на "${nodeId}" до синхронизации`)
  elif isJoinCandidateFor(node, boundary):
    result = node
  elif node is parallel/inclusive SPLIT (вложенный):
    nestedJoin = validateParallelBlock(node)     // рекурсивно валидирует свой блок отдельно
    result = walkBranch(nestedJoin.outgoing[0].target, boundary, pathStack + [nodeId], memo)
  else:
    exits = [walkBranch(e.target, boundary, pathStack + [nodeId], memo) for e in node.outgoing]
    result = (all non-null exits equal (or all null)) ? that value : (error(`пути из узла "${nodeId}" расходятся к разным точкам`), null)
  memo.set(nodeId, result)
  return result
```

Важно: `walkBranch` не воспроизводит рантайм `advance()` (который останавливается на `userTask`) — это
статическая проверка достижимости для ЛЮБОГО из возможных исходов ноды с несколькими исходящими рёбрами
(exclusive-gateway с условиями, `userTask` с несколькими `action`), включая сам `userTask` внутри ветки
как валидный стоп-узел ветки (это и есть смысл — несколько параллельных согласующих). Единственный
жёсткий запрет — `end`-нода внутри незакрытого parallel-блока: экземпляр не может завершиться, пока не
все ветки синхронизировались, поэтому `end` разрешён только после join, не внутри блока. Циклы внутри
одного parallel-блока в v1 тоже запрещены (упрощение; закольцованная ветка потребовала бы versioned
токенов вместо простого count-based join — не тот объём, что нужен сейчас). Важно не путать этот
запрет с легитимным DAG-схождением: если две ветки одного split встречаются в общем узле ДО join
(ромб, не цикл — например обе идут через общий `serviceTask`, прежде чем разойтись дальше), это не
ошибка; ложное срабатывание тут возможно только при неверной реализации детекции циклов (общий
мутируемый "посещено" на все сиблинги вместо per-path стека — см. исправленный псевдокод ниже).

### Данные — токены вместо одиночного `current_state`

```sql
CREATE TABLE process_instance_forks (
  branch_group_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_instance_id uuid NOT NULL REFERENCES process_instances(id),
  parent_branch_group_id uuid REFERENCES process_instance_forks(branch_group_id),
  split_node_id varchar(100) NOT NULL,
  join_node_id varchar(100) NOT NULL,     -- известен статически из валидации при публикации
  expected_count integer NOT NULL,        -- parallel: число исходящих рёбер; inclusive: число реально
                                           -- активированных рёбер в этом конкретном прохождении
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE process_instance_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_instance_id uuid NOT NULL REFERENCES process_instances(id),
  node_id varchar(100) NOT NULL,
  branch_group_id uuid REFERENCES process_instance_forks(branch_group_id),  -- null = верхний уровень, не внутри форка
  status varchar(20) NOT NULL DEFAULT 'active',  -- active | consumed
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_process_instance_tokens_active ON process_instance_tokens (process_instance_id) WHERE status = 'active';
CREATE INDEX idx_process_instance_tokens_group ON process_instance_tokens (branch_group_id);
```

Каждый запущенный инстанс всегда имеет ≥1 активный токен — единообразно, без двух режимов движка:
обычный последовательный граф — это всегда ровно один токен с `branch_group_id = null`, который
никогда не форкается. `process_instances.current_state`/`current_state_code` остаются как денормализация
для случая единственного активного токена (99% инстансов, 100% для графов без parallel/inclusive-нод —
никакой миграции данных/поведения для существующих потребителей). Когда активных токенов больше
одного — колонки перестают быть авторитетными; авторитетный источник — `process_instance_tokens`.
Новый read-метод `WorkflowEngine.loadActiveTokens(instanceId)` — для UI/статусов, которым нужна полная
картина (см. «Задетые потребители» ниже).

### Fork (split)

При достижении split-ноды текущим токеном:
1. `parallel`: активируются все исходящие рёбра. `inclusive`: активируются рёбра, чьё `condition`
   совпало (может быть несколько), либо только `isDefault`, если не совпало ни одно.
2. Вставка одной строки в `process_instance_forks` (`expected_count` = число активированных рёбер,
   `parent_branch_group_id` = `branch_group_id` форкаемого токена — может быть `null`).
3. Форкаемый токен помечается `consumed`. Для каждого активированного ребра — новый токен
   (`branch_group_id` = только что созданный, `node_id` = `edge.target`).
4. Каждый новый токен независимо продолжает `advance()` — рекурсивно, в той же транзакции: может
   тут же упереться в `userTask`/`end`/`asyncTask` (стоп), удариться в ещё один split (вложенный форк,
   пункты 1–4 повторяются), либо дойти до join раньше остальных (см. ниже).

Итог одного вызова `executeAction`/`startProcess`/`completeAutomationJob` — уже не один `finalNode`,
а **массив** `Array<{ token, finalNode: UserTaskNode | EndNode | AsyncTaskNode }>`. `settle()` обходит
все элементы: на каждый `userTask`-токен — своя запись в `workflow_tasks` (см. ниже), на `end` —
проверка завершения инстанса (полное завершение возможно, только если это единственный оставшийся
активный токен — гарантировано валидацией, `end` недостижим внутри незакрытого блока).

### Join

При достижении join-ноды токеном со своим `branch_group_id = g`:
1. `SELECT * FROM process_instance_forks WHERE branch_group_id = $g FOR UPDATE` — блокирует
   bookkeeping-строку форка. Это и есть защита от гонки: если два токена одной группы завершаются
   параллельно из разных транзакций (два независимых согласующих одобряют почти одновременно), вторая
   транзакция дождётся коммита первой и увидит актуальный счётчик — без этого возможен classic
   lost-wakeup (обе видят "ещё не все пришли" и ни одна не продолжает процесс).

   Ограничение реализации: между этим `SELECT ... FOR UPDATE` и коммитом транзакции не должно быть
   ничего медленного (внешних вызовов, делегатов) — иначе последний согласующий, чьё действие
   выполняет реальный join, держит блокировку bookkeeping-строки дольше необходимого и сериализует
   всех, кто одновременно подтверждает разные ветки ТОГО ЖЕ форка. `runValidators`/делегаты, если они
   есть на join-ноде (join — транзитный узел, как gateway, делегатов не имеет по построению) — не
   актуально, но стоит держать в уме при будущих расширениях join.
2. Токен, дошедший до join, помечается `consumed`.
3. `SELECT count(*) FILTER (WHERE status='consumed') FROM process_instance_tokens WHERE branch_group_id = $g`.
   - Меньше `expected_count` → всё, на этом токене результат — **ничего** (не добавляет элемент в
     `finalNodes`; вызов, инициировавший это исполнение, просто увидит на один активный токен меньше,
     ждём остальных).
   - Равно `expected_count` → все ветки пришли: создаётся ОДИН токен-продолжение с
     `branch_group_id = fork.parent_branch_group_id` (возврат на уровень выше, `null` если это был
     верхнеуровневый блок), `node_id` = единственное исходящее ребро join. Он продолжает `advance()`
     как обычный токен (в том числе может сам тут же попасть в ЕЩЁ один join уровнем выше, если этот
     блок был веткой внешнего форка — рекурсия корректно замыкается благодаря
     `parent_branch_group_id`).
   - Больше `expected_count` → инвариант нарушен (баг в коде join, ручное вмешательство в БД и т.п.).
     Не создавать токен-продолжение молча — бросать `WorkflowValidationError` с деталями
     (`branch_group_id`, ожидаемое/фактическое число), чтобы испорченное состояние было видно сразу,
     а не проявилось позже как задвоенный/потерянный переход.

Один и тот же алгоритм для `parallel` и `inclusive` join — разница только в том, как `expected_count`
формируется при форке (все рёбра vs только реально активированные). Это стоит явно отметить в коде
комментарием — легко может показаться, что inclusive-join сложнее, на деле нет.

### `workflow_tasks` — множественные pending-задачи на инстанс

Сегодня `executeAction` завершает "все pending-задачи инстанса" одним UPDATE без `taskId` — держится
на инварианте "ровно одна pending-задача", который с параллельными ветками ломается: два согласующих
могут иметь по одной pending-задаче на один и тот же `process_instance_id` одновременно.

- `workflow_tasks` получает колонку `token_id uuid references process_instance_tokens(id)`.
- `executeAction` завершает **конкретную** задачу (`WHERE id = taskId`), не "все pending инстанса".
- `loadPendingTask(instanceId)` — `.limit(1)` перестаёт быть корректным (неоднозначность при >1
  активных userTask-токенах). Заменяется на `loadPendingTasks(instanceId): Task[]`.

**Тот же пробел есть у `workflow_automation_jobs`.** `completeAutomationJob` сегодня проверяет
`instance.currentState !== job.nodeId` как защиту от гонки/повторного вызова (см. `engine.ts:502`) —
это тоже неявно предполагает "у инстанса одна текущая позиция". С токенами: `workflow_automation_jobs`
получает `token_id uuid references process_instance_tokens(id)` (аналогично `workflow_tasks.token_id`),
и проверка меняется на "токен ещё активен и стоит на `job.nodeId`" вместо сравнения с
`instance.currentState`.

### Breaking change — `executeAction` меняет сигнатуру

`executeAction(processInstanceId, action, actingUser, opts)` → `executeAction(taskId, action,
actingUser, opts)`. Инстанс и версия резолвятся из задачи (`task.processInstanceId`), а не наоборот —
иначе "какую из N pending-задач завершает этот action" неоднозначно ровно в тех графах, ради которых
это всё делается.

Задетые потребители (проверено по коду, не гипотетически):

- `module-hr-request/src/backend/routes.ts:239-250` — сегодня: `loadPendingTask(row.processInstanceId)`
  → `executeAction(row.processInstanceId, action, ...)`. После изменения: маршрут должен получать
  `taskId` (либо от клиента, либо резолвить "какая из pending-задач принадлежит текущему
  пользователю" сам — при обычном последовательном графе это по-прежнему однозначно, ambiguity
  возникает только внутри параллельного блока).
- `module-hr-request/src/frontend/pages/request-card/ui/request-card-page.tsx` — вызывает
  `/hr-requests/{id}/actions/{action}` по id заявки, не задачи; `availableActions` вычисляются от
  единственной pending-задачи. При нескольких одновременных согласующих на одну заявку карточка
  заявителя не должна показывать чужие action-кнопки — нужно различать "мои pending-задачи по этой
  заявке" (может быть 0 или 1 для текущего пользователя, даже если у заявки в целом несколько
  активных токенов на разных согласующих).
- `packages/module-workflow/src/backend/routes/tasks.ts` (`/tasks/my`) — уже устойчив: фильтрует по
  `assigneeId`+`status`, не полагается на "одна задача на инстанс". Не меняется.
- `packages/module-workflow/src/backend/documents/process-instance.ts` (админ-документ) и
  `module-hr-request/src/backend/status.ts` (`resolveRequestStatus`) — оба читают `instance.currentState`
  как единственный источник статуса/лейбла. При активном форке это устаревшее значение (см. выше).
  Нужно либо явно показывать "в процессе синхронизации после {label скрещённого split}" по
  `currentStateCode`/факту наличия более 1 активного токена, либо (полнее, но больше работы) показывать
  список активных состояний. Для v1 — минимально: если `loadActiveTokens(instanceId).length > 1`,
  использовать label split-ноды с пометкой "(параллельно, N из M)"; точная детализация по каждому
  токену — отдельная итерация UX поверх этой инфраструктуры, не блокирует движковую часть. Если
  детализация понадобится раньше — форма естественно ложится на `loadActiveTokens`:
  `{ tokenId, nodeId, nodeLabel, assigneeId?, taskStatus?, branchGroupId?, splitNodeId? }[]` —
  `branchGroupId`/`splitNodeId` достаточно, чтобы фронт показал "одобрено N из M" простым подсчётом
  токенов с одинаковым `branchGroupId` (без похода в `process_instance_forks` за `expected_count` —
  тот же `loadActiveTokens` уже группирует это на бэкенде).

### Бэкфилл существующих инстансов при деплое

Не «миграция без переходного периода», как я изначально написал — это неверно. На момент выката
миграции в проде уже есть незавершённые `process_instances` без единой строки в
`process_instance_tokens` (таблица только что создана). Если новый код читает токены как источник
истины, первый же `executeAction`/`completeAutomationJob` на таком инстансе не найдёт токен и упадёт.

Обязательный шаг миграции (одной транзакцией с созданием таблиц, не отдельным релизом):

```sql
INSERT INTO process_instance_tokens (process_instance_id, node_id, branch_group_id, status)
SELECT id, current_state, null, 'active'
FROM process_instances
WHERE completed_at IS NULL;
```

Плюс связать существующие pending-задачи/джобы с новыми токенами:

```sql
UPDATE workflow_tasks t
SET token_id = pit.id
FROM process_instance_tokens pit
WHERE pit.process_instance_id = t.process_instance_id AND t.status = 'pending';

UPDATE workflow_automation_jobs j
SET token_id = pit.id
FROM process_instance_tokens pit
WHERE pit.process_instance_id = j.process_instance_id AND j.status IN ('pending', 'running');
```

Завершённые инстансы (`completed_at IS NOT NULL`) токенов не получают — им нечего доводить дальше.

### Компенсация/отмена параллельных веток — вне скоупа v1 (явное решение)

BPMN даёт на это Cancel Events/Compensation Handlers — не берём в v1. Явное правило: reject/любое
завершающее действие внутри одной ветки parallel/inclusive-блока маршрутизирует **только эту ветку**
по её собственному ребру (в том числе может привести эту ветку к `end` — но см. запрет `end` внутри
незакрытого блока: значит, ветка с "отказом" должна вести к join как и остальные, просто с другим
payload/пометкой, а не пытаться завершить процесс досрочно). Автоматической отмены "братьев" по
`branch_group_id` при негативном исходе одной ветки — нет. Если реальный кейс потребует "один reject
= весь блок отменяется", это отдельная задача поверх этой инфраструктуры (отмена токенов по
`branch_group_id`, закрытие их pending-задач как `cancelled`), сознательно отложенная — как и
`fixedAssigneeProvider`, без реального потребителя сейчас реализовывать её вслепую не стоит.

### Зависший join — видимость, не авто-отмена

Циклы внутри блока запрещены валидацией, но неверно опубликованный на проде граф (обойти валидацию
руками через прямой INSERT, или баг в самой валидации) либо просто "согласующий никогда не отреагирует"
могут оставить fork-группу вечно ждущей — без таймаута сегодня это неотличимо от "ещё в работе".
Для v1 — по аналогии с `workflow_automation_jobs.status='failed'` (видимо, без магии): admin-запрос/
фильтр по `process_instance_forks`, где `created_at` старше разумного порога и не все токены группы
`consumed`. Автоматический timeout+cancel не делаем — это то же нерешённое "что делать с остальными
ветками", что и в компенсации выше.

Смежный, но не новый пробел: в движке сегодня (и без parallel-веток) нет `cancelProcessInstance` —
отменить целиком уже запущенный последовательный процесс так же нельзя, кроме прямого вмешательства в
БД. Parallel/inclusive gateway делает отсутствие этой ручки заметнее (у зависшего join нет чистого
выхода кроме админ-визибилити выше), но это не проблема, которую вводит этот план — она была и
раньше. Если понадобится общий `cancelProcessInstance`, это отдельная задача поверх движка целиком
(пометить все активные токены/задачи `cancelled`, закрыть инстанс), не специфичная для параллелизма —
не включаю её в скоуп этого плана, чтобы не смешивать два независимых решения.

### Отклонённые альтернативы

- **Quorum-нода вместо ветвления графа** (один `userTask` с fan-out по нескольким assignee и
  политикой all/any/count, без токенов/join-нод вообще) — рассматривалась как более дешёвая
  альтернатива; отклонена по прямому запросу в пользу полноценного ветвления.
- **`current_state` → просто `jsonb`-массив id нод** вместо отдельной таблицы токенов — не даёт
  естественного места для `branch_group_id`/`parent_branch_group_id` (нужны для корректного join
  во вложенных блоках) без городить свою мини-структуру внутри jsonb; отдельная таблица даёт
  индексы и `FOR UPDATE` на уровне строк, а не документа целиком.
  - Смешанный fork/join в одной ноде (одна нода — и `outgoing.length>1`, и `incoming.length>1`) —
  отклонено: неоднозначно, что происходит раньше, объединение или разветвление, и что означает
  "текущий токен" внутри одного прохода `advance()`. Явные раздельные split/join-ноды дороже на
  канвасе (лишний узел), но однозначны.
- **Циклы внутри parallel-блока** (ветка возвращается назад и форкается повторно) — отклонено для v1:
  потребовало бы version-tag'ов на токенах вместо простого `count(consumed) == expected_count`,
  иначе повторный проход по кругу перепутает "старые" и "новые" токены той же `branch_group_id`.
  Циклы, целиком выходящие за пределы уже смёрженного (post-join) состояния — по-прежнему разрешены,
  как сегодня.

### Отличия реализации от исходного дизайна выше

- **Общий алгоритм split/join вынесен в `graph-analysis.ts`** (`resolveParallelBlock`) — используется
  и `validation.ts` (публикация), и `engine.ts` (рантайм форка, чтобы узнать `joinNodeId`), вместо
  дублирования walk-алгоритма в двух местах.
- **HTTP-роуты остались keyed по `processInstanceId`/`requestId`**, не по `taskId` — `taskId`
  резолвится на сервере (среди `loadPendingTasks(instanceId)` ищем задачу текущего пользователя).
  Изменился только сам движковый метод `executeAction(taskId, ...)` — ровно как в плане. Решение:
  не тащить `taskId` во фронтенд и клиентский API ради единообразия URL, раз сервер и так знает,
  какая из pending-задач принадлежит вызывающему.
- **`resolveRequestStatus`/админ-документ не потребовали изменений кода** — денормализация
  `currentState` (см. `syncCurrentStateLabel` в движке) уже отдаёт осмысленный label (label split-ноды
  при активном форке) через тот же путь чтения, что и раньше. Явная детализация "N из M" не сделана —
  как и было решено, отдельная итерация поверх `loadActiveTokens`.
- **`request-card-page.tsx` не менялся** — по той же причине: `availableActions`/`isAssignee` уже
  приходят из роута корректно вычисленными для текущего пользователя.
- **`workflow_automation_jobs` тоже получил `token_id`** — не было явно в исходном списке файлов,
  добавлено по факту (см. «Тот же пробел есть у `workflow_automation_jobs`» выше).
- **Визуал split/join на канвасе — упрощён**: вместо разных иконок для split/join (потребовало бы
  знать число рёбер внутри компонента ноды) сделан текстовый суффикс режима на самой gateway-ноде
  (`· AND` / `· OR`) + смена цвета рамки, плюс mode-осведомлённая форма ребра в properties-panel
  (для parallel — без condition/isDefault, для inclusive — с пометкой "активируются ВСЕ совпавшие").
  `node-palette.tsx` не менялся — режим ставится после перетаскивания, в properties-panel.
- **Порядковый номер на рёбрах exclusive-gateway** (из соседнего плана, `withGatewayEdgeOrder`)
  дополнительно ограничен только `mode === 'exclusive'` — для parallel/inclusive номер был бы
  вводящим в заблуждение намёком на приоритет, которого не существует.

## Изменения по файлам

| Файл | Действие |
|------|----------|
| `module-workflow/src/contracts/graph.ts` | `GatewayNode.mode` |
| `module-workflow/src/backend/graph-analysis.ts` (новый) | `resolveParallelBlock()` — общий алгоритм для validation.ts и engine.ts |
| `module-workflow/migrations/0005_process_instance_tokens.sql` | Таблицы `process_instance_forks`, `process_instance_tokens`, индексы + бэкфилл существующих незавершённых инстансов |
| `module-workflow/migrations/meta/_journal.json` | Регистрация миграции 0005 |
| `module-workflow/src/backend/schemas/process-instance-forks.ts`, `process-instance-tokens.ts` (новые) | Схемы + типы обеих таблиц |
| `module-workflow/src/backend/schemas/workflow-tasks.ts` | `token_id` колонка (nullable) |
| `module-workflow/src/backend/schemas/workflow-automation-jobs.ts` | `token_id` колонка (nullable) |
| `module-workflow/src/backend/schemas/index.ts` | Экспорт новых схем/типов |
| `module-workflow/src/backend/validation.ts` | Роль split/join по структуре, вызов `resolveParallelBlock`, запрет смешанного fork/join, запрет condition/isDefault на parallel, дедупликация ошибок |
| `module-workflow/src/backend/services/engine.ts` | Токенизированный `advanceToken()`/`forkToken()`/`joinToken()`; `TokenAdvanceResult.results: Array<{token, finalNode}>`; `settle()` по массиву; `syncCurrentStateLabel()`; `executeAction(taskId, ...)`; `loadPendingTasks`; `loadActiveTokens`; `completeAutomationJob` сверяет активность токена |
| `module-workflow/src/backend/routes/processes.ts` | `loadPendingTasks` + резолв задачи текущего пользователя, `taskId` в ответе GET |
| `module-hr-request/src/backend/routes.ts` | То же самое для `/hr-requests/:id` и `/hr-requests/:id/actions/:action` |
| `module-workflow/src/frontend/lib/graph-mapping.ts` | `EditorNodeData.mode`, туда-обратно в конфиг; `withGatewayEdgeOrder` ограничен exclusive |
| `module-workflow/src/frontend/widgets/properties-panel/ui/properties-panel.tsx` | Select режима gateway; mode-осведомлённый `EdgeForm` |
| `module-workflow/src/frontend/widgets/workflow-node-types/ui/workflow-node-types.tsx` | Суффикс режима + цвет рамки на gateway-ноде |
| `module-workflow/src/frontend/pages/workflow-editor/ui/workflow-editor-page.tsx` | `edgeSourceMode` в `PropertiesPanel` |

## Порядок реализации

- [x] Контракты: `GatewayNode.mode`
- [x] Миграция `process_instance_forks`/`process_instance_tokens` + `token_id` на `workflow_tasks` и
      `workflow_automation_jobs` + бэкфилл существующих незавершённых инстансов
- [x] Валидация: роль split/join по структуре, `resolveParallelBlock`, весь список запретов
- [x] `engine.ts`: токенизированный `advanceToken()`, форк, join (с `FOR UPDATE` на fork-строку),
      `settle()` по массиву результатов, `executeAction(taskId, ...)`, `loadPendingTasks`,
      `loadActiveTokens`
- [x] Обновить `module-hr-request` под новую сигнатуру `executeAction`/резолв задачи
- [x] Редактор: `mode`-переключатель на gateway, mode-осведомлённая форма ребра, текстовый индикатор режима на канвасе
- [x] Статусы (`resolveRequestStatus`, админ-документ, request-card) — изменений не потребовалось (денормализация уже отдаёт корректный label, см. «Отличия реализации»)
- [x] `turbo build`/`typecheck` + biome — чисто по всей монорепе (apps/api, apps/web включительно)

**Не прогнано вживую** (нет доступного Docker/Postgres в этом окружении) — см. предупреждение в
начале документа. Пункты «Проверка» ниже не выполнены ни разу реальным запуском.

## Проверка (после реализации)

1. Публикация графа с `parallel`-split, чьи ветки сходятся в РАЗНЫХ нодах → 4xx с понятной ошибкой.
2. Публикация графа с `end` внутри незакрытого parallel-блока → 4xx.
3. Запуск процесса через `parallel`-split с 3 ветками (каждая — `userTask` на разного согласующего) →
   все 3 задачи видны одновременно (`/tasks/my` каждого согласующего), инстанс не завершён.
4. Два согласующих выполняют action почти одновременно (искусственно — параллельные запросы) → join
   срабатывает ровно один раз, процесс продолжается один раз, не дважды.
5. `inclusive`-split с 2 из 3 совпавших условий → `expected_count=2`, join ждёт именно 2, а не 3.
6. Вложенный parallel-блок внутри одной ветки внешнего parallel-split — оба уровня синхронизируются
   корректно, внешний join не срабатывает раньше времени.
7. Существующий (чисто последовательный, без `mode`) граф — поведение и `current_state` не
   отличаются от текущих до этого плана.
8. Инстанс, стартовавший ДО деплоя миграции (на старом коде, без токенов) — после бэкфилла успешно
   проходит `executeAction` дальше, как будто ничего не менялось.
9. Reject-действие внутри одной ветки parallel-блока не отменяет активные задачи на других ветках
   того же `branch_group_id` (явный вырез v1, см. «Компенсация»).
