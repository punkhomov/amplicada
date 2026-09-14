import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { hrLegalEntityNode, hrLegalEntityVersion } from '../schemas/index.js';
import type { HrStructureService } from '../services/hr-structure-service.js';
import { definedOnly } from '../services/version-mode.js';
import { CARD_CORRECTION, HR_STRUCTURE_SECTION, SYSTEM_USER_ID } from './constants.js';
import { ensureNodeRow } from './node-row.js';

export function registerLegalEntityDoc(docs: DocumentRegistry, hrStructureService: HrStructureService): void {
  docs.register('legal-entity', {
    module: 'hr',
    label: 'hr:legal_entity_label',
    creatable: true,
    deletable: false,
    section: HR_STRUCTURE_SECTION,
  });

  docs.objects.extend('legal-entity', {
    module: 'hr',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      code: { label: 'hr:field_code', widget: 'text', required: true },
      shortName: { label: 'hr:field_short_name', widget: 'text', required: true },
      fullName: { label: 'hr:legal_entity_field_full_name', widget: 'text' },
      inn: { label: 'hr:field_inn', widget: 'text' },
      kpp: { label: 'hr:field_kpp', widget: 'text' },
    },
    load: async (db, docId) => {
      const [node] = await db.select().from(hrLegalEntityNode).where(eq(hrLegalEntityNode.id, docId)).limit(1);
      const [version] = await db
        .select()
        .from(hrLegalEntityVersion)
        .where(and(eq(hrLegalEntityVersion.nodeId, docId), isNull(hrLegalEntityVersion.validTo)))
        .limit(1);
      return { ...node, ...(version ?? {}) };
    },
    save: async (tx, id, data) => {
      const { code, ...versionData } = data;
      await ensureNodeRow(tx, hrLegalEntityNode, id, definedOnly({ code }));
      await hrStructureService.updateLegalEntityAttributes(
        id,
        {
          shortName: versionData.shortName as string | undefined,
          fullName: versionData.fullName as string | null | undefined,
          inn: versionData.inn as string | null | undefined,
          kpp: versionData.kpp as string | null | undefined,
        },
        CARD_CORRECTION,
        { performedByUserId: SYSTEM_USER_ID },
        { db: tx },
      );
    },
  });

  // Node+Version через generic-путь, два расширения — см. комментарий в department.ts.
  docs.lists.extend('legal-entity', {
    module: 'hr',
    key: 'node',
    schema: hrLegalEntityNode,
    foreignKey: 'id',
    fields: {
      code: { label: 'hr:field_code', type: 'text', size: 120 },
    },
  });

  docs.lists.extend('legal-entity', {
    module: 'hr',
    schema: hrLegalEntityVersion,
    foreignKey: 'nodeId',
    joinType: 'inner',
    joinOn: t => isNull(t.validTo),
    fields: {
      shortName: { label: 'hr:field_short_name', type: 'text', size: 220 },
      inn: { label: 'hr:field_inn', type: 'text', size: 140 },
    },
  });
}
