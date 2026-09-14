import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { hrRole } from '../schemas/index.js';
import { HR_STRUCTURE_SECTION } from './constants.js';

export function registerRoleDoc(docs: DocumentRegistry): void {
  docs.register('role', {
    module: 'hr',
    label: 'hr:role_label',
    creatable: true,
    deletable: false,
    section: HR_STRUCTURE_SECTION,
  });

  docs.objects.extend('role', {
    module: 'hr',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    schema: hrRole,
    idColumn: 'id',
    fields: {
      code: { label: 'hr:field_code', widget: 'text', required: true },
      name: { label: 'hr:field_name', widget: 'text', required: true },
      description: { label: 'hr:field_description', widget: 'text' },
    },
  });

  docs.lists.extend('role', {
    module: 'hr',
    schema: hrRole,
    foreignKey: 'id',
    fields: {
      code: { label: 'hr:field_code', type: 'text', size: 120 },
      name: { label: 'hr:field_name', type: 'text', size: 200 },
    },
  });
}
