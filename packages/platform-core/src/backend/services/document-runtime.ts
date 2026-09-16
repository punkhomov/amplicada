import { and, asc, desc, eq, getTableColumns, inArray, isNull, notInArray, type SQL, sql } from 'drizzle-orm';
import { alias, type PgColumn, type PgSelect, type PgTable } from 'drizzle-orm/pg-core';
import type { TFunction } from 'i18next';
import type { BackendDbService } from '../../contracts/backend/db.js';
import type {
  BackendDocumentRuntime,
  DocumentExportResult,
  DocumentImportResult,
  DocumentListParams,
  DocumentListResult,
  DocumentRegistryMetaResult,
  DocumentTypeMeta,
  EnrichedCell,
  EnrichedExtension,
  EnrichedGroup,
  EnrichedPage,
  EnrichedRow,
  ListConfigResult,
} from '../../contracts/backend/document-runtime.js';
import type {
  DocumentActor,
  DocumentExtension,
  DocumentObject,
  DocumentRegistry,
  DocumentType,
  GroupLayout,
  LayoutCell,
  ListExtension,
  ListFieldMeta,
} from '../../contracts/documents.js';
import { DEFAULT_EXTENSION_KEY } from '../../contracts/documents.js';
import { documentCustomFields, documentIndex } from '../schemas/index.js';
import { withDbErrors } from './db-errors.js';
import { DocumentRuntimeError } from './document-runtime-error.js';
import { postgresListSearchWhere } from './document-search.js';
import { buildFilterWhere, parseFilterParam } from './filter-sql.js';

export { DocumentRuntimeError };

/** label ещё не сконвертированных в ключи модулей — сырой текст; defaultValue гарантирует, что он вернётся как есть. */
function tl(t: TFunction | undefined, label: string): string {
  return t ? t(label, { defaultValue: label }) : label;
}

/** Число колонок legacy-дефолта раскладки, когда extension не задал `rows` явно. */
const DEFAULT_LAYOUT_COLUMNS = 3;

/**
 * Разбор префиксного ключа колонки списка (`module:key:field`) — обратная операция к
 * `DocumentRuntime.listColumnKey`. Хвост склеивается обратно, чтобы `:` внутри имени поля (если он
 * когда-нибудь появится) не терялся молча.
 */
function parseListColumnKey(prefixedKey: string): { module: string; key: string; field: string } {
  const [module, key, ...rest] = prefixedKey.split(':');
  return { module: module ?? 'unknown', key: key ?? DEFAULT_EXTENSION_KEY, field: rest.join(':') || prefixedKey };
}

/** Реальная колонка (per-module таблица) либо computed SQL-выражение (jsonb customFields, см. customFieldExpr). */
type ListColumn = PgColumn | SQL.Aliased;

/**
 * Документ не удалён. Единственный источник этого факта — `document_index`: колонок `deleted_at` в
 * базовых таблицах больше нет (этап 2 плана 06), состояние жило в двух местах и могло разъехаться.
 */
const ACTIVE_IN_INDEX: SQL = isNull(documentIndex.deletedAt);

/**
 * Колонки состояния документа, доступные спискам по имени поля, — индекс и есть FROM-таблица.
 * Явный список, а не «все колонки индекса»: иначе поле с именем `type`/`createdAt`, которого нет в
 * таблице расширения, молча подхватило бы колонку индекса вместо того, чтобы честно выпасть из
 * выборки.
 */
const INDEX_STATE_COLUMNS: Record<string, PgColumn> = {
  stale: documentIndex.stale,
  deletedAt: documentIndex.deletedAt,
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function parseDateFields(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = typeof value === 'string' && ISO_DATE_RE.test(value) ? new Date(value) : value;
  }
  return result;
}

export class DocumentRuntime implements BackendDocumentRuntime {
  constructor(
    private readonly db: BackendDbService,
    private readonly documents: DocumentRegistry,
  ) {}

  private getDocOrFail(type: string): DocumentType {
    const doc = this.documents.get(type);
    if (!doc) throw new DocumentRuntimeError(404, 'Document type not found');
    return doc;
  }

  private toTypeMeta(doc: DocumentType): DocumentTypeMeta {
    return { id: doc.id, label: doc.label, creatable: doc.creatable ?? true, deletable: doc.deletable ?? true };
  }

  /** `values ->> key` даёт text; для сортировки/сравнения по типу поля кастуем один раз здесь, а не в buildWhereClause — дальше это обычный SQL-столбец. */
  private customFieldExpr(valuesCol: PgColumn, key: string, type?: string): SQL {
    const raw = sql`${valuesCol} ->> ${key}`;
    switch (type) {
      case 'number':
        return sql`(${raw})::numeric`;
      case 'date':
      case 'datetime':
        return sql`(${raw})::timestamptz`;
      case 'checkbox':
        return sql`(${raw})::boolean`;
      default:
        return raw;
    }
  }

  /**
   * Ключ extension'а. `DocumentRegistryImpl` нормализует его при регистрации, так что в рантайме
   * значение всегда есть — `??` здесь только ради типов (`key` опционален во ВХОДНОМ контракте).
   * Единственное место коалесинга: ниже по коду ключ берётся уже отсюда.
   */
  private extKey(ext: { key?: string }): string {
    return ext.key ?? DEFAULT_EXTENSION_KEY;
  }

  /** Единственное место склейки префиксного ключа колонки списка (`module:key:field`). */
  private listColumnKey(ext: { module: string; key?: string }, field: string): string {
    return `${ext.module}:${this.extKey(ext)}:${field}`;
  }

