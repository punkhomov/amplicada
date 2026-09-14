import { identityUser } from '@amplicada/platform-core/backend';
import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { eq } from 'drizzle-orm';
import { LearningDocuments } from '../../contracts/index.js';
import { hrLearningAttempts, hrLearningCourses } from '../schemas/index.js';

/**
 * Read-only просмотр попыток прохождения в админке. Попытки заводит плеер, не админ.
 */
export function registerAttemptDocuments(docs: DocumentRegistry): void {
  docs.register(LearningDocuments.ATTEMPT, {
    module: 'hr-learning',
    label: 'hr-learning:attempt_label',
    creatable: false,
    deletable: true,
  });

  docs.objects.extend(LearningDocuments.ATTEMPT, {
    module: 'hr-learning',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      userLogin: { label: 'hr-learning:field_user', widget: 'text', readonly: true },
      courseTitle: { label: 'hr-learning:field_course', widget: 'text', readonly: true },
      completion: { label: 'hr-learning:field_completion', widget: 'text', readonly: true },
      success: { label: 'hr-learning:field_success', widget: 'text', readonly: true },
      score: { label: 'hr-learning:field_score', widget: 'text', readonly: true, helpText: 'hr-learning:field_score_help' },
      totalTimeSeconds: { label: 'hr-learning:field_total_time', widget: 'text', readonly: true },
      manualOverride: { label: 'hr-learning:field_manual_override', widget: 'checkbox', readonly: true },
      startedAt: { label: 'hr-learning:field_started', widget: 'datetime', readonly: true },
      completedAt: { label: 'hr-learning:field_completed', widget: 'datetime', readonly: true },
      cmi: { label: 'hr-learning:field_cmi', widget: 'text', readonly: true, helpText: 'hr-learning:field_cmi_help' },
    },
    // Намеренно без `schema`: saveExtensionData пропускает сохранение целиком, если нет ни `save`,
    // ни `schema`. Это гарантия, что попытку не отредактировать прямым PUT в обход readonly в UI.
    load: async (db, docId) => {
      const [row] = await db
        .select({
          attempt: hrLearningAttempts,
          courseTitle: hrLearningCourses.title,
          userLogin: identityUser.login,
        })
        .from(hrLearningAttempts)
        .innerJoin(hrLearningCourses, eq(hrLearningCourses.id, hrLearningAttempts.courseId))
        .innerJoin(identityUser, eq(identityUser.id, hrLearningAttempts.userId))
        .where(eq(hrLearningAttempts.id, docId))
        .limit(1);
      if (!row) return {};
      return {
        userLogin: row.userLogin,
        courseTitle: row.courseTitle,
        completion: row.attempt.completion,
        success: row.attempt.success ?? '',
        score: row.attempt.score ?? '',
        totalTimeSeconds: String(row.attempt.totalTimeSeconds),
        manualOverride: row.attempt.manualOverride,
        startedAt: row.attempt.startedAt,
        completedAt: row.attempt.completedAt,
        cmi: JSON.stringify(row.attempt.cmi, null, 2),
      };
    },
    // Единственная запись, которую тип разрешает (deletable: true). Своей таблицы у типа документа
    // нет, и без явного remove строка попытки пережила бы удаление документа, а document_index не
    // удалился бы вовсе — на него ссылается FK.
    remove: async (tx, docId) => {
      await tx.delete(hrLearningAttempts).where(eq(hrLearningAttempts.id, docId));
    },
  });

  // В списке остаются UUID пользователя и курса: колонки читаются прямо из таблицы, а `reference`
  // в проекте не реализован. Имена видны на карточке (load выше). Известное ограничение v1.
  docs.lists.extend(LearningDocuments.ATTEMPT, {
    module: 'hr-learning',
    schema: hrLearningAttempts,
    foreignKey: 'id',
    fields: {
      userId: { label: 'hr-learning:field_user_id', type: 'text', size: 280 },
      courseId: { label: 'hr-learning:field_course_id', type: 'text', size: 280 },
      completion: { label: 'hr-learning:field_completion', type: 'text', size: 140 },
      success: { label: 'hr-learning:field_success', type: 'text', size: 120 },
      score: { label: 'hr-learning:field_score', type: 'text', size: 100 },
      startedAt: { label: 'hr-learning:field_started', type: 'datetime', size: 180 },
      completedAt: { label: 'hr-learning:field_completed', type: 'datetime', size: 180 },
    },
  });
}
