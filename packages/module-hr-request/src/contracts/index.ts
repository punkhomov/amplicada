/** Виджеты полей портальной формы (v1). */
export type RequestFormWidget = 'text' | 'textarea' | 'number' | 'checkbox' | 'date' | 'select';

/** Декларативное описание поля формы типа заявки — редактируется админом, рендерится generic-формой портала. */
export interface RequestFormField {
  key: string;
  label: string;
  widget: RequestFormWidget;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  /** Только для widget: 'select'. */
  options?: { label: string; value: string }[];
}

/** Тип заявки (строка hr_requests.request_types): code = workflows.code опубликованного процесса. */
export interface RequestTypeMeta {
  code: string;
  label: string;
  titleTemplate: string | null;
  formFields: RequestFormField[];
}

/** Вычисляемый статус заявки — label'ы приходят из нод графа, отдельного справочника статусов нет. */
export interface RequestStatus {
  kind: 'draft' | 'in-progress' | 'done-success' | 'done-failure' | 'done';
  label: string;
}

export interface HrRequestListItem {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  status: RequestStatus;
  createdAt: string;
  submittedAt: string | null;
}

export interface HrRequestTimelineEntry {
  id: string;
  action: string;
  fromState: string | null;
  toState: string | null;
  comment: string | null;
  /** Shallow-дифф изменённых ключей payload на этом действии (только для действий, не auto-хопов). */
  payloadDiff: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
  actorLogin: string | null;
}

export interface HrRequestDetail extends HrRequestListItem {
  fields: Record<string, unknown>;
  /** Описание формы из типа заявки — для рендера полей на портале ([] — тип удалён, fallback на JSON). */
  formFields: RequestFormField[];
  createdBy: string;
  /** Черновик, принадлежащий текущему пользователю, — можно редактировать/отправить/удалить. */
  canEdit: boolean;
  isAssignee: boolean;
  availableActions: { action: string; label: string }[];
  /** Ключи payload, редактируемые исполнителем текущего шага (editableKeys ноды) — [] вне назначения. */
  editableFields: string[];
  /** Зафейленная (все ретраи исчерпаны) джоба автоматики на текущей ноде — null, если асинхронная нода не зависла. */
  failedAutomation: { lastError: string | null } | null;
  nodeLabels: Record<string, string>;
  timeline: HrRequestTimelineEntry[];
}

/** id-константы Document System для документа «Тип заявки». */
export const HrRequestDocuments = { REQUEST_TYPE: 'request-type' } as const;
export const HrRequestPages = {} as const;
export const HrRequestGroups = { TYPE_FORM: 'hr-request-type-form' } as const;
