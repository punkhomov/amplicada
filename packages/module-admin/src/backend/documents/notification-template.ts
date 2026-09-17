import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { AdminDocuments } from '../../contracts/notification-template.js';
import { adminNotificationTemplate } from '../schemas/index.js';

/**
 * Шаблон уведомления как документ: CRUD, список с фильтрами и аудит достаются от Document System.
 * Контент редактируется компонентом `notification-template-editor` (body/html + preview), остальные
 * поля — обычные виджеты. Отправка — toolbar-действие, см. widgets/send-notification-template.
 */
export function registerNotificationTemplateDocuments(docs: DocumentRegistry): void {
  docs.register(AdminDocuments.NOTIFICATION_TEMPLATE, {
    module: 'admin',
    label: 'admin:template_label',
    creatable: true,
    deletable: true,
  });

  docs.objects.extend(AdminDocuments.NOTIFICATION_TEMPLATE, {
    module: 'admin',
    layout: {
      [DocumentPages.DEFAULT]: {
        [DocumentGroups.DEFAULT]: {
          rows: [
            [{ field: 'name' }, { field: 'locale' }],
            [{ field: 'subject', span: 2 }],
            [{ component: 'notification-template-editor', span: 2 }],
          ],
        },
      },
    },
    fields: {
      name: { label: 'admin:template_field_name', widget: 'text', required: true },
      subject: { label: 'admin:template_field_subject', widget: 'text', required: true },
      locale: {
        label: 'admin:template_field_locale',
        widget: 'select',
        helpText: 'admin:template_field_locale_help',
        options: [
          { label: 'admin:template_locale_ru', value: 'ru' },
          { label: 'admin:template_locale_en', value: 'en' },
        ],
      },
      body: { label: 'admin:template_field_body', widget: 'text', required: true },
      html: { label: 'admin:template_field_html', widget: 'text', helpText: 'admin:template_field_html_help' },
    },
    schema: adminNotificationTemplate,
    idColumn: 'id',
  });

  docs.lists.extend(AdminDocuments.NOTIFICATION_TEMPLATE, {
    module: 'admin',
    schema: adminNotificationTemplate,
    foreignKey: 'id',
    fields: {
      name: { label: 'admin:template_field_name', type: 'text', size: 240 },
      subject: { label: 'admin:template_field_subject', type: 'text', size: 320 },
      locale: { label: 'admin:template_field_locale', type: 'text', size: 100 },
      updatedAt: { label: 'admin:template_field_updated', type: 'datetime', size: 180 },
    },
  });
}
