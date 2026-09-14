export type NodeType = 'start' | 'userTask' | 'gateway' | 'serviceTask' | 'asyncTask' | 'end';

/**
 * JSONLogic-совместимое дерево условия ({ ">": [{ "var": "payload.amount" }, 100000] }).
 * Типизируется на уровне рантайм-валидации при публикации версии, не статически.
 */
export type JsonLogicRule = Record<string, unknown>;

/** Side-effect делегат ноды: провайдер + свои JSON-параметры + своя политика ретраев (как у asyncTask). */
export interface PostEnterHook {
  providerId: string;
  params?: Record<string, unknown>;
  /** >= 1. */
  maxAttempts: number;
  /** Фиксированная задержка перед ретраем, мс. */
  retryDelayMs: number;
}

interface WorkflowNodeBase {
  id: string;
  /**
   * Стабильный домен-код ноды для внешних потребителей (отчёты, кэш) — в отличие от id
   * (технический, может пересоздаваться) и label (переводимый текст). Опционален.
   */
  code?: string;
  label: string;
  /** Раскладка канваса React Flow, персистится как есть. */
  position: { x: number; y: number };
  /**
   * Side-effect делегаты, срабатывающие после того, как нода стала current_state (post-enter).
   * Асинхронно, вне транзакции движка, fire-and-forget — не влияют на маршрутизацию. Срабатывают
   * при каждом входе в ноду, включая повторные (циклы в графе). В редакторе доступны только на
   * userTask/end.
   */
  postEnterHooks?: PostEnterHook[];
}

export interface StartNode extends WorkflowNodeBase {
  type: 'start';
}

export interface EndNode extends WorkflowNodeBase {
  type: 'end';
  /** Витринная семантика завершения для бейджей потребителей (зелёный/красный). Движок её не интерпретирует. */
  outcome?: 'success' | 'failure';
}

export interface UserTaskNode extends WorkflowNodeBase {
  type: 'userTask';
  assigneeProviderId: string;
  assigneeProviderParams?: Record<string, unknown>;
  /** Все валидаторы должны пройти перед ЛЮБЫМ исходящим action. */
  validatorIds?: string[];
  /**
   * Ключи payload, которые исполнитель может менять действием на этом шаге (payloadPatch в
   * executeAction). Отсутствует/пусто = менять нельзя ничего — секьюрный дефолт.
   */
  editableKeys?: string[];
}

export interface GatewayNode extends WorkflowNodeBase {
  type: 'gateway';
  /**
   * 'exclusive' (по умолчанию, если не задано — существующие опубликованные версии без поля
   * продолжают работать как есть): первое совпавшее condition, иначе default, ровно одно ребро.
   * 'parallel'/'inclusive': роль (split/join) выводится структурно — split, если исходящих рёбер
   * больше одного, join — если входящих больше одного (одновременно оба — запрещено валидацией).
   * См. ref/plans/2026-07-22-workflow-parallel-gateway.md.
   */
  mode?: 'exclusive' | 'parallel' | 'inclusive';
}

export interface ServiceTaskNode extends WorkflowNodeBase {
  type: 'serviceTask';
  serviceTaskProviderId: string;
  serviceTaskProviderParams?: Record<string, unknown>;
}

export interface AsyncTaskNode extends WorkflowNodeBase {
  type: 'asyncTask';
  providerId: string;
  params?: Record<string, unknown>;
  /** >= 1. */
  maxAttempts: number;
  /** Фиксированная задержка перед ретраем, мс — не экспонента, сознательный минимализм. */
  retryDelayMs: number;
}

export type WorkflowNode = StartNode | UserTaskNode | GatewayNode | ServiceTaskNode | AsyncTaskNode | EndNode;

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** Обязателен на рёбрах, исходящих из userTask — имя действия (approve/reject/...). */
  action?: string;
  /** Обязателен на рёбрах, исходящих из gateway (кроме isDefault). */
  condition?: JsonLogicRule;
  /** Fallback-ребро gateway, ровно одно на узел. */
  isDefault?: boolean;
}

export interface WorkflowVersionConfig {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
