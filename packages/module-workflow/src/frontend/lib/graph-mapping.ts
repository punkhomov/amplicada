import type { Edge, Node } from '@xyflow/react';
import type { JsonLogicRule, NodeType, PostEnterHook, WorkflowEdge, WorkflowNode, WorkflowVersionConfig } from '../../contracts/graph.js';

/** Данные ноды в React Flow store — все типоспецифичные поля опциональны, тип ноды в Node.type. */
export interface EditorNodeData extends Record<string, unknown> {
  label: string;
  /** Стабильный код ноды для отчётности (userTask/end) — см. WorkflowNodeBase.code. */
  code?: string;
  assigneeProviderId?: string;
  assigneeProviderParams?: Record<string, unknown>;
  validatorIds?: string[];
  editableKeys?: string[];
  serviceTaskProviderId?: string;
  serviceTaskProviderParams?: Record<string, unknown>;
  asyncTaskProviderId?: string;
  asyncTaskProviderParams?: Record<string, unknown>;
  maxAttempts?: number;
  retryDelayMs?: number;
  outcome?: 'success' | 'failure';
  /** gateway — см. GatewayNode.mode. Отсутствует/'exclusive' — поведение не меняется. */
  mode?: 'exclusive' | 'parallel' | 'inclusive';
  /** Post-enter side-effect делегаты (userTask/end) — см. WorkflowNodeBase.postEnterHooks. */
  postEnterHooks?: PostEnterHook[];
}

export interface EditorEdgeData extends Record<string, unknown> {
  action?: string;
  condition?: JsonLogicRule;
  isDefault?: boolean;
}

export const DEFAULT_ASYNC_TASK_MAX_ATTEMPTS = 3;
export const DEFAULT_ASYNC_TASK_RETRY_DELAY_MS = 30_000;
export const DEFAULT_HOOK_MAX_ATTEMPTS = 3;
export const DEFAULT_HOOK_RETRY_DELAY_MS = 30_000;

export type EditorNode = Node<EditorNodeData>;
export type EditorEdge = Edge<EditorEdgeData>;

export function configToFlow(config: WorkflowVersionConfig): { nodes: EditorNode[]; edges: EditorEdge[] } {
  const nodes: EditorNode[] = config.nodes.map(node => {
    const data: EditorNodeData = { label: node.label };
    if (node.type === 'userTask') {
      data.code = node.code;
      data.assigneeProviderId = node.assigneeProviderId;
      data.assigneeProviderParams = node.assigneeProviderParams;
      data.validatorIds = node.validatorIds;
      data.editableKeys = node.editableKeys;
      data.postEnterHooks = node.postEnterHooks;
    }
    if (node.type === 'serviceTask') {
      data.serviceTaskProviderId = node.serviceTaskProviderId;
      data.serviceTaskProviderParams = node.serviceTaskProviderParams;
    }
    if (node.type === 'asyncTask') {
      data.asyncTaskProviderId = node.providerId;
      data.asyncTaskProviderParams = node.params;
      data.maxAttempts = node.maxAttempts;
      data.retryDelayMs = node.retryDelayMs;
    }
    if (node.type === 'end') {
      data.code = node.code;
      data.outcome = node.outcome;
      data.postEnterHooks = node.postEnterHooks;
    }
    if (node.type === 'gateway') {
      data.mode = node.mode;
    }
    return { id: node.id, type: node.type, position: node.position, data };
  });

  const edges: EditorEdge[] = config.edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edgeCaption(edge),
    data: { action: edge.action, condition: edge.condition, isDefault: edge.isDefault },
  }));

  return { nodes, edges };
}

