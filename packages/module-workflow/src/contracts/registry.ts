import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';

export interface DelegateContext {
  payload: Record<string, unknown>;
  context: Record<string, unknown>;
  /** Из *ProviderParams конкретной ноды конфига. */
  params?: Record<string, unknown>;
  /**
   * Транзакция движка — доступна только синхронным делегатам (assignee/validator/serviceTask),
   * вызываемым внутри WorkflowEngine.inTransaction. Асинхронные джобы (фаза C) этого поля не
   * получают: к моменту их исполнения транзакция уже закоммичена.
   */
  db?: BackendDbService;
}

export interface AssigneeProvider {
  /** Возвращает id пользователя (identity_user.id), которому назначается задача. */
  resolve(ctx: DelegateContext): Promise<string>;
}

export interface ValidatorProvider {
  validate(ctx: DelegateContext): Promise<{ valid: boolean; message?: string }>;
}

export interface ServiceTaskProvider {
  /**
   * Мутация `ctx.payload` по ссылке — благословлённый способ вернуть данные процессу
   * (persist'ится движком после advance, см. WorkflowEngine.startProcess/executeAction).
   */
  execute(ctx: DelegateContext): Promise<void>;
}

export interface AsyncTaskProvider {
  /**
   * В отличие от ServiceTaskProvider — не мутация ctx.payload по ссылке (транзакции уже нет к
   * моменту завершения — исполняется вне транзакции движка через джобу), а явный возврат
   * результата.
   */
  execute(ctx: DelegateContext): Promise<{ payloadPatch?: Record<string, unknown> }>;
}

export interface HookProvider {
  /**
   * Post-enter side effect (уведомления и т.п.) — как AsyncTaskProvider, исполняется вне транзакции
   * движка через джобу, но результат ни на что не маршрутизирует: успех/неудача только влияют на
   * статус самой джобы (done/failed), advance() по графу не вызывается.
   */
  execute(ctx: DelegateContext): Promise<void>;
}

export interface DelegateMeta {
  id: string;
  label: string;
}

export interface WorkflowDelegatesMeta {
  assignee: DelegateMeta[];
  validator: DelegateMeta[];
  serviceTask: DelegateMeta[];
  asyncTask: DelegateMeta[];
  /** Отдельный список — источник данных для UI хуков, не смешивается с serviceTask-пикером. */
  hook: DelegateMeta[];
}

/**
 * Точка расширения движка. Доменные модули (module-hr и далее) резолвят её через
 * context.services.resolve<WorkflowRegistry>('workflow-registry') и регистрируют свои делегаты.
 * Сам module-workflow доменных делегатов не регистрирует.
 */
export interface WorkflowRegistry {
  registerAssigneeProvider(id: string, label: string, provider: AssigneeProvider): void;
  registerValidatorProvider(id: string, label: string, provider: ValidatorProvider): void;
  registerServiceTaskProvider(id: string, label: string, provider: ServiceTaskProvider): void;
  registerAsyncTaskProvider(id: string, label: string, provider: AsyncTaskProvider): void;
  registerHookProvider(id: string, label: string, provider: HookProvider): void;

  getAssigneeProvider(id: string): AssigneeProvider | undefined;
  getValidatorProvider(id: string): ValidatorProvider | undefined;
  getServiceTaskProvider(id: string): ServiceTaskProvider | undefined;
  getAsyncTaskProvider(id: string): AsyncTaskProvider | undefined;
  getHookProvider(id: string): HookProvider | undefined;

  /** Для пикеров properties panel редактора (GET /api/workflows/admin/builder/meta). */
  listMeta(): WorkflowDelegatesMeta;
}

export const WORKFLOW_REGISTRY_TOKEN = 'workflow-registry';

/** Токен WorkflowEngine в context.services — для программных потребителей движка (module-hr-request и т.п.). */
export const WORKFLOW_ENGINE_TOKEN = 'workflow-engine';
