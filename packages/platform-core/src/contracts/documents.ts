/** Actor HTTP-запроса, инициировавшего изменение документа. Отсутствие (undefined) — actor неизвестен (fixture/backfill/системный код). */
export interface DocumentActor {
  userId: string;
}

/**
 * Описание типа документа — только метаданные. Своей таблицы у типа нет: данные живут в
 * extension'ах (`objects.extend`), включая тот, который объявляет «главную» таблицу модуля-владельца.
 * Единственная общая для всех типов таблица — `core.document_index`, она же источник id и состояния.
 */
export interface DocumentType {
  id: string;
  /** Manifest id модуля-владельца типа (см. BackendModule.id) — по нему строится `module:id` на дашборде админки. */
  module: string;
  label: string;
  /** По умолчанию true. Если false — создание новых записей запрещено (UI показывает disabled-кнопку с пояснением, бэкенд отклоняет запрос). */
  creatable?: boolean;
  /** По умолчанию true. Если false — удаление запрещено (UI показывает disabled-кнопку с пояснением, бэкенд отклоняет запрос). */
  deletable?: boolean;
  /**
   * По умолчанию false — удаление физическое. Если true, `delete()` только помечает документ
   * удалённым в `document_index`, а `restore()` снимает пометку.
   *
   * Раньше эта способность выводилась из формы схемы («у базовой таблицы есть колонка `deleted_at`»);
   * состояние документа переехало в индекс, поэтому её приходится объявлять явно.
   */
  softDelete?: boolean;
  /** Топик дашборда админки (см. DashboardTopics, DocumentRegistry.dashboard). По умолчанию — DashboardTopics.DOCUMENTS. */
  topic?: string;
  /** Секция внутри топика на дашборде (см. DocumentRegistry.dashboard.registerSection). Без секции — прямо под топиком. */
  section?: string;
}

export interface DocumentPage {
  id: string;
  document: string;
  label: string;
  icon?: string;
  /** Если задано — это не таб с полями, а просто ссылка (рендерится с иконкой "внешняя ссылка"). `{id}` в шаблоне подставляется реальным id документа. */
  linkTemplate?: string;
}

export interface DocumentGroup {
  id: string;
  document: string;
  page: string;
  label: string;
  order: number;
  icon?: string;
}

/** Раскладка вклада модуля по карточке: page → group → строки. Заменяет плоский `group`. */
export type DocumentLayout = Record<string, Record<string, GroupLayout>>;

export interface GroupLayout {
  /** Если не задан — legacy-дефолт: поля разложены 3-колоночной сеткой (как было до layout). */
  rows?: LayoutRow[];
}

/** Строка группы. Ширина = сумма `span` ячеек (по умолчанию 1 у каждой). Строки автономны. */
export type LayoutRow = LayoutCell[];

/**
 * Ячейка строки. `'code'` — краткая форма для `{ field: 'code', span: 1 }`.
 *
 * Компонентная ячейка (`{ component }`) рендерится по id из frontend component-registry.
 * ВАЖНО: все ячейки одного extension делят общее состояние `data[module][key]`, а `onChange`
 * компонента заменяет этот объект целиком. Поэтому в рамках одного extension'а допустим только
 * ОДИН редактируемый компонент. Несколько компонентов — либо read-only, либо в разных extension'ах
 * (отдельные `extend` со своим `layout`; для одного модуля — с разными `key`). Смешивать
 * редактируемый компонент с полями того же extension'а можно, только если компонент в `onChange`
 * сохраняет остальные ключи (`{ ...data, ... }`).
 */
export type LayoutCell = string | { field: string; span?: number } | { component: string; span?: number } | { empty: true; span?: number };

/**
 * Ключ extension'а по умолчанию. Модуль, регистрирующий на документе ровно один `extend()` (обычный
 * случай), про `key` не знает вообще — реестр подставляет этот.
 */
export const DEFAULT_EXTENSION_KEY = 'base';