  /** SQL-алиас join'а customFields — свой на каждый extension, иначе два extension'а не разъехались бы в одном запросе. */
  private customFieldsAlias(ext: { module: string; key?: string }): string {
    return `cf_${ext.module}_${this.extKey(ext)}`;
  }

  private buildListSelect(type: string): { columns: Record<string, ListFieldMeta>; selectObj: Record<string, ListColumn> } {
    const listExts = this.documents.lists.getExtensions(type);
    const columns: Record<string, ListFieldMeta> = {};
    const selectObj: Record<string, ListColumn> = {};
    for (const ext of listExts) {
      if (!ext.fields) continue;
      if (ext.customFields) {
        const cfTable = alias(documentCustomFields, this.customFieldsAlias(ext));
        for (const [field, meta] of Object.entries(ext.fields)) {
          const prefixedKey = this.listColumnKey(ext, field);
          columns[prefixedKey] = meta;
          selectObj[prefixedKey] = this.customFieldExpr(cfTable.values, field, meta.type).as(prefixedKey);
        }
        continue;
      }
      // Фолбэков больше нет: расширение объявляет свою таблицу явно. Раньше их было два (на
      // `doc.schema` целиком и на её отдельные колонки), и Node+Version-типы держались на них —
      // теперь у таких типов просто два расширения списка, node и version.
      const tableColumns = ext.schema ? getTableColumns(ext.schema) : undefined;
      for (const [field, meta] of Object.entries(ext.fields)) {
        const prefixedKey = this.listColumnKey(ext, field);
        columns[prefixedKey] = meta;
        const column = tableColumns?.[field] ?? INDEX_STATE_COLUMNS[field];
        if (column) selectObj[prefixedKey] = column as PgColumn;
      }
    }
    return { columns, selectObj };
  }

  /**
   * Единственное место сборки WHERE для list()/streamExportBatches(): отбор по типу, живость и
   * пользовательский фильтр. Отбор по типу появился здесь вместе с переездом FROM на
   * `document_index` — в одной таблице лежат документы всех типов.
   */
  private resolveWhere(
    type: string,
    columns: Record<string, ListFieldMeta>,
    selectObj: Record<string, ListColumn>,
    rawFilters: string | undefined,
    rawSearch?: string,
  ): SQL {
    const userWhere = buildFilterWhere(parseFilterParam(rawFilters), columns, selectObj);
    const searchWhere = postgresListSearchWhere(rawSearch, columns, selectObj);
    // soft-deleted строки исключаются из выборки всегда, поверх пользовательских фильтров.
    return and(eq(documentIndex.type, type), ACTIVE_IN_INDEX, userWhere, searchWhere) as SQL;
  }

  private applyJoins(query: PgSelect, joinExts: ListExtension[], idColRef: PgColumn): PgSelect {
    let result = query;
    for (const ext of joinExts) {
      if (ext.customFields) {
        const cfTable = alias(documentCustomFields, this.customFieldsAlias(ext));
        result = result.leftJoin(
          cfTable,
          and(eq(cfTable.docId, idColRef), eq(cfTable.module, ext.module), eq(cfTable.key, this.extKey(ext))) as SQL,
        );
        continue;
      }
      const on = and(eq(getTableColumns(ext.schema)[ext.foreignKey as string], idColRef), ext.joinOn?.(ext.schema)) as SQL;
      // inner нужен effective-dated моделям (Node+Version): узел без актуальной версии не должен
      // появляться в списке — ровно та семантика, что была в их listFetch через innerJoin.
      result = ext.joinType === 'inner' ? result.innerJoin(ext.schema, on) : result.leftJoin(ext.schema, on);
    }
    return result;
  }

  /** Одна ячейка layout → enriched-ячейка. Валидирует ссылку `field` на пул `ext.fields`. */
  private normalizeCell(ext: DocumentExtension, fields: Record<string, unknown>, cell: LayoutCell): EnrichedCell {
    if (typeof cell === 'string') {
      if (!(cell in fields)) {
        throw new DocumentRuntimeError(
          500,
          `Document '${ext.document}' extension '${ext.module}:${this.extKey(ext)}': layout references unknown field '${cell}'`,
        );
      }
      return { kind: 'field', field: cell, span: 1 };
    }
    if ('field' in cell) {
      if (!(cell.field in fields)) {
        throw new DocumentRuntimeError(
          500,
          `Document '${ext.document}' extension '${ext.module}:${this.extKey(ext)}': layout references unknown field '${cell.field}'`,
        );
      }
      return { kind: 'field', field: cell.field, span: cell.span ?? 1 };
    }
    if ('component' in cell) return { kind: 'component', component: cell.component, span: cell.span ?? 1 };
    return { kind: 'empty', span: cell.span ?? 1 };
  }

  /**
   * Строки группы. Если `rows` не задан — legacy-дефолт: поля разложены по строкам
   * DEFAULT_LAYOUT_COLUMNS-колоночной сеткой (сохраняет прежний вид не-мигрированных документов).
   */
  private normalizeRows(ext: DocumentExtension, groupLayout: GroupLayout): EnrichedRow[] {
    const fields = ext.fields ?? {};
    let rawRows = groupLayout.rows;
    if (!rawRows) {
      const keys = Object.keys(fields);
      rawRows = [];
      for (let i = 0; i < keys.length; i += DEFAULT_LAYOUT_COLUMNS) {
        rawRows.push(keys.slice(i, i + DEFAULT_LAYOUT_COLUMNS));
      }
    }
    return rawRows.map(row => row.map(cell => this.normalizeCell(ext, fields, cell)));
  }

