import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { hrStaffUnitNode, hrStaffUnitVersion } from '../schemas/index.js';
import type { HrStructureService } from '../services/hr-structure-service.js';
import { definedOnly } from '../services/version-mode.js';
import { CARD_CORRECTION, HR_STRUCTURE_SECTION, SYSTEM_USER_ID } from './constants.js';
import { ensureNodeRow } from './node-row.js';

export function registerStaffUnitDoc(docs: DocumentRegistry, hrStructureService: HrStructureService): void {
  docs.register('staff-unit', {
    module: 'hr',
    label: 'hr:staff_unit_label',
    creatable: true,
    deletable: false,
    section: HR_STRUCTURE_SECTION,
  });

  docs.objects.extend('staff-unit', {
    module: 'hr',
    layout: {
      [DocumentPages.DEFAULT]: {
        [DocumentGroups.DEFAULT]: {
          rows: [
            ['code', 'templateId', 'gradeId'],
            [{ field: 'departmentNodeId', span: 2 }, 'legalEntityNodeId'],
            ['costCenterNodeId', 'quantity', 'isActive'],
            ['minSalary', 'maxSalary'],
          ],
        },
      },
    },
    fields: {
      code: { label: 'hr:field_code', widget: 'text', required: true },
      departmentNodeId: { label: 'hr:field_department', widget: 'reference', required: true },
      templateId: { label: 'hr:field_template', widget: 'reference', required: true },
      gradeId: { label: 'hr:field_grade', widget: 'reference' },
      legalEntityNodeId: { label: 'hr:field_legal_entity', widget: 'reference', required: true },
      costCenterNodeId: { label: 'hr:cost_center_label', widget: 'reference' },
      quantity: { label: 'hr:staff_unit_field_quantity', widget: 'number' },
      minSalary: { label: 'hr:field_min_salary', widget: 'number' },
      maxSalary: { label: 'hr:field_max_salary', widget: 'number' },
      isActive: { label: 'hr:field_active', widget: 'checkbox' },
    },
    load: async (db, docId) => {
      const node = await db.select().from(hrStaffUnitNode).where(eq(hrStaffUnitNode.id, docId)).limit(1);
      const [version] = await db
        .select()
        .from(hrStaffUnitVersion)
        .where(and(eq(hrStaffUnitVersion.nodeId, docId), isNull(hrStaffUnitVersion.validTo)))
        .limit(1);
      return { ...node[0], ...(version ?? {}) };
    },
    save: async (tx, id, data) => {
      const { code, departmentNodeId, templateId, gradeId, legalEntityNodeId, costCenterNodeId, quantity, minSalary, maxSalary, ...rest } =
        data;
      // У этого узла NOT NULL шире, чем `code`: без department/template строку не вставить, поэтому
      // все три поля карточки объявлены обязательными.
      await ensureNodeRow(tx, hrStaffUnitNode, id, definedOnly({ code, departmentNodeId, templateId }));

      await hrStructureService.updateStaffUnitAttributes(
        id,
        {
          gradeId: gradeId as string | null | undefined,
          legalEntityNodeId: legalEntityNodeId as string | undefined,
          costCenterNodeId: costCenterNodeId as string | null | undefined,
          quantity: quantity as string | undefined,
          minSalary: minSalary as string | null | undefined,
          maxSalary: maxSalary as string | null | undefined,
          metadata: (rest as { metadata?: Record<string, unknown> }).metadata,
        },
        CARD_CORRECTION,
        { performedByUserId: SYSTEM_USER_ID },
        { db: tx },
      );
    },
  });

  // Node+Version через generic-путь, два расширения — см. комментарий в department.ts.
  // Здесь на узле живут три колонки: code, departmentNodeId и templateId.
  docs.lists.extend('staff-unit', {
    module: 'hr',
    key: 'node',
    schema: hrStaffUnitNode,
    foreignKey: 'id',
    fields: {
      code: { label: 'hr:field_code', type: 'text', size: 120 },
      departmentNodeId: { label: 'hr:field_department', type: 'text', size: 160 },
      templateId: { label: 'hr:field_template', type: 'text', size: 160 },
    },
  });

  docs.lists.extend('staff-unit', {
    module: 'hr',
    schema: hrStaffUnitVersion,
    foreignKey: 'nodeId',
    joinType: 'inner',
    joinOn: t => isNull(t.validTo),
    fields: {
      gradeId: { label: 'hr:field_grade', type: 'text', size: 120 },
      legalEntityNodeId: { label: 'hr:field_legal_entity', type: 'text', size: 160 },
      quantity: { label: 'hr:staff_unit_list_field_quantity', type: 'number', size: 100 },
      isActive: { label: 'hr:field_active', type: 'checkbox', size: 80 },
    },
  });
}