export function flowToConfig(nodes: EditorNode[], edges: EditorEdge[]): WorkflowVersionConfig {
  return {
    nodes: nodes.map(node => {
      const type = (node.type ?? 'userTask') as NodeType;
      const base = { id: node.id, label: node.data.label, position: { x: node.position.x, y: node.position.y } };
      if (type === 'userTask') {
        return {
          ...base,
          type,
          code: node.data.code,
          assigneeProviderId: node.data.assigneeProviderId ?? '',
          assigneeProviderParams: node.data.assigneeProviderParams,
          validatorIds: node.data.validatorIds,
          editableKeys: node.data.editableKeys,
          postEnterHooks: node.data.postEnterHooks,
        };
      }
      if (type === 'serviceTask') {
        return {
          ...base,
          type,
          serviceTaskProviderId: node.data.serviceTaskProviderId ?? '',
          serviceTaskProviderParams: node.data.serviceTaskProviderParams,
        };
      }
      if (type === 'asyncTask') {
        return {
          ...base,
          type,
          providerId: node.data.asyncTaskProviderId ?? '',
          params: node.data.asyncTaskProviderParams,
          maxAttempts: node.data.maxAttempts ?? DEFAULT_ASYNC_TASK_MAX_ATTEMPTS,
          retryDelayMs: node.data.retryDelayMs ?? DEFAULT_ASYNC_TASK_RETRY_DELAY_MS,
        };
      }
      if (type === 'end') {
        return { ...base, type, code: node.data.code, outcome: node.data.outcome, postEnterHooks: node.data.postEnterHooks };
      }
      if (type === 'gateway') {
        return { ...base, type, mode: node.data.mode };
      }
      return { ...base, type } as WorkflowNode;
    }),
    edges: edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: typeof edge.label === 'string' && edge.label ? edge.label : undefined,
      action: edge.data?.action,
      condition: edge.data?.condition,
      isDefault: edge.data?.isDefault,
    })),
  };
}

/** Подпись ребра на канвасе: явный label, иначе action / "default" / "условие". */
export function edgeCaption(edge: Pick<WorkflowEdge, 'label' | 'action' | 'condition' | 'isDefault'>): string | undefined {
  if (edge.label) return edge.label;
  if (edge.action) return edge.action;
  if (edge.isDefault) return 'default';
  if (edge.condition) return 'условие';
  return undefined;
}

/**
 * Порядковый номер условия перед подписью на не-default рёбрах exclusive-gateway — тот же порядок, в
 * котором `WorkflowEngine.pickGatewayEdge` их перебирает (первое совпавшее побеждает), иначе он нигде
 * не виден на канвасе. Только exclusive: у parallel порядка вычисления нет вообще (все ветки всегда
 * активны), у inclusive порядок тоже не важен (активируются все совпавшие, не только первое) — номер
 * там был бы вводящим в заблуждение намёком на приоритет, которого не существует. Только для
 * отображения: возвращает новый массив, не трогает `edges`-state (label в state — персистентные
 * данные, идут в `flowToConfig`).
 */
export function withGatewayEdgeOrder(edges: EditorEdge[], nodes: EditorNode[]): EditorEdge[] {
  const exclusiveGatewayIds = new Set(
    nodes.filter(n => n.type === 'gateway' && (!n.data.mode || n.data.mode === 'exclusive')).map(n => n.id),
  );
  const counters = new Map<string, number>();
  return edges.map(edge => {
    if (!exclusiveGatewayIds.has(edge.source) || edge.data?.isDefault) return edge;
    const order = (counters.get(edge.source) ?? 0) + 1;
    counters.set(edge.source, order);
    const caption = typeof edge.label === 'string' ? edge.label : edgeCaption({ ...edge.data });
    return { ...edge, label: caption ? `${order}. ${caption}` : `${order}.` };
  });
}

/** Стартовый шаблон для workflow без опубликованных версий. */
export function emptyStartEndTemplate(): WorkflowVersionConfig {
  return {
    nodes: [
      { id: 'start', type: 'start', label: 'Начало', position: { x: 0, y: 120 } },
      { id: 'end', type: 'end', label: 'Конец', position: { x: 420, y: 120 } },
    ],
    edges: [{ id: 'start-end', source: 'start', target: 'end' }],
  };
}
