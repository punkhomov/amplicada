import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { WorkflowDocuments, WorkflowPages } from '../../contracts/documents.js';
import { workflows } from '../schemas/index.js';

export function registerWorkflowDoc(docs: DocumentRegistry): void {
  docs.register(WorkflowDocuments.WORKFLOW, {
    module: 'workflow',
    label: 'workflow:workflow_label',
    creatable: true,
    deletable: false,
  });

  docs.objects.registerPage(WorkflowPages.WORKFLOW_EDITOR, {
    document: WorkflowDocuments.WORKFLOW,
    label: 'workflow:page_editor',
    icon: 'workflow',
    linkTemplate: '/admin/workflows/{id}/editor',
  });

  docs.objects.extend(WorkflowDocuments.WORKFLOW, {
    module: 'workflow',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      code: { label: 'workflow:field_code', widget: 'text', required: true, helpText: 'workflow:field_code_help' },
      name: { label: 'workflow:field_name', widget: 'text', required: true },
      description: { label: 'workflow:field_description', widget: 'text' },
      isActive: { label: 'workflow:field_active', widget: 'checkbox', default: true },
    },
    schema: workflows,
    idColumn: 'id',
  });

  docs.lists.extend(WorkflowDocuments.WORKFLOW, {
    module: 'workflow',
    schema: workflows,
    foreignKey: 'id',
    fields: {
      code: { label: 'workflow:field_code', type: 'text', size: 160 },
      name: { label: 'workflow:field_name', type: 'text', size: 240 },
      isActive: { label: 'workflow:field_active', type: 'checkbox', size: 90 },
      createdAt: { label: 'workflow:field_created', type: 'datetime', size: 180 },
    },
  });
}