  private buildEnrichedPages(type: string): EnrichedPage[] {
    const pages = this.documents.objects.getPages(type);
    const pageIds = new Set(pages.map(p => p.id));

    // page id → group id → вклады модулей (несколько модулей в одной группе — стек)
    const buckets = new Map<string, Map<string, EnrichedExtension[]>>();
    for (const ext of this.documents.objects.getExtensions(type)) {
      for (const [pageId, groups] of Object.entries(ext.layout)) {
        if (!pageIds.has(pageId)) {
          throw new DocumentRuntimeError(
            500,
            `Document '${type}' extension '${ext.module}:${this.extKey(ext)}': layout references unknown page '${pageId}'`,
          );
        }
        const validGroupIds = new Set(this.documents.objects.getGroups(pageId, type).map(g => g.id));
        for (const [groupId, groupLayout] of Object.entries(groups)) {
          if (!validGroupIds.has(groupId)) {
            throw new DocumentRuntimeError(
              500,
              `Document '${type}' extension '${ext.module}:${this.extKey(ext)}': layout references unknown group '${groupId}' on page '${pageId}'`,
            );
          }
          const enriched: EnrichedExtension = {
            module: ext.module,
            key: this.extKey(ext),
            fields: ext.fields ?? {},
            rows: this.normalizeRows(ext, groupLayout),
          };
          let byGroup = buckets.get(pageId);
          if (!byGroup) {
            byGroup = new Map();
            buckets.set(pageId, byGroup);
          }
          const arr = byGroup.get(groupId) ?? [];
          arr.push(enriched);
          byGroup.set(groupId, arr);
        }
      }
    }

    return pages.map(page => {
      const groups = this.documents.objects.getGroups(page.id, type);
      const byGroup = buckets.get(page.id);
      return {
        ...page,
        groups: groups.map(group => {
          const enrichedGroup: EnrichedGroup = { ...group, extensions: byGroup?.get(group.id) ?? [] };
          return enrichedGroup;
        }),
      };
    });
  }

  /**
   * id документа, заданный в item'е импорта. Тело трёхуровневое (`module → key → field`,
   * см. `DocumentExtension.key`), а `id` объявлен полем того расширения, которому принадлежит
   * главная таблица, — поэтому ищем на два уровня вглубь.
   */
  private findItemId(item: Record<string, unknown>): string | undefined {
    for (const byKey of Object.values(item)) {
      if (!byKey || typeof byKey !== 'object' || Array.isArray(byKey)) continue;
      for (const extData of Object.values(byKey as Record<string, unknown>)) {
        if (!extData || typeof extData !== 'object' || Array.isArray(extData)) continue;
        const id = (extData as Record<string, unknown>).id;
        if (typeof id === 'string' && id) return id;
      }
    }
    return undefined;
  }

  /** Таблица, в которой физически лежат данные расширения, и колонка связи с документом. */
  private extTable(ext: DocumentExtension): { table: PgTable; idColumn: string } | undefined {
    if (!ext.schema) return undefined;
    return { table: ext.schema, idColumn: ext.idColumn ?? 'id' };
  }

  /** Расширение вообще хранит данные — значит участвует в чтении документа и выгрузке. */
  private extHasData(ext: DocumentExtension): boolean {
    return !!ext.load || !!ext.customFields || !!ext.schema;
  }

  /** Если `ext.load` не задан явно, но есть `ext.customFields`/таблица — читаем сами (jsonb-бэкенд либо колонки по idColumn=docId). */
  private async loadExtension(ext: DocumentExtension, db: BackendDbService, docId: string): Promise<Record<string, unknown>> {
    if (ext.load) return ext.load(db, docId);
    if (ext.customFields) {
      const [row] = await db
        .select({ values: documentCustomFields.values })
        .from(documentCustomFields)
        .where(
          and(
            eq(documentCustomFields.docId, docId),
            eq(documentCustomFields.module, ext.module),
            eq(documentCustomFields.key, this.extKey(ext)),
          ),
        )
        .limit(1);
      return (row?.values as Record<string, unknown>) ?? {};
    }
    const target = this.extTable(ext);
    if (!target) return {};
    const { table, idColumn } = target;
    const columns = getTableColumns(table);
    const [row] = await db.select().from(table).where(eq(columns[idColumn], docId)).limit(1);
    if (!row) return {};
    const { [idColumn]: _drop, ...rest } = row as Record<string, unknown>;
    return rest;
  }

  /** Если `ext.save` не задан явно: `ext.customFields` — upsert всего jsonb-блоба модуля; иначе таблица расширения — пишем только те ключи data, что реально есть колонками. */
  private async saveExtension(ext: DocumentExtension, db: BackendDbService, id: string, data: Record<string, unknown>): Promise<void> {
    if (ext.save) return ext.save(db, id, data);
    if (ext.customFields) {
      await db
        .insert(documentCustomFields)
        .values({ docId: id, module: ext.module, key: this.extKey(ext), values: data })
        .onConflictDoUpdate({
          target: [documentCustomFields.docId, documentCustomFields.module, documentCustomFields.key],
          set: { values: data },
        });
      return;
    }
    const target = this.extTable(ext);
    if (!target) return;
    const { table, idColumn } = target;
    const columns = getTableColumns(table);
    const idCol = columns[idColumn];
    const values: Record<string, unknown> = {};
    for (const key of Object.keys(columns)) {
      if (key === idColumn) continue;
      if (data[key] !== undefined) values[key] = data[key];
    }
    if (!Object.keys(values).length) return;

    // UPDATE, а если задето 0 строк — INSERT. Голый `ON CONFLICT DO UPDATE` не годится: Postgres
    // проверяет NOT NULL при формировании кортежа, ДО разрешения конфликта, а карточка при частичном
    // сохранении присылает не все обязательные колонки. Лишний запрос платится только при первой
    // записи расширения; существование живого документа к этому моменту уже проверено
    // (assertDocumentActive в update, свежий allocateDocumentId в create).
    const touched = await db.update(table).set(values).where(eq(idCol, id)).returning({ id: idCol });
    if (touched.length) return;
    // biome-ignore lint/suspicious/noExplicitAny: schema any → PgInsert не типизируется динамически
    await (db.insert(table) as any).values({ [idColumn]: id, ...values });
  }

