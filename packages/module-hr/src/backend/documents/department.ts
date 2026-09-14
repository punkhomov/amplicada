import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { hrDepartmentNode, hrDepartmentVersion } from '../schemas/index.js';
import type { HrStructureService } from '../services/hr-structure-service.js';
import { definedOnly } from '../services/version-mode.js';
import { CARD_CORRECTION, HR_STRUCTURE_SECTION, SYSTEM_USER_ID, today } from './constants.js';
import { ensureNodeRow } from './node-row.js';

export function registerDepartmentDoc(docs: DocumentRegistry, hrStructureService: HrStructureService): void {
  docs.register('department', {
    module: 'hr',
    label: 'hr:department_label',
    creatable: true,
    deletable: false,
    section: HR_STRUCTURE_SECTION,
  });

  docs.objects.extend('department', {
    module: 'hr',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      code: { label: 'hr:field_code', widget: 'text', required: true },
      name: { label: 'hr:field_name', widget: 'text', required: true },
      shortName: { label: 'hr:field_short_name', widget: 'text' },
      parentNodeId: { label: 'hr:department_field_parent', widget: 'reference' },
      headUserId: { label: 'hr:field_head', widget: 'reference' },
      type: { label: 'hr:field_type', widget: 'select' },
      orderIndex: { label: 'hr:field_order', widget: 'number' },
    },
    load: async (db, docId) => {
      const [node] = await db.select().from(hrDepartmentNode).where(eq(hrDepartmentNode.id, docId)).limit(1);
      const [version] = await db
        .select()
        .from(hrDepartmentVersion)
        .where(and(eq(hrDepartmentVersion.nodeId, docId), isNull(hrDepartmentVersion.validTo)))
        .limit(1);
      return { ...node, ...(version ?? {}) };
    },
    save: async (tx, id, data) => {
      const { code, name, shortName, parentNodeId, headUserId, type, orderIndex, ...rest } = data;
      await ensureNodeRow(tx, hrDepartmentNode, id, definedOnly({ code }));

      const audit = { performedByUserId: SYSTEM_USER_ID };
      const newParentNodeId = (parentNodeId as string | null | undefined) ?? null;

      const [existing] = await tx
        .select({ parentNodeId: hrDepartmentVersion.parentNodeId })
        .from(hrDepartmentVersion)
        .where(and(eq(hrDepartmentVersion.nodeId, id), isNull(hrDepartmentVersion.validTo)))
        .limit(1);

      if (!existing) {
        // Первая версия. Узел уже гарантированно есть — его завёл ensureNodeRow выше.
        const [node] = await tx.select({ code: hrDepartmentNode.code }).from(hrDepartmentNode).where(eq(hrDepartmentNode.id, id)).limit(1);
        const path = await hrStructureService.buildDepartmentPath(tx, newParentNodeId, node?.code ?? id);
        await tx.insert(hrDepartmentVersion).values({
          nodeId: id,
          parentNodeId: newParentNodeId,
          path,
          name: (name as string) ?? '',
          shortName: (shortName as string | null) ?? null,
          headUserId: (headUserId as string | null) ?? null,
          type: (type as string | null) ?? null,
          orderIndex: (orderIndex as number) ?? 0,
          // Первая версия действует с сегодняшнего дня — это единственное место, где карточка
          // всё-таки задаёт границу интервала: до неё интервала просто нет.
          validFrom: today(),
          metadata: (rest as { metadata?: Record<string, unknown> }).metadata ?? {},
          createdByUserId: audit.performedByUserId,
        });
        return;
      }

      // Переподчинение из карточки — тоже коррекция: path пересчитывается (и каскадом у потомков),
      // но истории переподчинений не остаётся. Дату переезда карточка заявить не может, а датировать
      // событие сегодняшним днём — ровно та подмена, из-за которой всё и ломалось.
      if (parentNodeId !== undefined && existing.parentNodeId !== newParentNodeId) {
        await hrStructureService.reparentDepartment(id, newParentNodeId, CARD_CORRECTION, audit, { db: tx });
      }

      await hrStructureService.updateDepartmentAttributes(
        id,
        {
          name: name as string | undefined,
          shortName: shortName as string | null | undefined,
          headUserId: headUserId as string | null | undefined,
          type: type as string | null | undefined,
          orderIndex: orderIndex as number | undefined,
          metadata: (rest as { metadata?: Record<string, unknown> }).metadata,
        },
        CARD_CORRECTION,
        audit,
        { db: tx },
      );
    },
  });

  // Node+Version через generic-путь: inner join на актуальную версию (validTo IS NULL) даёт ровно
  // одну строку на узел. Раньше здесь был listFetch, который в обход generic-пути молча терял
  // фильтры и сортировку, а в export-view не попадали и сами колонки версии.
  //
  // Два расширения, потому что колонки живут в двух таблицах: `code` на узле, остальное на версии.
  // Раньше это держалось на фолбэке buildListSelect на «базовую таблицу типа», которой больше нет.
  docs.lists.extend('department', {
    module: 'hr',
    key: 'node',
    schema: hrDepartmentNode,
    foreignKey: 'id',
    fields: {
      code: { label: 'hr:field_code', type: 'text', size: 120 },
    },
  });

  docs.lists.extend('department', {
    module: 'hr',
    schema: hrDepartmentVersion,
    foreignKey: 'nodeId',
    joinType: 'inner',
    joinOn: t => isNull(t.validTo),
    fields: {
      name: { label: 'hr:field_name', type: 'text', size: 220 },
      shortName: { label: 'hr:field_short_name', type: 'text', size: 160 },
      type: { label: 'hr:field_type', type: 'select', size: 120 },
      headUserId: { label: 'hr:field_head', type: 'text', size: 160 },
    },
  });
}
