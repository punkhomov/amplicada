import type { TFunction } from 'i18next';
import type { DocumentActor, DocumentListParams, DocumentObject, FieldMetadata, ListFieldMeta } from '../documents.js';
import type { BackendDbService } from './db.js';

export type { DocumentListParams };

export interface DocumentTypeMeta {
  id: string;
  label: string;
  creatable: boolean;
  deletable: boolean;
}

export interface DocumentListResult {
  type: DocumentTypeMeta;
  columns: Record<string, ListFieldMeta>;
  items: Record<string, unknown>[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ListConfigResult {
  type: DocumentTypeMeta;
  columns: Record<string, ListFieldMeta>;
}

export interface EnrichedExtension {
  module: string;
  /** Ключ extension'а (нормализованный реестром). Вместе с `module` адресует бакет `data[module][key]`. */
  key: string;
  /** Пул метаданных полей модуля. Ячейка `kind:'field'` резолвится по нему на фронте; компонент получает его пропом. */
  fields: Record<string, FieldMetadata>;
  rows: EnrichedRow[];
}

export type EnrichedRow = EnrichedCell[];

export type EnrichedCell =
  | { kind: 'field'; field: string; span: number }
  | { kind: 'component'; component: string; span: number }
  | { kind: 'empty'; span: number };

export interface EnrichedGroup {
  id: string;
  document: string;
  page: string;
  label: string;
  order: number;
  icon?: string;
  extensions: EnrichedExtension[];
}

export interface EnrichedPage {
  id: string;
  document: string;
  label: string;
  icon?: string;
  linkTemplate?: string;
  groups: EnrichedGroup[];
}

/** `items`/`columns` — namespace'ы двухуровневые: module → key extension'а → поля (см. `DocumentExtension.key`). */
export interface DocumentExportResult {
  type: DocumentTypeMeta;
  items: Record<string, Record<string, Record<string, unknown>>>[];
  columns: Record<string, Record<string, Record<string, ListFieldMeta>>>;
}

export interface DocumentImportResult {
  created: number;
  updated: number;
  errors: { index: number; error: string }[];
}

export interface DocumentRegistryMetaResult {
  type: DocumentTypeMeta;
  pages: EnrichedPage[];
}

export interface BackendDocumentRuntime {
  list(type: string, params: DocumentListParams): Promise<DocumentListResult>;
  /** `type` — опциональный fast-path: если передан, пропускает lookup типа и читает сразу. Без него (Tier 3.3, требует document_index) — 501. */
  getAnyById(id: string, type?: string): Promise<DocumentObject | null>;
  create(type: string, body: Record<string, unknown>, actor?: DocumentActor): Promise<unknown>;
  update(type: string, id: string, body: Record<string, unknown>, actor?: DocumentActor): Promise<void>;
  /** По умолчанию soft delete (если тип поддерживает); иначе hard. См. restore/hardDelete. */
  delete(type: string, id: string, actor?: DocumentActor): Promise<void>;
  bulkDelete(type: string, ids: string[], actor?: DocumentActor): Promise<void>;
  /** Снимает soft-delete. 400, если тип не поддерживает soft-delete. */
  restore(type: string, id: string): Promise<void>;
  /** Физическое удаление (каскад + base + index), в обход soft-delete. */
  hardDelete(type: string, id: string): Promise<void>;
  exportData(type: string): Promise<DocumentExportResult>;
  exportDataFiltered(type: string, params: DocumentListParams, format?: 'csv' | 'json', t?: TFunction): Promise<ReadableStream>;
  importData(type: string, items: Record<string, unknown>[]): Promise<DocumentImportResult>;
  getListConfig(type: string): ListConfigResult | null;
  getRegistryMeta(type: string): DocumentRegistryMetaResult | null;
  /**
   * Заводит строку document_index и отдаёт сгенерированный id. Вызывается ПЕРЕД вставкой базовой
   * строки: базовые таблицы ссылаются на индекс внешним ключом. `db` — для участия в чужой
   * транзакции (WorkflowEngine.startProcess(), HrStructureService.create*()).
   */
  allocateDocumentId(type: string, db?: BackendDbService, opts?: { fixture?: boolean; actor?: DocumentActor }): Promise<string>;
  /** То же, но для заранее известного id (fixture с pinned `{ id }`, импорт с явным id): резервирует конкретный id. `opts.fixture` — пометить строку fixture-документом. */
  indexCreated(type: string, id: string, db?: BackendDbService, opts?: { fixture?: boolean; actor?: DocumentActor }): Promise<void>;
  indexRemoved(id: string, db?: BackendDbService): Promise<void>;
  /** Реконсиляция fixture-документов (code-defined): базовая строка приводится к объявленной в коде, пометка в document_index, stale-маркировка отсутствующих. Вызывается из bootstrap. */
  reconcileFixtures(db?: BackendDbService): Promise<void>;
}