export interface DocumentExtension {
  document: string;
  module: string;
  /**
   * Различает несколько `extend()` одного модуля на одном документе. Опционален на входе —
   * `DocumentRegistryImpl` нормализует отсутствующий в `DEFAULT_EXTENSION_KEY`, поэтому у extension'а
   * в реестре (и всюду в рантайме) `key` — всегда конкретная строка.
   */
  key?: string;
  /** Раскладка вклада модуля: page → group → строки. Ссылается на id зарегистрированных page/group и ключи `fields`. */
  layout: DocumentLayout;
  fields?: Record<string, FieldMetadata>;
  /**
   * Drizzle-таблица расширения — для автоматического load/save (без ручного `load`/`save`) и для
   * удаления строки вместе с документом. Задаётся и «главной» таблицей модуля-владельца: своей
   * таблицы у типа документа нет, все расширения на общих правах.
   *
   * Если не задана и нет `load`/`save`/`customFields` — расширение данных не хранит (чистый layout
   * с компонентом).
   */
  // biome-ignore lint/suspicious/noExplicitAny: runtime Drizzle table, backend-only
  schema?: any;
  /**
   * Колонка, сопоставляемая с docId. По умолчанию 'id'. Обязана иметь уникальный индекс (обычно это
   * её PK): запись идёт «UPDATE, а если задето 0 строк — INSERT».
   */
  idColumn?: string;
  load?: (db: import('./backend/db.js').BackendDbService, docId: string) => Promise<Record<string, unknown>>;
  save?: (tx: import('./backend/db.js').BackendDbService, id: string, data: Record<string, unknown>) => Promise<void>;
  /** Кастомное удаление extension-строки при удалении документа. Если не задано, но есть `schema` — авто-delete по idColumn=id. */
  remove?: (tx: import('./backend/db.js').BackendDbService, docId: string) => Promise<void>;
  /**
   * Хранить значения `fields` в общей `document_custom_fields` (jsonb, по (docId, module, key)) — без
   * своей Drizzle-таблицы и миграции. Взаимоисключимо с `schema`/`load`/`save`.
   */
  customFields?: boolean;
}

export interface DocumentListParams {
  page?: string | number;
  pageSize?: string | number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  columns?: string;
  filters?: string;
  search?: string;
}

export interface FieldMetadata {
  label: string;
  module?: string;
  widget?: 'text' | 'password' | 'number' | 'date' | 'datetime' | 'select' | 'checkbox' | 'reference' | 'switch' | 'radiobutton';
  /** Кастомный компонент для этого поля. Если задан — рендерится вместо FieldWidget. */
  component?: string;
  required?: boolean;
  readonly?: boolean;
  default?: unknown;
  options?: { label: string; value: string }[];
  placeholder?: string;
  helpText?: string;
}

export interface ListFieldMeta {
  label: string;
  type?: string;
  sortable?: boolean;
  filterable?: boolean;
  /** Участвует в полнотекстовом поиске списка. По умолчанию текстовые и select-поля. */
  searchable?: boolean;
  size?: number;
  minSize?: number;
  /**
   * Варианты значений для `type: 'select'`. `label` — i18n-ключ, резолвится в resolveListColumns
   * (module-admin/backend/lib/resolve-document-labels.ts) вместе с label самой колонки.
   * Без options фильтр по select-колонке падает в free-text ввод — пользователю приходится
   * угадывать сохранённое значение руками.
   */
  options?: { label: string; value: string }[];
}

export type FilterCombinator = 'and' | 'or';

export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'contains'
  | 'notContains'
  | 'in'
  | 'notIn'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between';

/** Лист дерева фильтра — одно сравнение по одной колонке. */
export interface FilterCondition {
  kind: 'condition';
  /** Префиксный ключ колонки списка (`${module}:${key}:${field}`), как в DocumentListResult.columns. */
  column: string;
  operator: FilterOperator;
  /** Одиночное значение — всегда строка; приведение к типу колонки делает бэкенд (coerceValue). */
  value?: string;
  /** Верхняя граница для `between`. */
  value2?: string;
  /** Значения для `in` / `notIn`. Пустой массив невалиден (400). */
  values?: string[];
}

/**
 * Узел-группа. UI показывает ровно один уровень вложенности (Airtable-style), формат допускает
 * больше — см. FILTER_MAX_DEPTH. Рекурсивный формат выбран, чтобы усложнение UI позже не
 * потребовало миграции сохранённых фильтров.
 */
