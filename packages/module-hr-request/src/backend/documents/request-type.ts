import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { eq } from 'drizzle-orm';
import { HrRequestDocuments, HrRequestGroups, type RequestFormField } from '../../contracts/index.js';
import { hrRequestTypes } from '../schemas/index.js';

export function registerRequestTypeDoc(docs: DocumentRegistry): void {
  registerRequestTypeDocuments(docs);
}

export function registerRequestTypeDocuments(docs: DocumentRegistry): void {
  docs.register(HrRequestDocuments.REQUEST_TYPE, {
    module: 'hr-requests',
    label: 'hr-requests:request_type_label',
    creatable: true,
    deletable: true,
    softDelete: true,
  });

  docs.objects.registerGroup(HrRequestGroups.TYPE_FORM, {
    document: HrRequestDocuments.REQUEST_TYPE,
    page: DocumentPages.DEFAULT,
    label: 'hr-requests:group_type_form',
    order: 1,
  });

  docs.objects.extend(HrRequestDocuments.REQUEST_TYPE, {
    module: 'hr-requests',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      code: {
        label: 'hr-requests:field_code',
        widget: 'text',
        required: true,
        helpText: 'hr-requests:field_code_help',
      },
      label: { label: 'hr-requests:field_label', widget: 'text', required: true },
      titleTemplate: {
        label: 'hr-requests:field_title_template',
        widget: 'text',
        placeholder: '{description} ({cost} ₽)',
        helpText: 'hr-requests:field_title_template_help',
      },
      portalEnabled: { label: 'hr-requests:field_portal_enabled', widget: 'checkbox', default: true },
    },
    schema: hrRequestTypes,
    idColumn: 'id',
    save: async (tx, id, data) => {
      const { code, label, titleTemplate, portalEnabled } = data as {
        code?: string;
        label?: string;
        titleTemplate?: string | null;
        portalEnabled?: boolean;
      };
      const values: Record<string, unknown> = {};
      if (code !== undefined) values.code = code;
      if (label !== undefined) values.label = label;
      if (titleTemplate !== undefined) values.titleTemplate = titleTemplate || null;
      if (portalEnabled !== undefined) values.portalEnabled = portalEnabled;
      if (!Object.keys(values).length) return;
      await tx.update(hrRequestTypes).set(values).where(eq(hrRequestTypes.id, id));
    },
  });

  docs.objects.extend(HrRequestDocuments.REQUEST_TYPE, {
    module: 'hr-requests-form',
    layout: { [DocumentPages.DEFAULT]: { [HrRequestGroups.TYPE_FORM]: { rows: [[{ component: 'hr-request-type-fields' }]] } } },
    load: async (db, docId) => {
      const [row] = await db.select().from(hrRequestTypes).where(eq(hrRequestTypes.id, docId)).limit(1);
      return { formFields: row?.formFields ?? [] };
    },
    save: async (tx, id, data) => {
      const { formFields } = data as { formFields?: RequestFormField[] };
      if (formFields === undefined) return;
      await tx.update(hrRequestTypes).set({ formFields }).where(eq(hrRequestTypes.id, id));
    },
  });

  docs.lists.extend(HrRequestDocuments.REQUEST_TYPE, {
    module: 'hr-requests',
    schema: hrRequestTypes,
    foreignKey: 'id',
    fields: {
      code: { label: 'hr-requests:field_code', type: 'text', size: 180 },
      label: { label: 'hr-requests:field_label', type: 'text', size: 260 },
      portalEnabled: { label: 'hr-requests:list_field_portal_enabled', type: 'checkbox', size: 100 },
      createdAt: { label: 'hr-requests:field_created', type: 'datetime', size: 180 },
    },
  });
}
