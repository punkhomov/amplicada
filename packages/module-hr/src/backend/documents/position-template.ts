import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { hrPositionTemplate } from '../schemas/index.js';
import { HR_STRUCTURE_SECTION } from './constants.js';

export function registerPositionTemplateDoc(docs: DocumentRegistry): void {
  docs.register('position-template', {
    module: 'hr',
    label: 'hr:position_template_label',
    creatable: true,
    deletable: false,
    section: HR_STRUCTURE_SECTION,
  });

  docs.objects.extend('position-template', {
    module: 'hr',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    schema: hrPositionTemplate,
    idColumn: 'id',
    fields: {
      code: { label: 'hr:field_code', widget: 'text', required: true },
      name: { label: 'hr:field_name', widget: 'text', required: true },
      familyId: { label: 'hr:field_family', widget: 'reference' },
      category: { label: 'hr:field_category', widget: 'select' },
      description: { label: 'hr:field_description', widget: 'text' },
      validFrom: { label: 'hr:field_valid_from', widget: 'date', required: true },
      validTo: { label: 'hr:field_valid_to', widget: 'date' },
      isActive: { label: 'hr:field_active', widget: 'checkbox' },
    },
  });

  docs.lists.extend('position-template', {
    module: 'hr',
    schema: hrPositionTemplate,
    foreignKey: 'id',
    fields: {
      code: { label: 'hr:field_code', type: 'text', size: 120 },
      name: { label: 'hr:field_name', type: 'text', size: 240 },
      category: { label: 'hr:field_category', type: 'select', size: 100 },
      isActive: { label: 'hr:field_active', type: 'checkbox', size: 80 },
    },
  });
}
