import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { hrTag } from '../schemas/index.js';
import { HR_STRUCTURE_SECTION } from './constants.js';

export function registerTagDoc(docs: DocumentRegistry): void {
  docs.register('tag', {
    module: 'hr',
    label: 'hr:tag_label',
    creatable: true,
    deletable: true,
    section: HR_STRUCTURE_SECTION,
  });

  docs.objects.extend('tag', {
    module: 'hr',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    schema: hrTag,
    idColumn: 'id',
    fields: {
      name: { label: 'hr:field_name', widget: 'text', required: true },
      scope: {
        label: 'hr:field_scope',
        widget: 'select',
        required: true,
        options: [
          { label: 'hr:tag_scope_department', value: 'department' },
          { label: 'hr:tag_scope_user', value: 'user' },
          { label: 'hr:tag_scope_staff_unit', value: 'staff_unit' },
        ],
      },
    },
  });

  docs.lists.extend('tag', {
    module: 'hr',
    schema: hrTag,
    foreignKey: 'id',
    fields: {
      name: { label: 'hr:field_name', type: 'text', size: 200 },
      scope: { label: 'hr:field_scope', type: 'select', size: 120 },
    },
  });
}