export interface FilterGroup {
  kind: 'group';
  combinator: FilterCombinator;
  children: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

/** Корень фильтра списка — ВСЕГДА группа, даже для одного условия (иначе комбинатор некуда положить). */
export type FilterTree = FilterGroup;

/** Границы против патологических payload'ов. Общие для фронта и бэка. */
export const FILTER_MAX_DEPTH = 5;
export const FILTER_MAX_NODES = 100;
export const FILTER_MAX_IN_VALUES = 200;
/** maxLength query-параметра `filters` в Fastify-схеме — граница ДО JSON.parse. */
export const FILTER_MAX_PARAM_LENGTH = 16_000;

export const FILTER_OPERATORS_BY_TYPE: Record<string, FilterOperator[]> = {
  text: ['contains', 'notContains', 'eq', 'ne', 'in', 'notIn', 'isEmpty', 'isNotEmpty'],
  select: ['eq', 'ne', 'in', 'notIn', 'isEmpty', 'isNotEmpty'],
  uuid: ['eq', 'ne', 'in', 'notIn', 'isEmpty', 'isNotEmpty'],
  // in/notIn намеренно НЕ для дат: равенство по timestamp почти бесполезно, а UI стоит дорого.
  date: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  datetime: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  checkbox: ['eq', 'ne'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'notIn', 'isEmpty', 'isNotEmpty'],
};

/**
 * Безопасный минимум для колонок без `type`. Раньше это был алиас text-операторов, из-за чего
 * `contains` доходил до uuid/timestamp-колонок и ронял запрос на уровне БД.
 */
export const DEFAULT_FILTER_OPERATORS: FilterOperator[] = ['eq', 'ne', 'in', 'notIn', 'isEmpty', 'isNotEmpty'];

export interface ListExtension {
  document: string;
  module: string;
  /** См. `DocumentExtension.key`. Нормализуется реестром в `DEFAULT_EXTENSION_KEY`, если не задан. */
  key?: string;
  fields?: Record<string, ListFieldMeta>;
  // biome-ignore lint/suspicious/noExplicitAny: runtime Drizzle table, backend-only
  schema?: any;
  foreignKey?: string;
  /** Колонки читаются из общей `document_custom_fields` (jsonb по (docId, module, key)) вместо `schema`/`foreignKey`. */
  customFields?: boolean;
  /**
   * Дополнительный предикат ON помимо `foreignKey = id`. Для effective-dated моделей
   * (Node+Version) — `t => isNull(t.validTo)`, чтобы джойнилась ровно одна актуальная версия.
   */
  // biome-ignore lint/suspicious/noExplicitAny: runtime Drizzle table, backend-only
  joinOn?: (table: any) => import('drizzle-orm').SQL | undefined;
  /** `'left'` (по умолчанию) либо `'inner'`. Node+Version — `'inner'`: узел без актуальной версии в список не попадает. */
  joinType?: 'left' | 'inner';
}

export interface DocumentObjectRegistry {
  registerPage(id: string, page: Omit<DocumentPage, 'id'>): void;
  registerGroup(id: string, group: Omit<DocumentGroup, 'id'>): void;
  extend(docId: string, ext: Omit<DocumentExtension, 'document'>): void;
  getPages(docId: string): DocumentPage[];
  getGroups(pageId: string, docId?: string): DocumentGroup[];
  getExtensions(docId: string): DocumentExtension[];
}

export interface DocumentListRegistry {
  extend(docId: string, ext: Omit<ListExtension, 'document'>): void;
  getExtensions(docId: string): ListExtension[];
}

/**
 * Ключ конфликта для fixture-upsert. Два режима:
 * - `{ id }` — pinned uuid-литерал (одинаков между контурами, другие таблицы могут хардкодить FK);
 * - `{ column, value }` — natural key (напр. `code`), id базовой таблицы авто-генерируется.
 */
export type FixtureKey = { id: string } | { column: string; value: string };

/** Code-defined документ, восстанавливаемый при каждом бутстрапе (reconcileFixtures). */
export interface FixtureDefinition {
  type: string;
  key: FixtureKey;
  /** Code-owned поля — пишутся при INSERT и ON CONFLICT UPDATE. Остальные колонки (user-owned) получают дефолты только при INSERT. */
  values: Record<string, unknown>;
}

export interface FixtureRegistry {
  register(fixture: FixtureDefinition): void;
  getAll(): FixtureDefinition[];
}

/** Топик верхнего уровня на дашборде админки (например "Документы", "Система"). */
export interface DashboardTopic {
  id: string;
  label: string;
  order?: number;
  icon?: string;
}

/** Секция внутри топика, группирует несколько пунктов (например "Орг. структура" внутри "Документы"). */
export interface DashboardSection {
  id: string;
  topic: string;
  label: string;
  order?: number;
}

/** Пункт дашборда, не привязанный к типу документа (например "Модули"). */
export interface DashboardLink {
  id: string;
  /** Manifest id модуля, зарегистрировавшего ссылку — по нему строится `module:id` на дашборде админки. */
  module: string;
  topic: string;
  section?: string;
  label: string;
  path: string;
  order?: number;
  icon?: string;
}

export interface DashboardRegistry {
  registerTopic(id: string, topic: Omit<DashboardTopic, 'id'>): void;
  registerSection(id: string, section: Omit<DashboardSection, 'id'>): void;
  registerLink(id: string, link: Omit<DashboardLink, 'id'>): void;
  getTopics(): DashboardTopic[];
  getSections(topicId?: string): DashboardSection[];
  getLinks(topicId?: string): DashboardLink[];
}

export interface DocumentRegistry {
  register(id: string, doc: Omit<DocumentType, 'id'>): void;
  get(docId: string): DocumentType | undefined;
  getAll(): DocumentType[];
  objects: DocumentObjectRegistry;
  lists: DocumentListRegistry;
  dashboard: DashboardRegistry;
  fixtures: FixtureRegistry;
}

export type AccessLevel = 'public' | 'owner' | 'role' | 'group';

export interface DocumentAccess {
  docType: string;
  docId: string;
  level: AccessLevel;
  owner?: string;
  role?: string;
  groupId?: string;
}

export const Documents = { USER: 'user', USER_GROUP: 'user-group', SCHEDULED_TASK: 'scheduled-task' } as const;

export const DocumentPages = {
  DEFAULT: 'default',
  USER_ACCESS: 'user-access',
  USER_LOG: 'user-log',
  SCHEDULED_TASK_RUNS: 'scheduled-task-runs',
} as const;

export const DashboardTopics = {
  DOCUMENTS: 'documents',
  SYSTEM: 'system',
} as const;

export const DocumentGroups = {
  DEFAULT: 'default',
  SECURITY: 'security',
  ACCESS_RIGHTS: 'access-rights',
  MEMBERS: 'members',
  AUTH_LOG: 'auth-log',
} as const;

// Frontend-safe types (schema stripped — backend-only runtime objects).
// `DocumentType` таблицы больше не держит, поэтому стриптить у него нечего — алиас оставлен,
// чтобы фронтовые сигнатуры читались симметрично `ListExtensionFrontend`.
export type DocumentTypeFrontend = DocumentType;
export type ListExtensionFrontend = Omit<ListExtension, 'schema'>;

/**
 * Плоский, JSON-serializable снимок документа — без методов, без классов. Можно передавать в
 * Redis/очередь/другой процесс без сюрпризов. `data` адресуется парой (module, key) — модуль может
 * зарегистрировать на одном документе несколько extension'ов, см. `DocumentExtension.key`.
 */
export interface DocumentObject {
  id: string;
  type: string;
  data: Record<string, Record<string, Record<string, unknown>>>;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

/** Typed key extension'а для доступа к своим данным через `extract`. Адресует ровно тот же бакет, что пишет рантайм. */
export interface NamespaceKey<T> {
  module: string;
  /** Совпадает с `DocumentExtension.key`. Для модуля с единственным `extend()` — `DEFAULT_EXTENSION_KEY`. */
  key?: string;
  _type: T;
}

/**
 * Приведение типа extension-данных модуля из `DocumentObject`. Свободная функция, не метод рантайма —
 * не делает I/O, поэтому работает и там, где нет живого `DocumentRuntime` (например, воркер,
 * получивший `DocumentObject` из очереди). Никакой валидации в рантайме — просто каст.
 */
export function extract<T>(doc: DocumentObject, ns: NamespaceKey<T>): T | undefined {
  return doc.data[ns.module]?.[ns.key ?? DEFAULT_EXTENSION_KEY] as T | undefined;
}
