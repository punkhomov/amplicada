import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { hrWorkSchedule } from '../schemas/index.js';
import { HR_STRUCTURE_SECTION } from './constants.js';

export function registerWorkScheduleDoc(docs: DocumentRegistry): void {
  docs.register('work-schedule', {
    module: 'hr',
    label: 'hr:work_schedule_label',
    creatable: true,
    deletable: false,
    section: HR_STRUCTURE_SECTION,
  });

  docs.objects.extend('work-schedule', {
    module: 'hr',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    schema: hrWorkSchedule,
    idColumn: 'id',
    fields: {
      code: { label: 'hr:field_code', widget: 'text', required: true },
      name: { label: 'hr:field_name', widget: 'text', required: true },
      hoursPerWeek: { label: 'hr:work_schedule_field_hours', widget: 'number' },
      description: { label: 'hr:field_description', widget: 'text' },
    },
  });

  docs.lists.extend('work-schedule', {
    module: 'hr',
    schema: hrWorkSchedule,
    foreignKey: 'id',
    fields: {
      code: { label: 'hr:field_code', type: 'text', size: 120 },
      name: { label: 'hr:field_name', type: 'text', size: 200 },
      hoursPerWeek: { label: 'hr:work_schedule_list_field_hours', type: 'number', size: 100 },
    },
  });
}
