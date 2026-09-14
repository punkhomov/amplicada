import type { BackendDbService, BackendDocumentRuntime } from '@amplicada/platform-core/contracts/backend';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { WorkflowDocuments } from '../../contracts/documents.js';
import type {
  AsyncTaskNode,
  EndNode,
  GatewayNode,
  UserTaskNode,
  WorkflowEdge,
  WorkflowNode,
  WorkflowVersionConfig,
} from '../../contracts/graph.js';
import type { DelegateContext, WorkflowRegistry } from '../../contracts/registry.js';
import { evaluateCondition } from '../conditions.js';
import { InvalidActionError, ValidatorFailedError, WorkflowNotFoundError, WorkflowValidationError } from '../errors.js';
import { resolveParallelBlock } from '../graph-analysis.js';
import {
  type PayloadDiff,
  type ProcessInstanceForkRow,
  type ProcessInstanceRow,
  type ProcessInstanceTokenRow,
  processInstanceForks,
  processInstances,
  processInstanceTokens,
  type WorkflowAutomationJobRow,
  workflowAuditLog,
  workflowAutomationJobs,
  workflows,
  workflowTasks,
  workflowVersions,
} from '../schemas/index.js';
import { validateWorkflowConfig } from '../validation.js';

/** Защита от цикла из транзитных нод в некорректно спроектированном графе (на один сегмент между стоп-узлами). */
const MAX_TRANSIT_HOPS = 100;

interface AdvanceHop {
  from: string;
  to: string;
}

/**
 * Один "проход" `advanceToken()` может произвести НЕСКОЛЬКО остановок сразу — если по пути встретился
 * parallel/inclusive split, который тут же разошёлся на несколько userTask/end/asyncTask. `hops` —
 * плоский список всех переходов (для аудита), `results` — все стоп-точки, до которых дошли токены
 * (может быть 0, если все ветки этого вызова упёрлись в join и ждут братьев).
 */
interface TokenAdvanceResult {
  results: Array<{ token: ProcessInstanceTokenRow; finalNode: UserTaskNode | EndNode | AsyncTaskNode }>;
  hops: AdvanceHop[];
}

/** Кто инициировал переход — для аудита и для writeAuditHops (каскад атрибутируется тому же). */
interface AuditActor {
  id: string | null;
  type: 'user' | 'system';
}

export interface WorkflowEngineDeps {
  db: BackendDbService;
  registry: WorkflowRegistry;
  documentRuntime: BackendDocumentRuntime;
}

/**
 * Транзакционность: каждый мутирующий метод (publishVersion/startProcess/executeAction) атомарен —
 * либо открывает собственную транзакцию, либо (opts.db) выполняется в переданной извне, позволяя
 * потребителю (module-hr-request и т.п.) включить свои записи в ту же транзакцию. Внешний db
 * обязан уже быть транзакцией — движок savepoint'ов не создаёт.
 *
 * Граница гарантии: откатывается только состояние движка (instance/tokens/tasks/audit/versions).
 * Побочные эффекты делегатов (serviceTask с внешним HTTP-вызовом и т.п.) rollback не отменяет —
 * стандартное ограничение BPM-движков, делегаты должны быть идемпотентными по возможности.
 *
 * Модель токенов (см. ref/plans/2026-07-22-workflow-parallel-gateway.md): движок обобщён с "одна
 * текущая нода на инстанс" до "N активных токенов на инстанс" — обычный последовательный граф это
 * всегда ровно один токен с branchGroupId=null, который никогда не форкается, без частных случаев в
 * коде. `process_instances.currentState`/`currentStateCode` остаются денормализацией для случая
 * единственного активного токена — авторитетный источник при активном форке — `process_instance_tokens`.
 */
export class WorkflowEngine {
  constructor(private deps: WorkflowEngineDeps) {}

  /** В переданной транзакции или в собственной. */
  private inTransaction<T>(external: BackendDbService | undefined, fn: (db: BackendDbService) => Promise<T>): Promise<T> {
    return external ? fn(external) : this.deps.db.transaction(fn);
  }

  // ---- Версионирование ----

  async publishVersion(workflowId: string, rawConfig: unknown, publishedBy: string, opts: { db?: BackendDbService } = {}) {
    const result = validateWorkflowConfig(rawConfig, this.deps.registry);
    if (!result.valid) throw new WorkflowValidationError(result.errors);
    const config = rawConfig as WorkflowVersionConfig;

    return this.inTransaction(opts.db, async db => {
      const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1).for('update');
      if (!workflow) throw new WorkflowNotFoundError(`Шаблон процесса "${workflowId}" не найден`);

      const [latest] = await db
        .select({ versionNumber: workflowVersions.versionNumber })
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, workflowId))
        .orderBy(desc(workflowVersions.versionNumber))
        .limit(1);
      const versionNumber = (latest?.versionNumber ?? 0) + 1;

