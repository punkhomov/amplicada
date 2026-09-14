import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { hrVirtualTeamNode, hrVirtualTeamVersion } from '../schemas/index.js';
import type { HrStructureService } from '../services/hr-structure-service.js';
import { definedOnly } from '../services/version-mode.js';
import { CARD_CORRECTION, HR_STRUCTURE_SECTION, SYSTEM_USER_ID } from './constants.js';
import { ensureNodeRow } from './node-row.js';

export function registerVirtualTeamDoc(docs: DocumentRegistry, hrStructureService: HrStructureService): void {
  docs.register('virtual-team', {
    module: 'hr',
    label: 'hr:virtual_team_label',
    creatable: true,
    deletable: false,
    section: HR_STRUCTURE_SECTION,
  });

  docs.objects.extend('virtual-team', {
    module: 'hr',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      code: { label: 'hr:field_code', widget: 'text', required: true },
      name: { label: 'hr:field_name', widget: 'text', required: true },
      type: { label: 'hr:field_type', widget: 'select' },
      leadUserId: { label: 'hr:field_head', widget: 'reference' },
      departmentNodeId: { label: 'hr:virtual_team_field_department', widget: 'reference' },
      projectStartDate: { label: 'hr:virtual_team_field_project_start', widget: 'date' },
      projectEndDate: { label: 'hr:virtual_team_field_project_end', widget: 'date' },
    },
    load: async (db, docId) => {
      const [node] = await db.select().from(hrVirtualTeamNode).where(eq(hrVirtualTeamNode.id, docId)).limit(1);
      const [version] = await db
        .select()
        .from(hrVirtualTeamVersion)
        .where(and(eq(hrVirtualTeamVersion.nodeId, docId), isNull(hrVirtualTeamVersion.validTo)))
        .limit(1);
      return { ...node, ...(version ?? {}) };
    },
    save: async (tx, id, data) => {
      const { code, projectStartDate, projectEndDate, ...versionData } = data;
      // Даты проекта тоже живут на узле, но их пишет сервис — здесь только гарантируем строку.
      await ensureNodeRow(tx, hrVirtualTeamNode, id, definedOnly({ code }));
      if (projectStartDate !== undefined || projectEndDate !== undefined) {
        await hrStructureService.updateVirtualTeamProjectDates(
          id,
          {
            projectStartDate: projectStartDate as string | null | undefined,
            projectEndDate: projectEndDate as string | null | undefined,
          },
          { db: tx },
        );
      }

      await hrStructureService.updateVirtualTeamAttributes(
        id,
        {
          name: versionData.name as string | undefined,
          type: versionData.type as string | null | undefined,
          leadUserId: versionData.leadUserId as string | null | undefined,
          departmentNodeId: versionData.departmentNodeId as string | null | undefined,
          metadata: (versionData as { metadata?: Record<string, unknown> }).metadata,
        },
        CARD_CORRECTION,
        { performedByUserId: SYSTEM_USER_ID },
        { db: tx },
      );
    },
  });

  // Node+Version через generic-путь, два расширения — см. комментарий в department.ts.
  docs.lists.extend('virtual-team', {
    module: 'hr',
    key: 'node',
    schema: hrVirtualTeamNode,
    foreignKey: 'id',
    fields: {
      code: { label: 'hr:field_code', type: 'text', size: 120 },
    },
  });

  docs.lists.extend('virtual-team', {
    module: 'hr',
    schema: hrVirtualTeamVersion,
    foreignKey: 'nodeId',
    joinType: 'inner',
    joinOn: t => isNull(t.validTo),
    fields: {
      name: { label: 'hr:field_name', type: 'text', size: 220 },
      type: { label: 'hr:field_type', type: 'select', size: 120 },
      leadUserId: { label: 'hr:field_head', type: 'text', size: 160 },
      isActive: { label: 'hr:field_active', type: 'checkbox', size: 80 },
    },
  });
}
