import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { hrUserProfile } from '../schemas/index.js';

const HR_LIST_FIELDS = {
  code: { label: 'hr:user_field_employee_code', widget: 'text' },
  gender: { label: 'hr:user_field_gender', widget: 'select' },
  birthDate: { label: 'hr:user_field_birth_date', widget: 'date' },
  lastName: { label: 'hr:user_field_last_name', widget: 'text' },
  firstName: { label: 'hr:user_field_first_name', widget: 'text' },
  middleName: { label: 'hr:user_field_middle_name', widget: 'text' },
  hireDate: { label: 'hr:user_field_hire_date', widget: 'date' },
  positionStartDate: { label: 'hr:user_field_position_start_date', widget: 'date' },
  terminationDate: { label: 'hr:user_field_termination_date', widget: 'date' },
  isTerminated: { label: 'hr:user_field_is_terminated', widget: 'checkbox' },
  phone: { label: 'hr:user_field_phone', widget: 'text' },
  email: { label: 'hr:user_field_email', widget: 'text' },
} as const;

const HR_LIST_META = {
  code: { label: 'hr:user_field_employee_code', type: 'text', size: 120 },
  gender: { label: 'hr:user_field_gender', type: 'select', size: 80 },
  birthDate: { label: 'hr:user_field_birth_date', type: 'date', size: 130 },
  lastName: { label: 'hr:user_field_last_name', type: 'text', size: 160 },
  firstName: { label: 'hr:user_field_first_name', type: 'text', size: 140 },
  middleName: { label: 'hr:user_field_middle_name', type: 'text', size: 160 },
  hireDate: { label: 'hr:user_field_hire_date', type: 'date', size: 130 },
  positionStartDate: { label: 'hr:user_field_position_start_date', type: 'date', size: 200 },
  terminationDate: { label: 'hr:user_field_termination_date', type: 'date', size: 140 },
  isTerminated: { label: 'hr:user_field_is_terminated', type: 'checkbox', size: 80 },
  phone: { label: 'hr:user_field_phone', type: 'text', size: 140 },
  email: { label: 'hr:user_field_email', type: 'text', size: 180 },
} as const;

export function extendUserDoc(docs: DocumentRegistry): void {
  docs.objects.extend('user', {
    module: 'hr',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      ...HR_LIST_FIELDS,
      internalPhone: { label: 'hr:user_field_internal_phone', widget: 'text' },
      internalEmail: { label: 'hr:user_field_internal_email', widget: 'text' },
      residentialAddress: { label: 'hr:user_field_residential_address', widget: 'text' },
      registrationAddress: { label: 'hr:user_field_registration_address', widget: 'text' },
    },
    schema: hrUserProfile,
    idColumn: 'userId',
  });

  docs.lists.extend('user', {
    module: 'hr',
    fields: HR_LIST_META,
    schema: hrUserProfile,
    foreignKey: 'userId',
  });
}