      const [version] = await db.insert(workflowVersions).values({ workflowId, versionNumber, config, createdBy: publishedBy }).returning();
      await db.update(workflows).set({ currentVersionId: version.id }).where(eq(workflows.id, workflowId));
      return version;
    });
  }

  // ---- Runtime ----

  async startProcess(
    workflowCode: string,
    payload: Record<string, unknown>,
    startedBy: string,
    opts: { db?: BackendDbService } = {},
  ): Promise<ProcessInstanceRow> {
    const { instance, automationJobIds } = await this.inTransaction(opts.db, async db => {
      const [workflow] = await db.select().from(workflows).where(eq(workflows.code, workflowCode)).limit(1);
      if (!workflow?.isActive) throw new WorkflowNotFoundError(`Процесс "${workflowCode}" не найден или неактивен`);
      if (!workflow.currentVersionId) throw new InvalidActionError(`У процесса "${workflowCode}" нет опубликованной версии`);

      const [version] = await db.select().from(workflowVersions).where(eq(workflowVersions.id, workflow.currentVersionId)).limit(1);
      if (!version) throw new WorkflowNotFoundError(`Версия процесса "${workflowCode}" не найдена`);
      const config = version.config;

      const startNode = config.nodes.find(n => n.type === 'start');
      if (!startNode) throw new WorkflowValidationError(['В опубликованной версии нет стартовой ноды']);

      const instanceContext: Record<string, unknown> = { startedBy };
      // creatable: false у типа 'process' — создание идёт мимо DocumentRuntime.create(), поэтому
      // id берётся из document_index явно, в той же транзакции. Порядок обязателен:
      // process_instances.id ссылается на индекс внешним ключом.
      const instanceId = await this.deps.documentRuntime.allocateDocumentId(WorkflowDocuments.WORKFLOW_PROCESS, db);
      const [instance] = await db
        .insert(processInstances)
        .values({
          id: instanceId,
          workflowVersionId: version.id,
          workflowCode,
          currentState: startNode.id,
          payload,
          context: instanceContext,
          createdBy: startedBy,
        })
        .returning();

      const [rootToken] = await db
        .insert(processInstanceTokens)
        .values({ processInstanceId: instance.id, nodeId: startNode.id, branchGroupId: null, status: 'active' })
        .returning();

      const ctx: DelegateContext = { payload, context: instanceContext, db };
      const { results, hops } = await this.advanceToken(config, rootToken, ctx, db);
      await this.writeAuditHops(db, instance.id, { id: startedBy, type: 'user' }, hops);
      // Симметрично executeAction: сохраняем payload после advance — иначе мутации serviceTask-провайдера
      // (контракт: ctx.payload по ссылке) теряются, т.к. insert выше случился раньше advance.
      await db.update(processInstances).set({ payload: ctx.payload }).where(eq(processInstances.id, instance.id));
      const { automationJobIds } = await this.settle(db, instance.id, results, config, ctx);

      return { instance: await this.reload(db, instance.id), automationJobIds };
    });

    // Eager-триггер: если opts.db — внешняя, ещё не закоммиченная транзакция, claim в runAutomationJob
    // просто не найдёт строку и молча выйдет — подберёт периодический воркер на следующем тике.
    for (const id of automationJobIds) void this.runAutomationJob(id);
    return instance;
  }

  /**
   * `taskId`, не `processInstanceId` — с parallel/inclusive gateway на инстанс может быть несколько
   * одновременных pending-задач (разные ветки), поэтому какую именно завершает вызов — неоднозначно
   * без явного taskId. Инстанс и версия резолвятся из задачи, не наоборот.
   */
  async executeAction(
    taskId: string,
    action: string,
    actingUser: string,
    options: { payloadPatch?: Record<string, unknown>; comment?: string; db?: BackendDbService } = {},
  ): Promise<ProcessInstanceRow> {
    const { instance, automationJobIds } = await this.inTransaction(options.db, async db => {
      const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1).for('update');
      if (!task) throw new WorkflowNotFoundError(`Задача "${taskId}" не найдена`);
      if (task.status !== 'pending') throw new InvalidActionError('Задача уже выполнена');
      if (!task.tokenId) {
        throw new WorkflowValidationError([`Задача "${taskId}" без token_id (устаревшая запись до модели токенов) — действие недоступно`]);
      }

      // FOR UPDATE сериализует конкурентные действия над одним процессом: второй вызов дождётся
      // коммита первого, перечитает состояние и получит корректный InvalidActionError вместо
      // двойного перехода/двух созданных задач.
      const [instance] = await db
        .select()
        .from(processInstances)
        .where(eq(processInstances.id, task.processInstanceId))
        .limit(1)
        .for('update');
      if (!instance) throw new WorkflowNotFoundError(`Процесс "${task.processInstanceId}" не найден`);
      if (instance.completedAt) throw new InvalidActionError('Процесс уже завершён');

      const [token] = await db
        .select()
        .from(processInstanceTokens)
        .where(eq(processInstanceTokens.id, task.tokenId))
        .limit(1)
        .for('update');
      if (token?.status !== 'active') {
        throw new WorkflowValidationError([`Токен задачи "${taskId}" не активен — некорректное состояние`]);
      }

      const [version] = await db.select().from(workflowVersions).where(eq(workflowVersions.id, instance.workflowVersionId)).limit(1);
      if (!version) throw new WorkflowNotFoundError(`Версия "${instance.workflowVersionId}" не найдена`);
      const config = version.config;

      const node = this.findNode(config, token.nodeId);
      if (node.type !== 'userTask') {
        throw new InvalidActionError(`Текущее состояние "${token.nodeId}" не ожидает действий пользователя`);
      }

      const edge = config.edges.filter(e => e.source === node.id).find(e => e.action === action);
      if (!edge) throw new InvalidActionError(`Действие "${action}" недоступно из состояния "${node.label}"`);

      const patchKeys = Object.keys(options.payloadPatch ?? {});
      if (patchKeys.length) {
        const allowed = new Set(node.editableKeys ?? []);
        const forbidden = patchKeys.filter(key => !allowed.has(key));
        if (forbidden.length) {
          throw new InvalidActionError(`Нода "${node.id}" (${node.label}): недопустимые ключи payload: ${forbidden.join(', ')}`);
        }
      }

      const payload = { ...instance.payload, ...(options.payloadPatch ?? {}) };
      const ctx: DelegateContext = { payload, context: instance.context, db };
      await this.runValidators(node.validatorIds ?? [], ctx);

      await db.update(workflowTasks).set({ status: 'completed', completedAt: new Date() }).where(eq(workflowTasks.id, taskId));

      const payloadDiff: PayloadDiff = {};
      for (const key of patchKeys) {
        const from = instance.payload[key];
        const to = payload[key];
        if (from !== to) payloadDiff[key] = { from, to };
      }

      await db.insert(workflowAuditLog).values({
        processInstanceId: instance.id,
        actorId: actingUser,
        actorType: 'user',
        action,
        fromState: node.id,
        toState: edge.target,
        comment: options.comment ?? null,
        payloadDiff: Object.keys(payloadDiff).length ? payloadDiff : null,
      });

      await db.update(processInstanceTokens).set({ nodeId: edge.target }).where(eq(processInstanceTokens.id, token.id));
      const movedToken: ProcessInstanceTokenRow = { ...token, nodeId: edge.target };

      const { results, hops } = await this.advanceToken(config, movedToken, ctx, db);
      await this.writeAuditHops(db, instance.id, { id: actingUser, type: 'user' }, hops);
      await db.update(processInstances).set({ payload: ctx.payload }).where(eq(processInstances.id, instance.id));
      const { automationJobIds } = await this.settle(db, instance.id, results, config, ctx);

      return { instance: await this.reload(db, instance.id), automationJobIds };
    });

    for (const id of automationJobIds) void this.runAutomationJob(id);
    return instance;
  }

  // ---- Read-only помощники (вне транзакций движка) ----

  async loadInstance(id: string): Promise<ProcessInstanceRow> {
    const [instance] = await this.deps.db.select().from(processInstances).where(eq(processInstances.id, id)).limit(1);
    if (!instance) throw new WorkflowNotFoundError(`Процесс "${id}" не найден`);
    return instance;
  }

  async loadFrozenConfig(workflowVersionId: string): Promise<WorkflowVersionConfig> {
    const [version] = await this.deps.db.select().from(workflowVersions).where(eq(workflowVersions.id, workflowVersionId)).limit(1);
    if (!version) throw new WorkflowNotFoundError(`Версия "${workflowVersionId}" не найдена`);
    return version.config;
  }

  /** Все pending-задачи инстанса — с parallel/inclusive gateway их может быть больше одной одновременно. */
  async loadPendingTasks(processInstanceId: string) {
    return this.deps.db
      .select()
      .from(workflowTasks)
      .where(and(eq(workflowTasks.processInstanceId, processInstanceId), eq(workflowTasks.status, 'pending')))
      .orderBy(asc(workflowTasks.createdAt));
  }

  /**
   * Все активные токены инстанса — для UI/статусов, которым при активном форке нужна полная картина
   * (`process_instances.currentState` при >1 токенах — уже не авторитетный источник, см. класс-док).
   * `splitNodeId`/`taskId`/`assigneeId` — чтобы фронт мог показать "одобрено N из M" без похода в
   * `process_instance_forks` за `expectedCount` отдельным запросом.
   */
  async loadActiveTokens(processInstanceId: string) {
    return this.deps.db
      .select({
        id: processInstanceTokens.id,
        nodeId: processInstanceTokens.nodeId,
        branchGroupId: processInstanceTokens.branchGroupId,
        splitNodeId: processInstanceForks.splitNodeId,
        taskId: workflowTasks.id,
        assigneeId: workflowTasks.assigneeId,
      })
      .from(processInstanceTokens)
      .leftJoin(processInstanceForks, eq(processInstanceForks.branchGroupId, processInstanceTokens.branchGroupId))
      .leftJoin(workflowTasks, and(eq(workflowTasks.tokenId, processInstanceTokens.id), eq(workflowTasks.status, 'pending')))
      .where(and(eq(processInstanceTokens.processInstanceId, processInstanceId), eq(processInstanceTokens.status, 'active')));
  }

  // ---- Внутренности интерпретатора ----

  /**
   * Роль gateway-ноды по структуре графа (не отдельным полем) — 'exclusive', если mode не задан или
   * 'exclusive'; иначе split (>1 исходящих) или join (>1 входящих). Смешение (и то, и другое сразу)
   * запрещено валидацией при публикации — здесь предполагается уже корректный граф.
   */
  private gatewayRole(config: WorkflowVersionConfig, node: GatewayNode): 'exclusive' | 'split' | 'join' {
    if (!node.mode || node.mode === 'exclusive') return 'exclusive';
    const outgoingCount = config.edges.filter(e => e.source === node.id).length;
    return outgoingCount > 1 ? 'split' : 'join';
  }

  /**
   * Проходит транзитные узлы (start/gateway-exclusive/serviceTask) автоматически и синхронно, пока не
   * упрётся в userTask/end/asyncTask (стоп) или в parallel/inclusive split/join — тогда рекурсивно
   * передаёт управление forkToken()/joinToken(), которые сами возвращают итоговый TokenAdvanceResult.
   * current_state (точнее — токен) никогда не равен транзитному узлу.
   */
  private async advanceToken(
    config: WorkflowVersionConfig,
    token: ProcessInstanceTokenRow,
    ctx: DelegateContext,
    db: BackendDbService,
  ): Promise<TokenAdvanceResult> {
    let current = this.findNode(config, token.nodeId);
    let activeToken = token;
    const hops: AdvanceHop[] = [];
    let localHops = 0;

    while (current.type !== 'userTask' && current.type !== 'end' && current.type !== 'asyncTask') {
      if (localHops++ >= MAX_TRANSIT_HOPS) {
        throw new WorkflowValidationError([`Превышен лимит транзитных переходов (${MAX_TRANSIT_HOPS}) — вероятен цикл в графе`]);
      }

      if (current.type === 'serviceTask') {
        const provider = this.deps.registry.getServiceTaskProvider(current.serviceTaskProviderId);
        if (!provider) throw new WorkflowValidationError([`Делегат "${current.serviceTaskProviderId}" не зарегистрирован`]);
        try {
          // Побочный эффект вне транзакционной гарантии — rollback его не отменит (см. док класса)
          await provider.execute({ ...ctx, params: current.serviceTaskProviderParams });
        } catch (err) {
          throw this.delegateError(current.id, current.label, current.serviceTaskProviderId, err);
        }
      }

      if (current.type === 'gateway') {
        const role = this.gatewayRole(config, current);
        if (role === 'split') return this.forkToken(config, current, activeToken, ctx, db, hops);
        if (role === 'join') return this.joinToken(config, current, activeToken, ctx, db, hops);
      }

      const next = current.type === 'gateway' ? this.pickGatewayEdge(config, current.id, ctx) : this.singleOutgoingEdge(config, current.id);
      hops.push({ from: current.id, to: next.target });
      await db.update(processInstanceTokens).set({ nodeId: next.target }).where(eq(processInstanceTokens.id, activeToken.id));
      activeToken = { ...activeToken, nodeId: next.target };
      current = this.findNode(config, next.target);
    }

    return { results: [{ token: activeToken, finalNode: current }], hops };
  }

  /** Разворачивает токен, дошедший до parallel/inclusive split, в N дочерних — по одному на активированную ветку. */
  private async forkToken(
    config: WorkflowVersionConfig,
    splitNode: GatewayNode,
    token: ProcessInstanceTokenRow,
    ctx: DelegateContext,
    db: BackendDbService,
    hopsSoFar: AdvanceHop[],
  ): Promise<TokenAdvanceResult> {
    const outgoing = config.edges.filter(e => e.source === splitNode.id);
    const activated = splitNode.mode === 'parallel' ? outgoing : this.pickInclusiveEdges(outgoing, ctx);
    if (!activated.length) {
      throw new WorkflowValidationError([`Split "${splitNode.id}": ни одна ветка не активирована — граф прошёл публикацию некорректно`]);
    }

    const { joinNodeId } = resolveParallelBlock(config, splitNode);
    if (!joinNodeId) {
      throw new WorkflowValidationError([`Split "${splitNode.id}": не найден парный join — граф прошёл публикацию некорректно`]);
    }

    const [fork] = await db
      .insert(processInstanceForks)
      .values({
        processInstanceId: token.processInstanceId,
        parentBranchGroupId: token.branchGroupId,
        splitNodeId: splitNode.id,
        joinNodeId,
        expectedCount: activated.length,
      })
      .returning();

    await db.update(processInstanceTokens).set({ status: 'consumed' }).where(eq(processInstanceTokens.id, token.id));

    const hops = [...hopsSoFar];
    const results: TokenAdvanceResult['results'] = [];
    for (const edge of activated) {
      hops.push({ from: splitNode.id, to: edge.target });
      const [child] = await db
        .insert(processInstanceTokens)
        .values({ processInstanceId: token.processInstanceId, nodeId: edge.target, branchGroupId: fork.branchGroupId, status: 'active' })
        .returning();
      const branch = await this.advanceToken(config, child, ctx, db);
      results.push(...branch.results);
      hops.push(...branch.hops);
    }
    return { results, hops };
  }

  /**
   * Токен, дошедший до parallel/inclusive join: блокирует fork-bookkeeping строку (`FOR UPDATE`) —
   * это и есть защита от гонки, когда два токена одной группы завершаются параллельно из разных
   * транзакций (без неё возможен lost-wakeup: обе видят "ещё не все пришли" и ни одна не продолжает).
   * Считает `consumed` токены группы; если меньше ожидаемого — эта ветка просто ничего не возвращает
   * (ждём остальных), если равно — создаёт один токен-продолжение и рекурсивно advance его дальше.
   */
  private async joinToken(
    config: WorkflowVersionConfig,
    joinNode: GatewayNode,
    token: ProcessInstanceTokenRow,
    ctx: DelegateContext,
    db: BackendDbService,
    hopsSoFar: AdvanceHop[],
  ): Promise<TokenAdvanceResult> {
    if (!token.branchGroupId) {
      throw new WorkflowValidationError([`Join "${joinNode.id}" достигнут токеном без активного форка — некорректное состояние`]);
    }

    const [fork] = await db
      .select()
      .from(processInstanceForks)
      .where(eq(processInstanceForks.branchGroupId, token.branchGroupId))
      .for('update');
    if (!fork) throw new WorkflowValidationError([`Fork-запись "${token.branchGroupId}" не найдена для join "${joinNode.id}"`]);

    await db.update(processInstanceTokens).set({ status: 'consumed' }).where(eq(processInstanceTokens.id, token.id));

    const [{ consumed }] = await db
      .select({ consumed: sql<number>`count(*) filter (where ${processInstanceTokens.status} = 'consumed')::int` })
      .from(processInstanceTokens)
      .where(eq(processInstanceTokens.branchGroupId, token.branchGroupId));

    if (consumed < fork.expectedCount) {
      return { results: [], hops: hopsSoFar };
    }
    if (consumed > fork.expectedCount) {
      // Фантомный токен — баг в коде join или ручное вмешательство в БД. Лучше упасть здесь, чем
      // молча создать лишний/потерянный переход дальше по графу.
      throw new WorkflowValidationError([
        `Join "${joinNode.id}": пришло токенов больше ожидаемого (${consumed} > ${fork.expectedCount}) для группы "${token.branchGroupId}"`,
      ]);
    }

    const outEdge = this.singleOutgoingEdge(config, joinNode.id);
    const [continuation] = await db
      .insert(processInstanceTokens)
      .values({
        processInstanceId: token.processInstanceId,
        nodeId: outEdge.target,
        branchGroupId: fork.parentBranchGroupId,
        status: 'active',
      })
      .returning();

    const hops = [...hopsSoFar, { from: joinNode.id, to: outEdge.target }];
    const branch = await this.advanceToken(config, continuation, ctx, db);
    return { results: branch.results, hops: [...hops, ...branch.hops] };
  }

  /** inclusive-split: рёбра, чьё condition совпало (может быть несколько), иначе только isDefault. */
  private pickInclusiveEdges(edges: WorkflowEdge[], ctx: DelegateContext): WorkflowEdge[] {
    const matched = edges.filter(e => !e.isDefault && e.condition && evaluateCondition(e.condition, ctx));
    if (matched.length) return matched;
    return edges.filter(e => e.isDefault); // валидация гарантирует ровно одно default-ребро
  }

  /** exclusive-split: первое совпавшее condition, иначе default-ребро. */
  private pickGatewayEdge(config: WorkflowVersionConfig, nodeId: string, ctx: DelegateContext): WorkflowEdge {
    const edges = config.edges.filter(e => e.source === nodeId);
    for (const edge of edges) {
      if (edge.isDefault || !edge.condition) continue;
      if (evaluateCondition(edge.condition, ctx)) return edge;
    }
    const fallback = edges.find(e => e.isDefault);
    if (!fallback) throw new WorkflowValidationError([`Gateway "${nodeId}": ни одно условие не совпало и нет default-ребра`]);
    return fallback;
  }

  private singleOutgoingEdge(config: WorkflowVersionConfig, nodeId: string): WorkflowEdge {
    const edges = config.edges.filter(e => e.source === nodeId);
    if (edges.length !== 1) {
      throw new WorkflowValidationError([`Нода "${nodeId}": ожидалось ровно одно исходящее ребро, найдено ${edges.length}`]);
    }
    return edges[0];
  }

  private async runValidators(validatorIds: string[], ctx: DelegateContext): Promise<void> {
    for (const id of validatorIds) {
      const provider = this.deps.registry.getValidatorProvider(id);
      if (!provider) throw new WorkflowValidationError([`Валидатор "${id}" не зарегистрирован`]);
      const result = await provider.validate(ctx);
      if (!result.valid) throw new ValidatorFailedError(result.message ?? `Валидатор "${id}" отклонил переход`);
    }
  }

  /**
   * Общий хвост start/executeAction/completeAutomationJob для КАЖДОГО результата advanceToken (их
   * может быть 0 — все ветки этого вызова ушли в ожидание на join, N — свежий форк тут же упёрся в N
   * стоп-узлов): userTask — резолв assignee + создание задачи, end — завершение инстанса (валидация
   * гарантирует, что end недостижим внутри незакрытого блока — значит на этот момент это единственный
   * оставшийся токен), asyncTask — создание джобы автоматики. После — синхронизация денормализованного
   * currentState/currentStateCode по актуальному множеству активных токенов.
   */
  private async settle(
    db: BackendDbService,
    instanceId: string,
    results: TokenAdvanceResult['results'],
    config: WorkflowVersionConfig,
    ctx: DelegateContext,
  ): Promise<{ automationJobIds: string[] }> {
    const automationJobIds: string[] = [];
    let completedNode: EndNode | null = null;
    let completedTokenId: string | null = null;

    for (const { token, finalNode } of results) {
      if (finalNode.type === 'end') {
        completedNode = finalNode;
        completedTokenId = token.id;
        automationJobIds.push(...(await this.createHookJobs(db, instanceId, token.id, finalNode)));
        continue;
      }

      if (finalNode.type === 'asyncTask') {
        const [job] = await db
          .insert(workflowAutomationJobs)
          .values({
            processInstanceId: instanceId,
            tokenId: token.id,
            nodeId: finalNode.id,
            kind: 'route',
            providerId: finalNode.providerId,
            params: finalNode.params ?? null,
            maxAttempts: finalNode.maxAttempts,
            retryDelayMs: finalNode.retryDelayMs,
          })
          .returning();
        automationJobIds.push(job.id);
        continue;
      }

      const provider = this.deps.registry.getAssigneeProvider(finalNode.assigneeProviderId);
      if (!provider) throw new WorkflowValidationError([`Делегат исполнителя "${finalNode.assigneeProviderId}" не зарегистрирован`]);
      let assigneeId: string;
      try {
        assigneeId = await provider.resolve({ ...ctx, params: finalNode.assigneeProviderParams });
      } catch (err) {
        throw this.delegateError(finalNode.id, finalNode.label, finalNode.assigneeProviderId, err);
      }

      await db.insert(workflowTasks).values({
        processInstanceId: instanceId,
        tokenId: token.id,
        assigneeId,
        state: finalNode.id,
      });
      automationJobIds.push(...(await this.createHookJobs(db, instanceId, token.id, finalNode)));
    }

    if (completedNode) {
      await db
        .update(processInstances)
        .set({ currentState: completedNode.id, currentStateCode: completedNode.code ?? null, completedAt: new Date() })
        .where(eq(processInstances.id, instanceId));
      if (completedTokenId) {
        await db.update(processInstanceTokens).set({ status: 'consumed' }).where(eq(processInstanceTokens.id, completedTokenId));
      }
    } else {
      await this.syncCurrentStateLabel(db, instanceId, config);
    }

    return { automationJobIds };
  }

  /**
   * Денормализация `currentState`/`currentStateCode` для потребителей, которым не нужна полная
   * картина по токенам (админ-документ, resolveRequestStatus и т.п.) — см. класс-док. 1 активный
   * токен (100% для графов без parallel/inclusive) — зеркалит его как есть, поведение не отличается
   * от домодельного. >1 — используется label ближайшего внешнего (самого раннего) активного split'а,
   * без `currentStateCode` (не привязан к конкретной ноде однозначно).
   */
  private async syncCurrentStateLabel(db: BackendDbService, instanceId: string, config: WorkflowVersionConfig): Promise<void> {
    const active = await db
      .select()
      .from(processInstanceTokens)
      .where(and(eq(processInstanceTokens.processInstanceId, instanceId), eq(processInstanceTokens.status, 'active')));
    if (!active.length) return; // инстанс завершён — settle() уже обработал ветку 'end' отдельно

    if (active.length === 1) {
      const node = this.findNode(config, active[0].nodeId);
      await db
        .update(processInstances)
        .set({ currentState: active[0].nodeId, currentStateCode: node.code ?? null })
        .where(eq(processInstances.id, instanceId));
      return;
    }

    const groupIds = [...new Set(active.map(t => t.branchGroupId).filter((id): id is string => id !== null))];
    const forks: ProcessInstanceForkRow[] = groupIds.length
      ? await db
          .select()
          .from(processInstanceForks)
          .where(inArray(processInstanceForks.branchGroupId, groupIds))
          .orderBy(asc(processInstanceForks.createdAt))
      : [];
    const outerFork = forks[0];
    const splitNode = outerFork ? this.findNode(config, outerFork.splitNodeId) : null;

    await db
      .update(processInstances)
      .set({ currentState: splitNode?.id ?? active[0].nodeId, currentStateCode: null })
      .where(eq(processInstances.id, instanceId));
  }

  /** Джобы postEnterHooks ноды — создаются при каждом входе, включая повторный (циклы в графе). */
  private async createHookJobs(db: BackendDbService, instanceId: string, tokenId: string, node: UserTaskNode | EndNode): Promise<string[]> {
    const hooks = node.postEnterHooks ?? [];
    if (!hooks.length) return [];
    const rows = await db
      .insert(workflowAutomationJobs)
      .values(
        hooks.map(hook => ({
          processInstanceId: instanceId,
          tokenId,
          nodeId: node.id,
          kind: 'hook' as const,
          providerId: hook.providerId,
          params: hook.params ?? null,
          maxAttempts: hook.maxAttempts,
          retryDelayMs: hook.retryDelayMs,
        })),
      )
      .returning({ id: workflowAutomationJobs.id });
    return rows.map(row => row.id);
  }

  /** Автоматические хопы атрибутируются тому же актору, что и инициировавший каскад переход. */
  private async writeAuditHops(db: BackendDbService, instanceId: string, actor: AuditActor, hops: AdvanceHop[]): Promise<void> {
    if (!hops.length) return;
    await db.insert(workflowAuditLog).values(
      hops.map(hop => ({
        processInstanceId: instanceId,
        actorId: actor.id,
        actorType: actor.type,
        action: 'auto',
        fromState: hop.from,
        toState: hop.to,
      })),
    );
  }

  /**
   * Забирает джобу claim'ом (условный UPDATE — атомарен и без явного FOR UPDATE SKIP LOCKED: если
   * строка уже забрана/ещё не видна конкурентной транзакции, UPDATE просто не находит совпадений).
   * Вызывается из двух мест: eager-триггер сразу после коммита (executeAction/startProcess/
   * completeAutomationJob) и периодический воркер (см. workflow-automation-worker.ts).
   */
  async runAutomationJob(jobId: string): Promise<void> {
    const db = this.deps.db;
    const [job] = await db
      .update(workflowAutomationJobs)
      .set({ status: 'running', attempts: sql`${workflowAutomationJobs.attempts} + 1`, updatedAt: new Date() })
      .where(and(eq(workflowAutomationJobs.id, jobId), eq(workflowAutomationJobs.status, 'pending')))
      .returning();
    // Не найдено: либо уже забрана другим воркером, либо (при eager-триггере с внешней транзакцией
    // options.db) строка ещё не закоммичена и не видна этому соединению — не ошибка, воркер подберёт позже.
    if (!job) return;

    if (job.kind === 'hook') {
      await this.runHookJob(db, job);
      return;
    }

    const provider = this.deps.registry.getAsyncTaskProvider(job.providerId);
    if (!provider) {
      await this.failOrRetryJob(db, job, `Делегат "${job.providerId}" не зарегистрирован`);
      return;
    }

    const instance = await this.loadInstance(job.processInstanceId);
    let result: { payloadPatch?: Record<string, unknown> };
    try {
      result = await provider.execute({ payload: instance.payload, context: instance.context, params: job.params ?? undefined });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.failOrRetryJob(db, job, message);
      return;
    }

    await this.completeAutomationJob(jobId, result);
  }

  /**
   * kind='hook' (postEnterHooks): в отличие от route-джобы (asyncTask) успех/неудача не
   * маршрутизируют — только помечают саму джобу done/failed, advance()/settle() не вызывается.
   */
  private async runHookJob(db: BackendDbService, job: WorkflowAutomationJobRow): Promise<void> {
    const provider = this.deps.registry.getHookProvider(job.providerId);
    if (!provider) {
      await this.failOrRetryJob(db, job, `Хук "${job.providerId}" не зарегистрирован`);
      return;
    }

    const instance = await this.loadInstance(job.processInstanceId);
    try {
      await provider.execute({ payload: instance.payload, context: instance.context, params: job.params ?? undefined });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.failOrRetryJob(db, job, message);
      return;
    }

    await db.update(workflowAutomationJobs).set({ status: 'done', updatedAt: new Date() }).where(eq(workflowAutomationJobs.id, job.id));
  }

  private async failOrRetryJob(db: BackendDbService, job: WorkflowAutomationJobRow, message: string): Promise<void> {
    if (job.attempts < job.maxAttempts) {
      await db
        .update(workflowAutomationJobs)
        .set({
          status: 'pending',
          nextAttemptAt: new Date(Date.now() + job.retryDelayMs),
          lastError: message,
          updatedAt: new Date(),
        })
        .where(eq(workflowAutomationJobs.id, job.id));
    } else {
      await db
        .update(workflowAutomationJobs)
        .set({ status: 'failed', lastError: message, updatedAt: new Date() })
        .where(eq(workflowAutomationJobs.id, job.id));
    }
  }

  /**
   * Завершает джобу автоматики: применяет результат провайдера, продолжает advance()/settle() по
   * графу. Отдельная транзакция (не принимает opts.db — джоба и так исполняется вне транзакции
   * исходного действия, синхронизировать её не с чем).
   */
  async completeAutomationJob(jobId: string, result: { payloadPatch?: Record<string, unknown> }): Promise<ProcessInstanceRow> {
    const { instance, automationJobIds } = await this.deps.db.transaction(async db => {
      const [job] = await db.select().from(workflowAutomationJobs).where(eq(workflowAutomationJobs.id, jobId)).limit(1).for('update');
      if (!job) throw new WorkflowNotFoundError(`Джоба автоматики "${jobId}" не найдена`);
      // Hook-джобы (postEnterHooks) не маршрутизируют — им нечего "завершать" переходом графа, только
      // runHookJob помечает их done/failed. Ручной override (admin) на них не применим.
      if (job.kind !== 'route') {
        throw new InvalidActionError(`Джоба "${jobId}" (kind="${job.kind}") не маршрутизирует процесс — completeAutomationJob неприменим`);
      }
      if (!job.tokenId) {
        throw new WorkflowValidationError([`Джоба "${jobId}" без token_id (устаревшая запись до модели токенов) — недоступно`]);
      }

      const [instance] = await db
        .select()
        .from(processInstances)
        .where(eq(processInstances.id, job.processInstanceId))
        .limit(1)
        .for('update');
      if (!instance) throw new WorkflowNotFoundError(`Процесс "${job.processInstanceId}" не найден`);

      const [token] = await db.select().from(processInstanceTokens).where(eq(processInstanceTokens.id, job.tokenId)).limit(1).for('update');
      // Защита от гонок/повторного вызова: токен уже не активен или сдвинулся с этой ноды — джобу просто закрываем.
      if (token?.status !== 'active' || token.nodeId !== job.nodeId) {
        await db.update(workflowAutomationJobs).set({ status: 'done', updatedAt: new Date() }).where(eq(workflowAutomationJobs.id, jobId));
        return { instance: await this.reload(db, instance.id), automationJobIds: [] as string[] };
      }

      const [version] = await db.select().from(workflowVersions).where(eq(workflowVersions.id, instance.workflowVersionId)).limit(1);
      if (!version) throw new WorkflowNotFoundError(`Версия "${instance.workflowVersionId}" не найдена`);
      const config = version.config;

      const patchKeys = Object.keys(result.payloadPatch ?? {});
      const payload = { ...instance.payload, ...(result.payloadPatch ?? {}) };
      // editableKeys-whitelist здесь не нужен: провайдер — доверенный код, настроенный админом, не
      // произвольный пользовательский ввод (в отличие от payloadPatch в executeAction).
      const payloadDiff: PayloadDiff = {};
      for (const key of patchKeys) {
        const from = instance.payload[key];
        const to = payload[key];
        if (from !== to) payloadDiff[key] = { from, to };
      }

      const edge = this.singleOutgoingEdge(config, job.nodeId);
      await db.insert(workflowAuditLog).values({
        processInstanceId: instance.id,
        actorId: null,
        actorType: 'system',
        action: 'auto',
        fromState: job.nodeId,
        toState: edge.target,
        comment: null,
        payloadDiff: Object.keys(payloadDiff).length ? payloadDiff : null,
      });

      await db.update(processInstanceTokens).set({ nodeId: edge.target }).where(eq(processInstanceTokens.id, token.id));
      const movedToken: ProcessInstanceTokenRow = { ...token, nodeId: edge.target };

      const ctx: DelegateContext = { payload, context: instance.context };
      const { results, hops } = await this.advanceToken(config, movedToken, ctx, db);
      await this.writeAuditHops(db, instance.id, { id: null, type: 'system' }, hops);
      await db.update(processInstances).set({ payload: ctx.payload }).where(eq(processInstances.id, instance.id));
      const { automationJobIds } = await this.settle(db, instance.id, results, config, ctx);

      await db.update(workflowAutomationJobs).set({ status: 'done', updatedAt: new Date() }).where(eq(workflowAutomationJobs.id, jobId));

      return { instance: await this.reload(db, instance.id), automationJobIds };
    });

    // Цепочка asyncTask → asyncTask (и джобы хуков новой ноды) — стартуют немедленно, не дожидаясь poll-тика.
    for (const id of automationJobIds) void this.runAutomationJob(id);
    return instance;
  }

  /** Ошибка делегата с контекстом ноды — иначе по сообщению не понять, какой узел графа сломан. */
  private delegateError(nodeId: string, nodeLabel: string, delegateId: string, err: unknown): WorkflowValidationError {
    const message = err instanceof Error ? err.message : String(err);
    return new WorkflowValidationError([`Нода "${nodeId}" (${nodeLabel}), делегат "${delegateId}": ${message}`]);
  }

  private findNode(config: WorkflowVersionConfig, nodeId: string): WorkflowNode {
    const node = config.nodes.find(n => n.id === nodeId);
    if (!node) throw new WorkflowValidationError([`Нода "${nodeId}" не найдена в конфиге версии`]);
    return node;
  }

  private async reload(db: BackendDbService, id: string): Promise<ProcessInstanceRow> {
    const [instance] = await db.select().from(processInstances).where(eq(processInstances.id, id)).limit(1);
    if (!instance) throw new WorkflowNotFoundError(`Процесс "${id}" не найден`);
    return instance;
  }
}
