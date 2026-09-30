import { eq } from 'drizzle-orm';
import type { BackendStorageService } from '../../contracts/backend/storage.js';
import type { DocumentRegistry } from '../../contracts/documents.js';
import { DashboardTopics, DocumentGroups, DocumentPages, Documents } from '../../contracts/documents.js';
import { logger } from '../logger.js';
import { notificationTemplate } from '../schemas/index.js';

/**
 * Шаблон уведомления — документ-тип ядра (ADR-07): сборка без админки должна уметь слать по
 * code-шаблону, поэтому тип живёт в core, а `module-admin` — только UI над ним.
 * Контент редактируется компонентом `notification-template-editor`, отправитель и вложения —
 * его же поля; отправка — toolbar-действие админки.
 */
export function registerNotificationTemplateDoc(docs: DocumentRegistry, storage: BackendStorageService): void {
  docs.register(Documents.NOTIFICATION_TEMPLATE, {
    module: 'core',
    label: 'core:notification_template_label',
    topic: DashboardTopics.SYSTEM,
    // Code-шаблоны (fixtures) — источник истины в коде: правка и удаление вручную отклоняются.
    fixtureReadonly: true,
  });

  docs.objects.extend(Documents.NOTIFICATION_TEMPLATE, {
    module: 'core',
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
      name: { label: 'core:notification_template_field_name', widget: 'text', required: true },
      subject: { label: 'core:notification_template_field_subject', widget: 'text', required: true },
      locale: {
        label: 'core:notification_template_field_locale',
        widget: 'select',
        helpText: 'core:notification_template_field_locale_help',
        options: [
          { label: 'core:notification_template_locale_ru', value: 'ru' },
          { label: 'core:notification_template_locale_en', value: 'en' },
        ],
      },
      body: { label: 'core:notification_template_field_body', widget: 'text', required: true },
      html: { label: 'core:notification_template_field_html', widget: 'text' },
      // sender/attachments не выводятся layout'ом — ими управляет компонент редактора.
      sender: { label: 'core:notification_template_field_sender', widget: 'text' },
      attachments: { label: 'core:notification_template_field_attachments', widget: 'text' },
    },
    schema: notificationTemplate,
    idColumn: 'id',
    // Удаление документа шаблона: снять объекты вложений best-effort и удалить строку расширения.
    remove: async (tx, docId) => {
      const [row] = await tx
        .select({ attachments: notificationTemplate.attachments })
        .from(notificationTemplate)
        .where(eq(notificationTemplate.id, docId))
        .limit(1);
      for (const attachment of row?.attachments ?? []) {
        try {
          await storage.deleteObject(attachment.storageKey);
        } catch (err) {
          logger.warn({ err, key: attachment.storageKey }, 'Не удалось удалить вложение шаблона');
        }
      }
      await tx.delete(notificationTemplate).where(eq(notificationTemplate.id, docId));
    },
  });

  docs.lists.extend(Documents.NOTIFICATION_TEMPLATE, {
    module: 'core',
    schema: notificationTemplate,
    foreignKey: 'id',
    fields: {
      name: { label: 'core:notification_template_field_name', type: 'text', size: 240 },
      subject: { label: 'core:notification_template_field_subject', type: 'text', size: 320 },
      locale: { label: 'core:notification_template_field_locale', type: 'text', size: 100 },
      sender: { label: 'core:notification_template_field_sender', type: 'text', size: 140 },
      // Index-колонка: доступна списку через INDEX_STATE_COLUMNS.
      fixture: { label: 'core:notification_template_list_fixture', type: 'checkbox', size: 110 },
      updatedAt: { label: 'core:notification_template_field_updated', type: 'datetime', size: 180 },
    },
  });
}