  private async saveExtensionData(db: BackendDbService, type: string, id: string, body: Record<string, unknown>): Promise<void> {
    for (const ext of this.documents.objects.getExtensions(type)) {
      // `save` без своей таблицы — тоже валидный писатель (пишет в чужую); `extHasData` про чтение.
      if (!ext.save && !this.extHasData(ext)) continue;
      const moduleData = body[ext.module] as Record<string, unknown> | undefined;
      const extData = moduleData?.[this.extKey(ext)];
      if (extData && typeof extData === 'object') {
        await this.saveExtension(ext, db, id, parseDateFields(extData as Record<string, unknown>));
      }
    }
  }

  /** Удаляет extension-строки всех модулей документа. Кастомный `remove`, если задан, вызывается по одному id за раз (как `load`/`save`); для остальных — один bulk DELETE по schema. */
  private async deleteExtensionData(db: BackendDbService, type: string, ids: string[]): Promise<void> {
    for (const ext of this.documents.objects.getExtensions(type)) {
      if (ext.remove) {
        for (const id of ids) await ext.remove(db, id);
        continue;
      }
      if (ext.customFields) {
        await db
          .delete(documentCustomFields)
          .where(
            and(
              eq(documentCustomFields.module, ext.module),
              eq(documentCustomFields.key, this.extKey(ext)),
              inArray(documentCustomFields.docId, ids),
            ),
          );
        continue;
      }
      if (!ext.schema) continue;
      const idColumn = ext.idColumn ?? 'id';
      const idCol = getTableColumns(ext.schema)[idColumn];
      await db.delete(ext.schema).where(inArray(idCol, ids));
    }
  }

