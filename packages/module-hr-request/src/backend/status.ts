import type { ProcessInstanceRow, WorkflowEngine } from '@amplicada/module-workflow/backend';
import type { WorkflowVersionConfig } from '@amplicada/module-workflow/contracts';
import type { RequestStatus } from '../contracts/index.js';
import type { HrRequestRow } from './schemas/index.js';

/** Конфиги версий immutable — кэш в памяти безопасен и избавляет списки от чтения конфига на строку. */
export class WorkflowConfigCache {
  private cache = new Map<string, WorkflowVersionConfig>();

  constructor(private engine: WorkflowEngine) {}

  async get(versionId: string): Promise<WorkflowVersionConfig> {
    const hit = this.cache.get(versionId);
    if (hit) return hit;
    const config = await this.engine.loadFrozenConfig(versionId);
    this.cache.set(versionId, config);
    return config;
  }
}

/**
 * Статус заявки — вычисляемый: «Черновик» до старта процесса, дальше label текущей ноды графа.
 * Отдельного справочника статусов нет — имена статусов админ задаёт, называя ноды в редакторе.
 */
export async function resolveRequestStatus(
  request: HrRequestRow,
  instance: ProcessInstanceRow | null,
  cache: WorkflowConfigCache,
): Promise<RequestStatus> {
  if (request.status === 'draft' || !instance) return { kind: 'draft', label: 'Черновик' };

  const config = await cache.get(instance.workflowVersionId);
  const node = config.nodes.find(n => n.id === instance.currentState);
  const label = node?.label ?? instance.currentState;

  if (instance.completedAt) {
    const outcome = node?.type === 'end' ? node.outcome : undefined;
    if (outcome === 'success') return { kind: 'done-success', label };
    if (outcome === 'failure') return { kind: 'done-failure', label };
    return { kind: 'done', label };
  }
  return { kind: 'in-progress', label };
}
