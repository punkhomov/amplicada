import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { hrPositionGrade } from '../schemas/index.js';
import { HR_STRUCTURE_SECTION } from './constants.js';

export function registerPositionGradeDoc(docs: DocumentRegistry): void {
  docs.register('position-grade', {
    module: 'hr',
    label: 'hr:position_grade_label',
    creatable: true,
    deletable: false,
    section: HR_STRUCTURE_SECTION,
  });

  docs.objects.extend('position-grade', {
    module: 'hr',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    schema: hrPositionGrade,
    idColumn: 'id',
    fields: {
      code: { label: 'hr:field_code', widget: 'text', required: true },
      name: { label: 'hr:field_name', widget: 'text', required: true },
      familyId: { label: 'hr:field_family', widget: 'reference', required: true },
      orderIndex: { label: 'hr:field_order', widget: 'number', required: true },
      minSalary: { label: 'hr:field_min_salary', widget: 'number' },
      maxSalary: { label: 'hr:field_max_salary', widget: 'number' },
      validFrom: { label: 'hr:field_valid_from', widget: 'date', required: true },
      validTo: { label: 'hr:field_valid_to', widget: 'date' },
      isActive: { label: 'hr:field_active', widget: 'checkbox' },
    },
  });

  docs.lists.extend('position-grade', {
    module: 'hr',
    schema: hrPositionGrade,
    foreignKey: 'id',
    fields: {
      code: { label: 'hr:field_code', type: 'text', size: 80 },
      name: { label: 'hr:field_name', type: 'text', size: 200 },
      familyId: { label: 'hr:field_family', type: 'text', size: 120 },
      orderIndex: { label: 'hr:field_order', type: 'number', size: 60 },
      isActive: { label: 'hr:field_active', type: 'checkbox', size: 80 },
    },
  });
}
