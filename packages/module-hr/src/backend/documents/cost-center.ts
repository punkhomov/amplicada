import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { hrCostCenterNode, hrCostCenterVersion } from '../schemas/index.js';
import type { HrStructureService } from '../services/hr-structure-service.js';
import { definedOnly } from '../services/version-mode.js';
import { CARD_CORRECTION, HR_STRUCTURE_SECTION, SYSTEM_USER_ID, today } from './constants.js';
import { ensureNodeRow } from './node-row.js';

export function registerCostCenterDoc(docs: DocumentRegistry, hrStructureService: HrStructureService): void {
  docs.register('cost-center', {
    module: 'hr',
    label: 'hr:cost_center_label',
    creatable: true,
    deletable: false,
    section: HR_STRUCTURE_SECTION,
  });

  docs.objects.extend('cost-center', {
    module: 'hr',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      code: { label: 'hr:field_code', widget: 'text', required: true },
      name: { label: 'hr:field_name', widget: 'text', required: true },
      parentNodeId: { label: 'hr:cost_center_field_parent', widget: 'reference' },
      legalEntityNodeId: { label: 'hr:field_legal_entity', widget: 'reference' },
      isActive: { label: 'hr:field_active', widget: 'checkbox' },
    },
    load: async (db, docId) => {
      const [node] = await db.select().from(hrCostCenterNode).where(eq(hrCostCenterNode.id, docId)).limit(1);
      const [version] = await db
        .select()
        .from(hrCostCenterVersion)
        .where(and(eq(hrCostCenterVersion.nodeId, docId), isNull(hrCostCenterVersion.validTo)))
        .limit(1);
      return { ...node, ...(version ?? {}) };
    },
    save: async (tx, id, data) => {
      const { code, parentNodeId, ...versionData } = data;
      await ensureNodeRow(tx, hrCostCenterNode, id, definedOnly({ code }));

      const audit = { performedByUserId: SYSTEM_USER_ID };
      const newParentNodeId = (parentNodeId as string | null | undefined) ?? null;

      const [existing] = await tx
        .select({ parentNodeId: hrCostCenterVersion.parentNodeId })
        .from(hrCostCenterVersion)
        .where(and(eq(hrCostCenterVersion.nodeId, id), isNull(hrCostCenterVersion.validTo)))
        .limit(1);

      if (!existing) {
        await tx.insert(hrCostCenterVersion).values({
          nodeId: id,
          parentNodeId: newParentNodeId,
          name: versionData.name as string,
          legalEntityNodeId: versionData.legalEntityNodeId as string | null,
          isActive: (versionData.isActive as boolean) ?? true,
          validFrom: today(),
          createdByUserId: audit.performedByUserId,
          metadata: (versionData as { metadata?: Record<string, unknown> }).metadata ?? {},
        });
        return;
      }

      if (parentNodeId !== undefined && existing.parentNodeId !== newParentNodeId) {
        await hrStructureService.reparentCostCenter(id, newParentNodeId, CARD_CORRECTION, audit, { db: tx });
      }

      await hrStructureService.updateCostCenterAttributes(
        id,
        {
          name: versionData.name as string | undefined,
          legalEntityNodeId: versionData.legalEntityNodeId as string | null | undefined,
          metadata: (versionData as { metadata?: Record<string, unknown> }).metadata,
        },
        CARD_CORRECTION,
        audit,
        { db: tx },
      );
    },
  });

  // Node+Version через generic-путь, два расширения — см. комментарий в department.ts.
  docs.lists.extend('cost-center', {
    module: 'hr',
    key: 'node',
    schema: hrCostCenterNode,
    foreignKey: 'id',
    fields: {
      code: { label: 'hr:field_code', type: 'text', size: 120 },
    },
  });

  docs.lists.extend('cost-center', {
    module: 'hr',
    schema: hrCostCenterVersion,
    foreignKey: 'nodeId',
    joinType: 'inner',
    joinOn: t => isNull(t.validTo),
    fields: {
      name: { label: 'hr:field_name', type: 'text', size: 220 },
      isActive: { label: 'hr:field_active', type: 'checkbox', size: 80 },
    },
  });
}
