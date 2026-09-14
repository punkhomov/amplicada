import type {
  AsyncTaskNode,
  GatewayNode,
  ServiceTaskNode,
  UserTaskNode,
  WorkflowEdge,
  WorkflowNode,
  WorkflowVersionConfig,
} from '../contracts/graph.js';
import type { WorkflowRegistry } from '../contracts/registry.js';
import { validateConditionRule } from './conditions.js';
import { resolveParallelBlock } from './graph-analysis.js';

// TODO(workflow): план фазы 02 предполагал zod для проверки формы, но zod фактически нигде в
// packages/ не используется (ссылка плана на shared/validators.ts — конвенция из гайда, не код).
// Форма проверяется вручную ниже; если zod появится в проекте — заменить структурную часть на схему.

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const NODE_TYPES = new Set(['start', 'userTask', 'gateway', 'serviceTask', 'asyncTask', 'end']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Структурная проверка формы (замена zod-схемы). Возвращает config, если форма ок. */
function validateShape(raw: unknown, errors: string[]): WorkflowVersionConfig | null {
  if (!isRecord(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    errors.push('Конфиг должен содержать массивы nodes и edges');
    return null;
  }
  for (const [i, node] of raw.nodes.entries()) {
    if (!isRecord(node) || typeof node.id !== 'string' || !node.id) {
      errors.push(`nodes[${i}]: отсутствует id`);
      continue;
    }
    if (typeof node.type !== 'string' || !NODE_TYPES.has(node.type)) {
      errors.push(`Нода "${node.id}": неизвестный тип "${String(node.type)}"`);
    }
    if (typeof node.label !== 'string') errors.push(`Нода "${node.id}": отсутствует label`);
    if (!isRecord(node.position) || typeof node.position.x !== 'number' || typeof node.position.y !== 'number') {
      errors.push(`Нода "${node.id}": position должен содержать числовые x/y`);
    }
  }
  for (const [i, edge] of raw.edges.entries()) {
    if (!isRecord(edge) || typeof edge.id !== 'string' || typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      errors.push(`edges[${i}]: обязательны строковые id/source/target`);
    }
  }
  return errors.length ? null : (raw as unknown as WorkflowVersionConfig);
}

export function validateWorkflowConfig(raw: unknown, registry: WorkflowRegistry): ValidationResult {
  const errors: string[] = [];
  const config = validateShape(raw, errors);
  if (!config) return { valid: false, errors };

  const nodeById = new Map<string, WorkflowNode>();
  for (const node of config.nodes) {
    if (nodeById.has(node.id)) errors.push(`Дублирующийся id ноды: "${node.id}"`);
    nodeById.set(node.id, node);
  }

  // 1. Ровно один start, хотя бы один end
  const startNodes = config.nodes.filter(n => n.type === 'start');
  if (startNodes.length !== 1) errors.push(`Должна быть ровно одна стартовая нода, найдено: ${startNodes.length}`);
  if (!config.nodes.some(n => n.type === 'end')) errors.push('Должна быть хотя бы одна конечная нода');

  // 2. Рёбра ссылаются на существующие ноды
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incomingCount = new Map<string, number>();
  for (const edge of config.edges) {
    if (!nodeById.has(edge.source)) errors.push(`Ребро "${edge.id}": source "${edge.source}" не существует`);
    if (!nodeById.has(edge.target)) errors.push(`Ребро "${edge.id}": target "${edge.target}" не существует`);
    if (nodeById.has(edge.source)) {
      const list = outgoing.get(edge.source) ?? [];
      list.push(edge);
      outgoing.set(edge.source, list);
    }
    if (nodeById.has(edge.target)) {
      incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    }
  }

  // 3. Достижимость из start + исходящие рёбра у всех, кроме end
  for (const node of config.nodes) {
    if (node.type !== 'end' && !(outgoing.get(node.id) ?? []).length) {
      errors.push(`Нода "${node.id}" (${node.label}): нет исходящих рёбер — процесс застрянет`);
    }
  }
  if (startNodes.length === 1) {
    const visited = new Set<string>([startNodes[0].id]);
    const queue = [startNodes[0].id];
    while (queue.length) {
      const id = queue.pop() as string;
      for (const edge of outgoing.get(id) ?? []) {
        if (nodeById.has(edge.target) && !visited.has(edge.target)) {
          visited.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
    for (const node of config.nodes) {
      if (!visited.has(node.id)) errors.push(`Нода "${node.id}" (${node.label}): недостижима из стартовой ноды`);
    }
  }

  // 4–6. Правила по типам нод
  const missingDelegates = new Set<string>();
  const meta = registry.listMeta();
  const knownAssignee = new Set(meta.assignee.map(d => d.id));
  const knownValidator = new Set(meta.validator.map(d => d.id));
  const knownServiceTask = new Set(meta.serviceTask.map(d => d.id));
  const knownAsyncTask = new Set(meta.asyncTask.map(d => d.id));
  const knownHook = new Set(meta.hook.map(d => d.id));

  for (const node of config.nodes) {
    const edges = outgoing.get(node.id) ?? [];
    for (const hook of node.postEnterHooks ?? []) {
      if (!hook.providerId) errors.push(`Нода "${node.id}" (${node.label}): у хука не выбран делегат (providerId)`);
      else if (!knownHook.has(hook.providerId)) missingDelegates.add(hook.providerId);
      if (!Number.isInteger(hook.maxAttempts) || hook.maxAttempts < 1) {
        errors.push(`Нода "${node.id}" (${node.label}): хук "${hook.providerId}" — maxAttempts должен быть целым числом >= 1`);
      }
      if (!Number.isInteger(hook.retryDelayMs) || hook.retryDelayMs < 0) {
        errors.push(`Нода "${node.id}" (${node.label}): хук "${hook.providerId}" — retryDelayMs должен быть целым числом >= 0`);
      }
    }
    if (node.type === 'userTask') {
      const userTask = node as UserTaskNode;
      if (!userTask.assigneeProviderId) errors.push(`Нода "${node.id}" (${node.label}): не выбран исполнитель (assigneeProviderId)`);
      else if (!knownAssignee.has(userTask.assigneeProviderId)) missingDelegates.add(userTask.assigneeProviderId);
      for (const validatorId of userTask.validatorIds ?? []) {
        if (!knownValidator.has(validatorId)) missingDelegates.add(validatorId);
      }
      const actions = new Set<string>();
      for (const edge of edges) {
        if (!edge.action) errors.push(`Ребро "${edge.id}" из "${node.id}": у ребра userTask обязателен action`);
        else if (actions.has(edge.action)) errors.push(`Нода "${node.id}": дублирующийся action "${edge.action}"`);
        else actions.add(edge.action);
      }
    }
    if (node.type === 'gateway') {
      const gateway = node as GatewayNode;
      const mode = gateway.mode ?? 'exclusive';
      const incoming = incomingCount.get(node.id) ?? 0;

      if (mode === 'exclusive') {
        const defaults = edges.filter(e => e.isDefault);
        if (defaults.length !== 1) {
          errors.push(`Gateway "${node.id}" (${gateway.label}): должно быть ровно одно default-ребро, найдено ${defaults.length}`);
        }
        for (const edge of edges) {
          if (edge.isDefault) continue;
          if (!edge.condition) errors.push(`Ребро "${edge.id}" из gateway "${node.id}": обязательно условие (или пометка default)`);
          else validateConditionRule(edge.condition, `Ребро "${edge.id}" условие`, errors);
        }
      } else {
        // parallel/inclusive: роль (split/join) выводится структурно, смешение в одной ноде запрещено —
        // см. ref/plans/2026-07-22-workflow-parallel-gateway.md
        const isSplit = edges.length > 1;
        const isJoin = incoming > 1;
        if (isSplit && isJoin) {
          errors.push(`Gateway "${node.id}" (${gateway.label}, mode="${mode}"): не может одновременно быть split и join — нужны две ноды`);
        } else if (!isSplit && !isJoin) {
          errors.push(
            `Gateway "${node.id}" (${gateway.label}, mode="${mode}"): должен быть либо split (>1 исходящих рёбер), либо join (>1 входящих)`,
          );
        }

        if (mode === 'parallel') {
          for (const edge of edges) {
            if (edge.condition || edge.isDefault) {
              errors.push(
                `Ребро "${edge.id}" из parallel-gateway "${node.id}": condition/isDefault недопустимы — все ветки активируются всегда`,
              );
            }
          }
        } else {
          // inclusive: как exclusive — condition + ровно один isDefault (активируется, если ни одно не совпало)
          const defaults = edges.filter(e => e.isDefault);
          if (defaults.length !== 1) {
            errors.push(`Gateway "${node.id}" (${gateway.label}): должно быть ровно одно default-ребро, найдено ${defaults.length}`);
          }
          for (const edge of edges) {
            if (edge.isDefault) continue;
            if (!edge.condition) errors.push(`Ребро "${edge.id}" из gateway "${node.id}": обязательно условие (или пометка default)`);
            else validateConditionRule(edge.condition, `Ребро "${edge.id}" условие`, errors);
          }
        }

        if (isSplit && !isJoin) {
          const block = resolveParallelBlock(config, gateway);
          errors.push(...block.errors);
        }
      }
    }
    if (node.type === 'serviceTask') {
      const serviceTask = node as ServiceTaskNode;
      if (!serviceTask.serviceTaskProviderId) errors.push(`Нода "${node.id}" (${node.label}): не выбран делегат (serviceTaskProviderId)`);
      else if (!knownServiceTask.has(serviceTask.serviceTaskProviderId)) missingDelegates.add(serviceTask.serviceTaskProviderId);
      if (edges.length !== 1) errors.push(`ServiceTask "${node.id}": должно быть ровно одно исходящее ребро, найдено ${edges.length}`);
      for (const edge of edges) {
        if (edge.action || edge.condition) errors.push(`Ребро "${edge.id}" из serviceTask "${node.id}": action/condition недопустимы`);
      }
    }
    if (node.type === 'asyncTask') {
      const asyncTask = node as AsyncTaskNode;
      if (!asyncTask.providerId) errors.push(`Нода "${node.id}" (${node.label}): не выбран делегат (providerId)`);
      else if (!knownAsyncTask.has(asyncTask.providerId)) missingDelegates.add(asyncTask.providerId);
      if (!Number.isInteger(asyncTask.maxAttempts) || asyncTask.maxAttempts < 1) {
        errors.push(`Нода "${node.id}" (${node.label}): maxAttempts должен быть целым числом >= 1`);
      }
      if (!Number.isInteger(asyncTask.retryDelayMs) || asyncTask.retryDelayMs < 0) {
        errors.push(`Нода "${node.id}" (${node.label}): retryDelayMs должен быть целым числом >= 0`);
      }
      if (edges.length !== 1) errors.push(`AsyncTask "${node.id}": должно быть ровно одно исходящее ребро, найдено ${edges.length}`);
      for (const edge of edges) {
        if (edge.action || edge.condition) errors.push(`Ребро "${edge.id}" из asyncTask "${node.id}": action/condition недопустимы`);
      }
    }
    if (node.type === 'start' && edges.length > 1) {
      errors.push(`Стартовая нода "${node.id}": должно быть ровно одно исходящее ребро, найдено ${edges.length}`);
    }
  }

  // 7. Все упомянутые делегаты зарегистрированы
  if (missingDelegates.size) {
    errors.push(`Незарегистрированные делегаты: ${[...missingDelegates].join(', ')}`);
  }

  // Дедупликация: вложенные parallel/inclusive-блоки валидируются и рекурсивно (через свой внешний
  // split), и напрямую (обход всех нод) — при ошибке сообщение может продублироваться, это косметика.
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
