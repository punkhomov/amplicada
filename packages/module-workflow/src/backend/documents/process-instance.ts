import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { eq } from 'drizzle-orm';
import { WorkflowDocuments, WorkflowPages } from '../../contracts/documents.js';
import { processInstances } from '../schemas/index.js';

export function registerProcessInstanceDoc(docs: DocumentRegistry): void {
  docs.register(WorkflowDocuments.WORKFLOW_PROCESS, {
    module: 'workflow',
    label: 'workflow:process_label',
    creatable: false,
    deletable: false,
  });

  docs.objects.registerPage(WorkflowPages.PROCESS_TIMELINE, {
    document: WorkflowDocuments.WORKFLOW_PROCESS,
    label: 'workflow:page_timeline',
    icon: 'history',
    linkTemplate: '/admin/workflows/processes/{id}',
  });

  docs.objects.extend(WorkflowDocuments.WORKFLOW_PROCESS, {
    module: 'workflow',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      workflowCode: { label: 'workflow:field_process', widget: 'text', readonly: true },
      currentState: { label: 'workflow:field_current_state', widget: 'text', readonly: true },
      createdAt: { label: 'workflow:field_created_fem', widget: 'datetime', readonly: true },
      completedAt: { label: 'workflow:field_completed', widget: 'datetime', readonly: true },
    },
    // Только `load`, без `schema`: карточка процесса read-only, а расширение без таблицы и без
    // `save` рантайм при записи пропускает — гарантия сильнее, чем `readonly` в UI.
    load: async (db, docId) => {
      const [row] = await db.select().from(processInstances).where(eq(processInstances.id, docId)).limit(1);
      return row ?? {};
    },
  });

  docs.lists.extend(WorkflowDocuments.WORKFLOW_PROCESS, {
    module: 'workflow',
    schema: processInstances,
    foreignKey: 'id',
    fields: {
      workflowCode: { label: 'workflow:field_process', type: 'text', size: 180 },
      currentState: { label: 'workflow:field_stage', type: 'text', size: 160 },
      createdAt: { label: 'workflow:field_created_fem', type: 'datetime', size: 180 },
      completedAt: { label: 'workflow:field_completed', type: 'datetime', size: 180 },
    },
  });
}
