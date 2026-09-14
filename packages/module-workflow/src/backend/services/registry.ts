import type {
  AssigneeProvider,
  AsyncTaskProvider,
  DelegateMeta,
  HookProvider,
  ServiceTaskProvider,
  ValidatorProvider,
  WorkflowDelegatesMeta,
  WorkflowRegistry,
} from '../../contracts/registry.js';

/**
 * В отличие от TaskRegistryImpl — без reconcile/БД: делегаты — чистые функции без
 * runtime-состояния (paused/schedule/stale), их не нужно материализовывать.
 */
export class WorkflowRegistryImpl implements WorkflowRegistry {
  private assignee = new Map<string, { label: string; provider: AssigneeProvider }>();
  private validator = new Map<string, { label: string; provider: ValidatorProvider }>();
  private serviceTask = new Map<string, { label: string; provider: ServiceTaskProvider }>();
  private asyncTask = new Map<string, { label: string; provider: AsyncTaskProvider }>();
  private hook = new Map<string, { label: string; provider: HookProvider }>();

  registerAssigneeProvider(id: string, label: string, provider: AssigneeProvider): void {
    this.assignee.set(id, { label, provider });
  }

  registerValidatorProvider(id: string, label: string, provider: ValidatorProvider): void {
    this.validator.set(id, { label, provider });
  }

  registerServiceTaskProvider(id: string, label: string, provider: ServiceTaskProvider): void {
    this.serviceTask.set(id, { label, provider });
  }

  registerAsyncTaskProvider(id: string, label: string, provider: AsyncTaskProvider): void {
    this.asyncTask.set(id, { label, provider });
  }

  registerHookProvider(id: string, label: string, provider: HookProvider): void {
    this.hook.set(id, { label, provider });
  }

  getAssigneeProvider(id: string): AssigneeProvider | undefined {
    return this.assignee.get(id)?.provider;
  }

  getValidatorProvider(id: string): ValidatorProvider | undefined {
    return this.validator.get(id)?.provider;
  }

  getServiceTaskProvider(id: string): ServiceTaskProvider | undefined {
    return this.serviceTask.get(id)?.provider;
  }

  getAsyncTaskProvider(id: string): AsyncTaskProvider | undefined {
    return this.asyncTask.get(id)?.provider;
  }

  getHookProvider(id: string): HookProvider | undefined {
    return this.hook.get(id)?.provider;
  }

  listMeta(): WorkflowDelegatesMeta {
    const toMeta = (map: Map<string, { label: string }>): DelegateMeta[] => [...map.entries()].map(([id, { label }]) => ({ id, label }));
    return {
      assignee: toMeta(this.assignee),
      validator: toMeta(this.validator),
      serviceTask: toMeta(this.serviceTask),
      asyncTask: toMeta(this.asyncTask),
      hook: toMeta(this.hook),
    };
  }
}
