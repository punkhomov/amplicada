import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { hrJobFamily } from '../schemas/index.js';
import { HR_STRUCTURE_SECTION } from './constants.js';

export function registerJobFamilyDoc(docs: DocumentRegistry): void {
  docs.register('job-family', {
    module: 'hr',
    label: 'hr:job_family_label',
    creatable: true,
    deletable: false,
    section: HR_STRUCTURE_SECTION,
  });

  docs.objects.extend('job-family', {
    module: 'hr',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    schema: hrJobFamily,
    idColumn: 'id',
    fields: {
      code: { label: 'hr:field_code', widget: 'text', required: true },
      name: { label: 'hr:field_name', widget: 'text', required: true },
      description: { label: 'hr:field_description', widget: 'text' },
      validFrom: { label: 'hr:field_valid_from', widget: 'date', required: true },
      validTo: { label: 'hr:field_valid_to', widget: 'date' },
      isActive: { label: 'hr:field_active', widget: 'checkbox' },
    },
  });

  docs.lists.extend('job-family', {
    module: 'hr',
    schema: hrJobFamily,
    foreignKey: 'id',
    fields: {
      code: { label: 'hr:field_code', type: 'text', size: 120 },
      name: { label: 'hr:field_name', type: 'text', size: 240 },
      isActive: { label: 'hr:field_active', type: 'checkbox', size: 80 },
    },
  });
}
