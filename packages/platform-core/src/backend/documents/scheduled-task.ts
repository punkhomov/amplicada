import { eq } from 'drizzle-orm';
import type { DocumentRegistry } from '../../contracts/documents.js';
import { DashboardTopics, DocumentGroups, DocumentPages, Documents } from '../../contracts/documents.js';
import { documentIndex, type NewScheduledTaskRow, scheduledTasks } from '../schemas/index.js';
import { DocumentRuntimeError } from '../services/document-runtime.js';
import { validateCronSchedule } from '../services/task-scheduler.js';

export function registerScheduledTaskDoc(docs: DocumentRegistry): void {
  docs.register(Documents.SCHEDULED_TASK, {
    module: 'core',
    label: 'core:scheduled_task_label',
    creatable: false,
    deletable: false,
    topic: DashboardTopics.SYSTEM,
  });

  docs.objects.registerPage(DocumentPages.SCHEDULED_TASK_RUNS, {
    document: Documents.SCHEDULED_TASK,
    label: 'core:scheduled_task_runs_page',
    linkTemplate: '/admin/scheduled-task/{id}/runs',
  });

  docs.objects.extend(Documents.SCHEDULED_TASK, {
    module: 'core',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: { rows: [[{ component: 'scheduled-task-fields' }]] } } },
    // Таблица объявлена, хотя чтение/запись ручные: по ней reconcileFixtures находит natural key
    // `code` (задачи из кода — фикстуры этого типа) и рантайм удаляет строку вместе с документом.
    schema: scheduledTasks,
    idColumn: 'id',
    fields: {
      id: { label: 'core:field_id', widget: 'text', readonly: true },
      code: { label: 'core:scheduled_task_field_code', widget: 'text', readonly: true },
      description: { label: 'core:field_description', widget: 'text', readonly: true },
      timeout: {
        label: 'core:scheduled_task_field_timeout',
        widget: 'number',
        helpText: 'core:scheduled_task_field_timeout_help',
      },
      alertOnFailure: { label: 'core:scheduled_task_field_alert', widget: 'checkbox' },
      schedule: {
        label: 'core:scheduled_task_field_schedule',
        widget: 'text',
        placeholder: '* * * * *',
        helpText: 'core:scheduled_task_field_schedule_help',
      },
      active: { label: 'core:scheduled_task_field_active', widget: 'checkbox' },
      stale: { label: 'core:scheduled_task_field_stale', widget: 'checkbox', readonly: true },
    },
    load: async (db, docId) => {
      // `stale` переехал в document_index (этап 2 плана 06) — отсюда джойн.
      const [row] = await db
        .select({ task: scheduledTasks, stale: documentIndex.stale })
        .from(scheduledTasks)
        .innerJoin(documentIndex, eq(documentIndex.id, scheduledTasks.id))
        .where(eq(scheduledTasks.id, docId))
        .limit(1);
      return row ? { ...row.task, stale: row.stale } : {};
    },
    save: async (tx, id, data) => {
      const { schedule, active, timeout, alertOnFailure } = data as {
        schedule?: string | null;
        active?: boolean;
        timeout?: number;
        alertOnFailure?: boolean;
      };
      const updates: Partial<NewScheduledTaskRow> = { updatedAt: new Date() };
      if (schedule !== undefined) {
        if (schedule) {
          const error = validateCronSchedule(schedule);
          if (error) throw new DocumentRuntimeError(400, error);
        }
        updates.schedule = schedule || null;
      }
      if (active !== undefined) updates.active = active;
      if (timeout !== undefined) {
        if (!Number.isInteger(timeout) || timeout < 0) {
          throw new DocumentRuntimeError(400, 'Таймаут должен быть неотрицательным целым числом (0 — без ограничения)');
        }
        updates.timeout = timeout;
      }
      if (alertOnFailure !== undefined) updates.alertOnFailure = alertOnFailure;
      await tx.update(scheduledTasks).set(updates).where(eq(scheduledTasks.id, id));
    },
  });

  docs.lists.extend(Documents.SCHEDULED_TASK, {
    module: 'core',
    schema: scheduledTasks,
    foreignKey: 'id',
    fields: {
      id: { label: 'core:field_id', type: 'text', size: 220 },
      code: { label: 'core:scheduled_task_field_code', type: 'text', size: 220 },
      description: { label: 'core:field_description', type: 'text', size: 320 },
      schedule: { label: 'core:scheduled_task_list_field_schedule', type: 'text', size: 140 },
      active: { label: 'core:scheduled_task_field_active', type: 'checkbox', size: 80 },
      stale: { label: 'core:scheduled_task_list_field_stale', type: 'checkbox', size: 90 },
    },
  });
}