  async list(type: string, params: DocumentListParams): Promise<DocumentListResult> {
    const doc = this.getDocOrFail(type);
    // FROM — сам индекс: своей таблицы у типа нет, все расширения приджойниваются на общих правах.
    const idColRef = documentIndex.id;
    const listExts = this.documents.lists.getExtensions(type);

    const joinExts = listExts.filter(e => (!!e.schema && !!e.foreignKey) || !!e.customFields);

    const { columns, selectObj } = this.buildListSelect(type);

    const query = params as Record<string, string | undefined>;
    const requestedColumns = query.columns
      ? query.columns
          .split(',')
          .map(c => c.trim())
          .filter(Boolean)
      : null;

    let finalSelectObj: Record<string, ListColumn> = { ...selectObj, id: idColRef };
    if (requestedColumns) {
      finalSelectObj = { id: idColRef };
      for (const key of requestedColumns) {
        if (key in selectObj) finalSelectObj[key] = selectObj[key];
      }
    }

    const whereClause = this.resolveWhere(type, columns, selectObj, query.filters, query.search);

    const baseQuery: PgSelect = this.applyJoins(this.db.select(finalSelectObj).from(documentIndex).$dynamic(), joinExts, idColRef).where(
      whereClause,
    );

    const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(String(query.pageSize ?? '20'), 10) || 20));

    const orderByColumn = query.sortBy && selectObj[query.sortBy] ? selectObj[query.sortBy] : null;
    const sortDir = query.sortDir === 'desc' ? 'desc' : 'asc';

    const countQuery: PgSelect = this.applyJoins(
      this.db.select({ count: sql<number>`count(*)` }).from(documentIndex).$dynamic(),
      joinExts,
      idColRef,
    ).where(whereClause);
    const [{ count }] = await countQuery;
    const total = Number(count);

    let dataQuery = baseQuery;
    if (orderByColumn) {
      dataQuery = dataQuery.orderBy(sortDir === 'desc' ? desc(orderByColumn) : asc(orderByColumn));
    }
    dataQuery = dataQuery.limit(pageSize).offset((page - 1) * pageSize);

    const items = await dataQuery;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      type: this.toTypeMeta(doc),
      columns,
      items,
      pagination: { page, pageSize, total, totalPages },
    };
  }

  getListConfig(type: string): ListConfigResult | null {
    const doc = this.documents.get(type);
    if (!doc) return null;
    const { columns } = this.buildListSelect(type);
    return { type: this.toTypeMeta(doc), columns };
  }

  async getAnyById(id: string, type?: string): Promise<DocumentObject | null> {
    // Строка индекса и ЕСТЬ документ: она знает тип, живость и владеет id. soft-deleted не отдаётся
    // (undelete-UI отложен — см. план), восстановление — restore().
    const [indexRow] = await this.db
      .select({ type: documentIndex.type })
      .from(documentIndex)
      .where(and(eq(documentIndex.id, id), ACTIVE_IN_INDEX))
      .limit(1);
    if (!indexRow) return null;
    // Тип из URL, не совпавший с типом документа, — это 404, а не «прочитаем чужими расширениями».
    if (type && type !== indexRow.type) return null;
    const resolvedType = indexRow.type;
    this.getDocOrFail(resolvedType);

    // REPEATABLE READ пинит все extension-запросы на один снапшот — без этого конкурентный update()
    // между отдельными SELECT'ами мог дать «рваное» чтение (часть extension'ов уже видит новые
    // данные, часть — ещё старые).
    return this.db.transaction(
      async tx => {
        const data: Record<string, Record<string, Record<string, unknown>>> = {};
        for (const ext of this.documents.objects.getExtensions(resolvedType)) {
          if (this.extHasData(ext)) {
            data[ext.module] ??= {};
            data[ext.module][this.extKey(ext)] = await this.loadExtension(ext, tx, id);
          }
        }

        return { id, type: resolvedType, data };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  /**
   * Создание = строка индекса + запись расширений. Прежняя ветка «собрать плоские значения и
   * вставить их в базовую таблицу» исчезла вместе с базовой таблицей, а с ней — и молчаливое
   * схлопывание одноимённых полей разных модулей, которое та ветка делала (`flattenBody`).
   */
  async create(type: string, body: Record<string, unknown>, actor?: DocumentActor): Promise<{ id: string }> {
    const doc = this.getDocOrFail(type);
    if (doc.creatable === false) throw new DocumentRuntimeError(403, 'Создание записей для этого типа документа запрещено');
    return withDbErrors('create', () =>
      this.db.transaction(async tx => {
        const id = await this.allocateDocumentId(type, tx, { actor });
        await this.saveExtensionData(tx, type, id, body);
        return { id };
      }),
    );
  }

  /**
   * Документ существует, имеет ожидаемый тип и не удалён. Без этой проверки `update()` отвечал бы
   * `{ok: true}` на несуществующий id, а soft-deleted документ редактировался бы в обход
   * `getAnyById`, который его уже не отдаёт. Проверка внутри транзакции — иначе параллельное
   * удаление проскакивает между SELECT и записью.
   *
   * Спрашивается индекс, а не базовая таблица: он и хранит признак удалённости, и заодно даёт
   * сверку типа, которой у прежней проверки не было.
   */
  private async assertDocumentActive(db: BackendDbService, type: string, id: string): Promise<void> {
    const [row] = await db
      .select({ id: documentIndex.id })
      .from(documentIndex)
      .where(and(eq(documentIndex.id, id), eq(documentIndex.type, type), ACTIVE_IN_INDEX))
      .limit(1);
    if (!row) throw new DocumentRuntimeError(404, 'Документ не найден');
  }

  async update(type: string, id: string, body: Record<string, unknown>, actor?: DocumentActor): Promise<void> {
    this.getDocOrFail(type);
    await withDbErrors('update', () =>
      this.db.transaction(async tx => {
        await this.assertDocumentActive(tx, type, id);
        await this.saveExtensionData(tx, type, id, body);
        await tx
          .update(documentIndex)
          .set({ updatedAt: new Date(), updatedByUserId: actor?.userId ?? null })
          .where(eq(documentIndex.id, id));
      }),
    );
  }

  /**
   * Soft delete, если тип объявил `softDelete: true`: помечается только строка document_index,
   * extension-данные не трогаются (документ восстановим через restore). Иначе — hard delete
   * (расширения → индекс).
   */
  async delete(type: string, id: string, actor?: DocumentActor): Promise<void> {
    const doc = this.getDocOrFail(type);
    if (doc.deletable === false) throw new DocumentRuntimeError(403, 'Удаление записей для этого типа документа запрещено');
    await this.deleteMany(doc, type, [id], actor);
  }

  async bulkDelete(type: string, ids: string[], actor?: DocumentActor): Promise<void> {
    const doc = this.getDocOrFail(type);
    if (doc.deletable === false) throw new DocumentRuntimeError(403, 'Удаление записей для этого типа документа запрещено');
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new DocumentRuntimeError(400, 'ids must be a non-empty array');
    }
    await this.deleteMany(doc, type, ids.map(String), actor);
  }

  /** Actor пишется только в soft-delete ветку (document_index переживает удаление). Hard-delete стирает строку целиком — писать некуда и незачем. */
  private async deleteMany(doc: DocumentType, type: string, ids: string[], actor?: DocumentActor): Promise<void> {
    await withDbErrors('delete', () =>
      this.db.transaction(async tx => {
        if (doc.softDelete) {
          // Одна запись вместо двух: копии `deleted_at` в базовых таблицах больше нет.
          await tx
            .update(documentIndex)
            .set({ deletedAt: new Date(), deletedByUserId: actor?.userId ?? null })
            .where(inArray(documentIndex.id, ids));
        } else {
          // Расширения — раньше индекса: их таблицы ссылаются на него внешним ключом.
          await this.deleteExtensionData(tx, type, ids);
          await tx.delete(documentIndex).where(inArray(documentIndex.id, ids));
        }
      }),
    );
  }

  /** Снимает soft-delete: очищает `deletedAt` в document_index. 400, если тип не поддерживает soft-delete. */
  async restore(type: string, id: string): Promise<void> {
    const doc = this.getDocOrFail(type);
    if (!doc.softDelete) throw new DocumentRuntimeError(400, 'Тип документа не поддерживает soft-delete');
    await withDbErrors('update', () =>
      this.db.update(documentIndex).set({ deletedAt: null, deletedByUserId: null }).where(eq(documentIndex.id, id)),
    );
  }

  /** Физическое удаление: каскад extension-данных + удаление из document_index. Работает и для soft-deleted, и для активных строк. */
  async hardDelete(type: string, id: string): Promise<void> {
    const doc = this.getDocOrFail(type);
    if (doc.deletable === false) throw new DocumentRuntimeError(403, 'Удаление записей для этого типа документа запрещено');
    await withDbErrors('delete', () =>
      this.db.transaction(async tx => {
        await this.deleteExtensionData(tx, type, [id]);
        await this.indexRemoved(id, tx);
      }),
    );
  }

  async exportData(type: string): Promise<DocumentExportResult> {
    const doc = this.getDocOrFail(type);

    const allRows = await this.db
      .select({ id: documentIndex.id })
      .from(documentIndex)
      .where(and(eq(documentIndex.type, type), ACTIVE_IN_INDEX));

    const items: Record<string, Record<string, Record<string, unknown>>>[] = [];
    for (const row of allRows) {
      const id = String(row.id);
      const data: Record<string, Record<string, Record<string, unknown>>> = {};
      for (const ext of this.documents.objects.getExtensions(type)) {
        if (this.extHasData(ext)) {
          data[ext.module] ??= {};
          data[ext.module][this.extKey(ext)] = await this.loadExtension(ext, this.db, id);
        }
      }
      items.push(data);
    }

    const columns: Record<string, Record<string, Record<string, ListFieldMeta>>> = {};
    for (const ext of this.documents.objects.getExtensions(type)) {
      if (ext.fields) {
        columns[ext.module] ??= {};
        const byField: Record<string, ListFieldMeta> = {};
        for (const [field, meta] of Object.entries(ext.fields)) {
          byField[field] = { label: meta.label, type: meta.widget };
        }
        columns[ext.module][this.extKey(ext)] = byField;
      }
    }

    return { type: this.toTypeMeta(doc), items, columns };
  }

  private async streamExportBatches(
    type: string,
    params: DocumentListParams,
    onRow: (row: Record<string, unknown>) => void,
  ): Promise<void> {
    this.getDocOrFail(type);
    const idColRef = documentIndex.id;
    const listExts = this.documents.lists.getExtensions(type);
    const joinExts = listExts.filter(e => (!!e.schema && !!e.foreignKey) || !!e.customFields);

    const { columns, selectObj } = this.buildListSelect(type);

    const query = params as Record<string, string | undefined>;
    const requestedColumns = query.columns
      ? query.columns
          .split(',')
          .map(c => c.trim())
          .filter(Boolean)
      : null;

    let finalSelectObj: Record<string, ListColumn> = { ...selectObj, id: idColRef };
    if (requestedColumns) {
      finalSelectObj = { id: idColRef };
      for (const key of requestedColumns) {
        if (key in selectObj) finalSelectObj[key] = selectObj[key];
      }
    }

    const whereClause = this.resolveWhere(type, columns, selectObj, query.filters, query.search);

    const sortColumn = query.sortBy && selectObj[query.sortBy] ? selectObj[query.sortBy] : null;
    const sortDir = query.sortDir === 'desc' ? 'desc' : 'asc';

    const BATCH_SIZE = 1000;

    // REPEATABLE READ пинит батчи на одно соединение и один снапшот данных на момент BEGIN —
    // строки, вставленные/удалённые после старта экспорта, в выгрузку не попадают и не рвут пагинацию.
    await this.db.transaction(
      async tx => {
        let offset = 0;
        for (;;) {
          let batchQuery: PgSelect = this.applyJoins(tx.select(finalSelectObj).from(documentIndex).$dynamic(), joinExts, idColRef).where(
            whereClause,
          );
          // id как tie-breaker — без детерминированного порядка LIMIT/OFFSET между отдельными
          // батч-запросами не гарантирует отсутствие дублей/пропусков, даже внутри одного снапшота.
          batchQuery = batchQuery.orderBy(
            ...(sortColumn ? [sortDir === 'desc' ? desc(sortColumn) : asc(sortColumn), asc(idColRef)] : [asc(idColRef)]),
          );
          batchQuery = batchQuery.limit(BATCH_SIZE).offset(offset);

          const rows = (await batchQuery) as Record<string, unknown>[];
          for (const row of rows) onRow(row);
          if (rows.length < BATCH_SIZE) break;
          offset += BATCH_SIZE;
        }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async exportDataFiltered(
    type: string,
    params: DocumentListParams,
    format: 'csv' | 'json' = 'json',
    t?: TFunction,
  ): Promise<ReadableStream> {
    const doc = this.getDocOrFail(type);
    const { columns } = this.buildListSelect(type);

    const query = params as Record<string, string | undefined>;
    const requestedColumns = query.columns
      ? query.columns
          .split(',')
          .map(c => c.trim())
          .filter(Boolean)
      : null;

    const exportColumns: Record<string, Record<string, Record<string, ListFieldMeta>>> = {};
    for (const [prefixedKey, meta] of Object.entries(columns)) {
      if (requestedColumns && !requestedColumns.includes(prefixedKey)) continue;
      const { module, key, field } = parseListColumnKey(prefixedKey);
      exportColumns[module] ??= {};
      exportColumns[module][key] ??= {};
      exportColumns[module][key][field] = { label: tl(t, meta.label), type: meta.type };
    }

    const encoder = new TextEncoder();
    const runExport = (onRow: (row: Record<string, unknown>) => void) => this.streamExportBatches(type, params, onRow);

    if (format === 'csv') {
      const allHeaders: string[] = [];
      for (const [module, byKey] of Object.entries(exportColumns)) {
        for (const [key, fields] of Object.entries(byKey)) {
          for (const field of Object.keys(fields)) {
            allHeaders.push(`${module}:${key}:${field}`);
          }
        }
      }

      return new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`${allHeaders.join(',')}\n`));
          runExport(row => {
            const csvRow = allHeaders
              .map(header => {
                const val = row[header];
                if (val === null || val === undefined) return '';
                const str = String(val);
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                  return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
              })
              .join(',');
            controller.enqueue(encoder.encode(`${csvRow}\n`));
          })
            .then(() => controller.close())
            .catch((err: unknown) => controller.error(err));
        },
      });
    }

    const typeMeta = { ...this.toTypeMeta(doc), label: tl(t, doc.label) };

    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`{"type":${JSON.stringify(typeMeta)},"columns":${JSON.stringify(exportColumns)},"items":[`));
        let first = true;
        runExport(row => {
          const namespaced: Record<string, Record<string, Record<string, unknown>>> = {};
          for (const [prefixedKey, value] of Object.entries(row)) {
            if (prefixedKey === 'id') continue;
            const { module, key, field } = parseListColumnKey(prefixedKey);
            namespaced[module] ??= {};
            namespaced[module][key] ??= {};
            namespaced[module][key][field] = value;
          }
          if (!first) controller.enqueue(encoder.encode(','));
          controller.enqueue(encoder.encode(JSON.stringify(namespaced)));
          first = false;
        })
          .then(() => {
            controller.enqueue(encoder.encode(']}'));
            controller.close();
          })
          .catch((err: unknown) => controller.error(err));
      },
    });
  }

  async importData(type: string, items: Record<string, unknown>[]): Promise<DocumentImportResult> {
    const doc = this.getDocOrFail(type);
    if (doc.creatable === false) throw new DocumentRuntimeError(403, 'Создание записей для этого типа документа запрещено');
    if (!Array.isArray(items) || items.length === 0) {
      throw new DocumentRuntimeError(400, 'items must be a non-empty array');
    }

    let created = 0;
    let updated = 0;
    const errors: { index: number; error: string }[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const item = items[i];
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          errors.push({ index: i, error: 'Item must be an object' });
          continue;
        }

        const itemRecord = item as Record<string, unknown>;
        const itemId = this.findItemId(itemRecord);

        // Ошибка констрейнта попадёт в errors[] уже человеческим текстом, а не сырым SQL.
        await withDbErrors('create', () =>
          this.db.transaction(async tx => {
            let idValue: string;

            if (itemId) {
              // Проверки ДО indexCreated: тот в conflict-ветке сбрасывает deletedAt и переписывает
              // type, то есть сам бы и воскресил документ (импорт не должен обходить restore) и
              // молча угнал бы чужой id.
              const [indexRow] = await tx
                .select({ deletedAt: documentIndex.deletedAt, type: documentIndex.type })
                .from(documentIndex)
                .where(eq(documentIndex.id, itemId))
                .limit(1);
              if (indexRow?.deletedAt) throw new DocumentRuntimeError(409, 'Документ удалён — восстановите его перед импортом');
              if (indexRow && indexRow.type !== type) {
                throw new DocumentRuntimeError(409, `Этот id уже занят документом типа '${indexRow.type}'`);
              }

              // id пришёл в item'е — резервируем именно его: таблицы расширений ссылаются на индекс
              // внешним ключом, так что lookup-строка обязана существовать до записи данных.
              await this.indexCreated(type, itemId, tx);
              idValue = itemId;
              if (indexRow) updated++;
              else created++;
            } else {
              idValue = await this.allocateDocumentId(type, tx);
              created++;
            }

            await this.saveExtensionData(tx, type, idValue, itemRecord);
          }),
        );
      } catch (err: unknown) {
        errors.push({ index: i, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { created, updated, errors };
  }

  getRegistryMeta(type: string): DocumentRegistryMetaResult | null {
    const doc = this.documents.get(type);
    if (!doc) return null;
    const pages = this.buildEnrichedPages(type);
    return { type: this.toTypeMeta(doc), pages };
  }

  /**
   * Заводит строку `document_index` и возвращает сгенерированный id — базовая строка вставляется
   * следом, уже с ним. Порядок именно такой: базовые таблицы ссылаются на индекс внешним ключом,
   * так что lookup-запись обязана существовать до вставки.
   *
   * Парный `indexCreated` остаётся для случаев, когда id известен заранее (fixture с pinned `{ id }`,
   * импорт с явным id в item'е): там он не «дописывает индекс после факта», а резервирует
   * конкретный id перед вставкой.
   */
  async allocateDocumentId(
    type: string,
    db: BackendDbService = this.db,
    opts?: { fixture?: boolean; actor?: DocumentActor },
  ): Promise<string> {
    const now = new Date();
    const [row] = await db
      .insert(documentIndex)
      .values({
        type,
        fixture: opts?.fixture ?? false,
        createdByUserId: opts?.actor?.userId ?? null,
        updatedAt: now,
        updatedByUserId: opts?.actor?.userId ?? null,
      })
      .returning({ id: documentIndex.id });
    return row.id;
  }

  async indexCreated(
    type: string,
    id: string,
    db: BackendDbService = this.db,
    opts?: { fixture?: boolean; actor?: DocumentActor },
  ): Promise<void> {
    const isFixture = opts?.fixture ?? false;
    const set: Record<string, unknown> = { type, deletedAt: null };
    // fixture-строку помечаем и снимаем stale (код объявил её снова); для обычного create fixture/stale не трогаем.
    if (isFixture) {
      set.fixture = true;
      set.stale = false;
    }
    const now = new Date();
    // createdByUserId/updatedByUserId — только в values (первый insert). При конфликте (повторная
    // fixture-реконсиляция/backfill того же id) исходный создатель в set не попадает — не переписывается.
    await db
      .insert(documentIndex)
      .values({
        id,
        type,
        fixture: isFixture,
        createdByUserId: opts?.actor?.userId ?? null,
        updatedAt: now,
        updatedByUserId: opts?.actor?.userId ?? null,
      })
      .onConflictDoUpdate({ target: documentIndex.id, set });
  }

  async indexRemoved(id: string, db: BackendDbService = this.db): Promise<void> {
    await db.delete(documentIndex).where(eq(documentIndex.id, id));
  }

  /**
   * Таблица расширения, в которой лежит natural key фикстуры. Своей таблицы у типа документа больше
   * нет, поэтому нужную ищем среди расширений — по объявленной колонке. Для pinned-варианта
   * (`{ id }`) колонки нет, и берётся первое расширение с таблицей: это расширение
   * модуля-владельца, зарегистрированное первым.
   */
  private fixtureTable(type: string, keyColumn?: string): { table: PgTable; idColumn: string } | undefined {
    for (const ext of this.documents.objects.getExtensions(type)) {
      const target = this.extTable(ext);
      if (!target) continue;
      if (!keyColumn || keyColumn === target.idColumn || getTableColumns(target.table)[keyColumn]) return target;
    }
    return undefined;
  }

  /**
   * Реконсиляция fixture-документов (обобщение `TaskRegistryImpl.reconcile`). Для каждого fixture:
   * строка расширения-владельца приводится к объявленной в коде (по conflict-key — pinned id или
   * natural-колонка), строка индекса помечается fixture. Затем stale-маркировка: fixture-строки,
   * которых больше нет в коде, помечаются (не удаляются).
   *
   * Поля: `values` (code-owned) пишутся и при INSERT, и при UPDATE; `updatedAt` (если колонка есть)
   * обновляется автоматически; остальные (user-owned) получают дефолты только при первом INSERT и не
   * трогаются при конфликте.
   *
   * Однозапросным `INSERT ... ON CONFLICT ... RETURNING id` это быть перестало: id рождается в
   * индексе, и до вставки строки данных его надо откуда-то взять. Отсюда явная развилка
   * «найти → обновить либо завести id и вставить»; атомарность держит транзакция бутстрапа.
   */
  async reconcileFixtures(db: BackendDbService = this.db): Promise<void> {
    const fixtures = this.documents.fixtures.getAll();
    const now = new Date();
    const seenByType = new Map<string, string[]>();

    for (const fx of fixtures) {
      const target = this.fixtureTable(fx.type, 'id' in fx.key ? undefined : fx.key.column);
      if (!target) continue;
      const { table, idColumn } = target;
      const columns = getTableColumns(table);

      const keyColName = 'id' in fx.key ? idColumn : fx.key.column;
      const keyValue = 'id' in fx.key ? fx.key.id : fx.key.value;
      const keyCol = columns[keyColName];
      const idCol = columns[idColumn];

      // `stale` живёт только в индексе (его снимает indexCreated с fixture: true) — таблице данных
      // остаётся один служебный штамп.
      const meta: Record<string, unknown> = {};
      if (columns.updatedAt) meta.updatedAt = now;

      const insertValues = { ...fx.values, [keyColName]: keyValue, ...meta };
      const updateSet = { ...fx.values, ...meta };

      const [found] = await db.select({ id: idCol }).from(table).where(eq(keyCol, keyValue)).limit(1);

      let resolvedId: string;
      if (found) {
        resolvedId = String(found.id);
        await db.update(table).set(updateSet).where(eq(idCol, resolvedId));
        await this.indexCreated(fx.type, resolvedId, db, { fixture: true });
      } else if ('id' in fx.key) {
        // pinned id: одинаков между контурами, другие таблицы могут хардкодить его как FK — резервируем именно его.
        resolvedId = fx.key.id;
        await this.indexCreated(fx.type, resolvedId, db, { fixture: true });
        // biome-ignore lint/suspicious/noExplicitAny: schema any → PgInsert не типизируется динамически
        await (db.insert(table) as any).values(insertValues);
      } else {
        resolvedId = await this.allocateDocumentId(fx.type, db, { fixture: true });
        // biome-ignore lint/suspicious/noExplicitAny: schema any → PgInsert не типизируется динамически
        await (db.insert(table) as any).values({ ...insertValues, [idColumn]: resolvedId });
      }

      const seen = seenByType.get(fx.type) ?? [];
      seen.push(resolvedId);
      seenByType.set(fx.type, seen);
    }

    // stale-маркировка: типы, у которых в document_index есть fixture-строки (даже если сейчас код
    // не объявил ни одной — тогда все они станут stale).
    const indexedTypes = await db.selectDistinct({ type: documentIndex.type }).from(documentIndex).where(eq(documentIndex.fixture, true));
    const allFixtureTypes = new Set<string>([...seenByType.keys(), ...indexedTypes.map(r => r.type)]);

    for (const type of allFixtureTypes) {
      const seenIds = seenByType.get(type) ?? [];
      const indexCond =
        seenIds.length > 0
          ? and(eq(documentIndex.type, type), eq(documentIndex.fixture, true), notInArray(documentIndex.id, seenIds))
          : and(eq(documentIndex.type, type), eq(documentIndex.fixture, true));
      // Одна запись: копии `stale` в базовой таблице больше нет, и вместе с ней ушло допущение
      // «все строки этой таблицы — фикстуры», по которому она метилась без скоупа.
      await db.update(documentIndex).set({ stale: true }).where(indexCond);
    }
  }
}
