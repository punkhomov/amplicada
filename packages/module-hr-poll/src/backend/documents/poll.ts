import { DocumentRuntimeError } from '@amplicada/platform-core/backend';
import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { eq } from 'drizzle-orm';
import { HrPollDocuments, HrPollGroups, type PollQuestion } from '../../contracts/index.js';
import { hrPollPolls } from '../schemas/index.js';

export function registerPollDocuments(docs: DocumentRegistry): void {
  docs.register(HrPollDocuments.POLL, {
    module: 'hr-poll',
    label: 'hr-poll:poll_label',
    creatable: true,
    deletable: true,
    softDelete: true,
  });

  docs.objects.registerGroup(HrPollGroups.QUESTIONS, {
    document: HrPollDocuments.POLL,
    page: DocumentPages.DEFAULT,
    label: 'hr-poll:group_questions',
    order: 1,
  });

  docs.objects.extend(HrPollDocuments.POLL, {
    module: 'hr-poll',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      code: { label: 'hr-poll:field_code', widget: 'text', required: true, helpText: 'hr-poll:field_code_help' },
      title: { label: 'hr-poll:field_title', widget: 'text', required: true },
      description: { label: 'hr-poll:field_description', widget: 'text' },
      status: {
        label: 'hr-poll:field_status',
        widget: 'text',
        readonly: true,
        helpText: 'hr-poll:field_status_help',
      },
      active: { label: 'hr-poll:field_active', widget: 'checkbox', default: true, helpText: 'hr-poll:field_active_help' },
      startsAt: { label: 'hr-poll:field_starts_at', widget: 'datetime', helpText: 'hr-poll:help_empty_unlimited' },
      endsAt: { label: 'hr-poll:field_ends_at', widget: 'datetime', helpText: 'hr-poll:help_empty_unlimited' },
      allowRepeat: { label: 'hr-poll:field_allow_repeat', widget: 'checkbox' },
      anonymous: { label: 'hr-poll:field_anonymous', widget: 'checkbox', helpText: 'hr-poll:field_anonymous_help' },
    },
    schema: hrPollPolls,
    idColumn: 'id',
    save: async (tx, id, data) => {
      const { code, title, description, active, startsAt, endsAt, allowRepeat, anonymous } = data as {
        code?: string;
        title?: string;
        description?: string | null;
        active?: boolean;
        startsAt?: Date | null;
        endsAt?: Date | null;
        allowRepeat?: boolean;
        anonymous?: boolean;
      };
      const values: Record<string, unknown> = {};
      if (code !== undefined) values.code = code;
      if (title !== undefined) values.title = title;
      if (description !== undefined) values.description = description || null;
      if (active !== undefined) values.active = active;
      if (startsAt !== undefined) values.startsAt = startsAt;
      if (endsAt !== undefined) values.endsAt = endsAt;
      if (allowRepeat !== undefined) values.allowRepeat = allowRepeat;
      if (anonymous !== undefined) values.anonymous = anonymous;
      if (!Object.keys(values).length) return;
      await tx.update(hrPollPolls).set(values).where(eq(hrPollPolls.id, id));
    },
  });

  docs.objects.extend(HrPollDocuments.POLL, {
    module: 'hr-poll-questions',
    layout: { [DocumentPages.DEFAULT]: { [HrPollGroups.QUESTIONS]: { rows: [[{ component: 'poll-questions-editor' }]] } } },
    load: async (db, docId) => {
      const [row] = await db
        .select({ questions: hrPollPolls.questions, status: hrPollPolls.status })
        .from(hrPollPolls)
        .where(eq(hrPollPolls.id, docId))
        .limit(1);
      return { questions: row?.questions ?? [], status: row?.status ?? 'draft' };
    },
    save: async (tx, id, data) => {
      const { questions } = data as { questions?: PollQuestion[] };
      if (questions === undefined) return;

      // Схема вопросов иммутабельна с момента публикации — независимо от количества уже
      // собранных ответов (см. ref/plans/2026-07-26-hr-poll.md). Ре-сохранение того же массива
      // (например, при сохранении соседней группы полей той же карточки) не считается правкой.
      const [row] = await tx
        .select({ status: hrPollPolls.status, questions: hrPollPolls.questions })
        .from(hrPollPolls)
        .where(eq(hrPollPolls.id, id))
        .limit(1);
      if (row?.status === 'published' && JSON.stringify(row.questions) !== JSON.stringify(questions)) {
        throw new DocumentRuntimeError(400, 'Нельзя менять вопросы опубликованного опроса. Чтобы изменить схему — создайте новый опрос.');
      }
      await tx.update(hrPollPolls).set({ questions }).where(eq(hrPollPolls.id, id));
    },
  });

  docs.lists.extend(HrPollDocuments.POLL, {
    module: 'hr-poll',
    schema: hrPollPolls,
    foreignKey: 'id',
    fields: {
      code: { label: 'hr-poll:field_code', type: 'text', size: 180 },
      title: { label: 'hr-poll:field_title', type: 'text', size: 260 },
      status: { label: 'hr-poll:field_status', type: 'text', size: 120 },
      active: { label: 'hr-poll:field_active', type: 'checkbox', size: 100 },
      createdAt: { label: 'hr-poll:field_created', type: 'datetime', size: 180 },
    },
  });
}
