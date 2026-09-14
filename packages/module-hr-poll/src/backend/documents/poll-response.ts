import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { eq } from 'drizzle-orm';
import { HrPollDocuments } from '../../contracts/index.js';
import { hrPollResponses } from '../schemas/index.js';

/**
 * Read-only просмотр ответов в админке (кто и когда ответил). Без агрегации/лейблов вопросов —
 * это отдельная задача (см. план module-hr-poll, "вне scope v1").
 */
export function registerPollResponseDocuments(docs: DocumentRegistry): void {
  docs.register(HrPollDocuments.RESPONSE, {
    module: 'hr-poll',
    label: 'hr-poll:response_label',
    creatable: false,
    deletable: true,
  });

  docs.objects.extend(HrPollDocuments.RESPONSE, {
    module: 'hr-poll-response',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      pollId: { label: 'hr-poll:field_poll_id', widget: 'text', readonly: true },
      userId: { label: 'hr-poll:field_user_id', widget: 'text', readonly: true },
      answers: { label: 'hr-poll:field_answers', widget: 'text', readonly: true },
      createdAt: { label: 'hr-poll:field_submitted_at', widget: 'datetime', readonly: true },
    },
    // Намеренно без `schema` на этом extension: saveExtensionData пропускает сохранение
    // целиком, если нет ни ext.save, ни ext.schema — гарантия, что ответы нередактируемы,
    // даже если кто-то обойдёт readonly в UI и пришлёт PUT напрямую.
    load: async (db, docId) => {
      const [row] = await db.select().from(hrPollResponses).where(eq(hrPollResponses.id, docId)).limit(1);
      if (!row) return {};
      return { ...row, answers: JSON.stringify(row.answers, null, 2) };
    },
    // Удаление — единственная запись, которую тип разрешает (deletable: true). Своей таблицы у типа
    // документа больше нет, и без явного `remove` строка ответа пережила бы удаление документа,
    // а `document_index` не удалился бы вовсе — она ссылается на него внешним ключом.
    remove: async (tx, docId) => {
      await tx.delete(hrPollResponses).where(eq(hrPollResponses.id, docId));
    },
  });

  docs.lists.extend(HrPollDocuments.RESPONSE, {
    module: 'hr-poll-response',
    schema: hrPollResponses,
    foreignKey: 'id',
    fields: {
      pollId: { label: 'hr-poll:field_poll_id', type: 'text', size: 280 },
      userId: { label: 'hr-poll:field_user_id', type: 'text', size: 280 },
      createdAt: { label: 'hr-poll:field_submitted_at', type: 'datetime', size: 180 },
    },
  });
}
