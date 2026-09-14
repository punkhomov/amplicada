import type {
  BackendAuthService,
  BackendDbService,
  BackendDocumentRuntime,
  BackendSetupContext,
  User,
} from '@amplicada/platform-core/contracts/backend';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { HrPollDocuments, type PollDetail, type PollListItem, type PollQuestion, type PollUserStatus } from '../contracts/index.js';
import { type HrPollPollRow, hrPollPolls, hrPollResponses } from './schemas/index.js';

function withinWindow(poll: HrPollPollRow, now: Date): boolean {
  if (!poll.active) return false;
  if (poll.startsAt && poll.startsAt > now) return false;
  if (poll.endsAt && poll.endsAt < now) return false;
  return true;
}

function computeStatus(poll: HrPollPollRow, hasResponse: boolean, now: Date): PollUserStatus {
  const open = withinWindow(poll, now);
  if (open && (!hasResponse || poll.allowRepeat)) return 'available';
  if (hasResponse) return 'answered';
  return 'closed';
}

export function createHrPollRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const db = context.services.resolve<BackendDbService>('db');
  const documentRuntime = context.services.resolve<BackendDocumentRuntime>('document-runtime');

  const currentUser = (request: FastifyRequest): User => {
    const authService = context.services.resolve<BackendAuthService>('auth-service');
    return authService.getCurrentUser(request) as User; // preHandler гарантировал аутентификацию
  };

  const loadPublishedPoll = async (id: string, reply: FastifyReply): Promise<HrPollPollRow | null> => {
    const [row] = await db.select().from(hrPollPolls).where(eq(hrPollPolls.id, id)).limit(1);
    if (!row || row.status !== 'published') {
      reply.code(404).send({ error: 'Опрос не найден' });
      return null;
    }
    return row;
  };

  fastify.get('/', async request => {
    const user = currentUser(request);
    const now = new Date();

    const polls = await db.select().from(hrPollPolls).where(eq(hrPollPolls.status, 'published'));
    const responses = await db.select({ pollId: hrPollResponses.pollId }).from(hrPollResponses).where(eq(hrPollResponses.userId, user.id));
    const answered = new Set(responses.map(r => r.pollId));

    const items: PollListItem[] = polls
      .map(poll => ({ poll, hasResponse: answered.has(poll.id) }))
      .filter(({ poll, hasResponse }) => hasResponse || withinWindow(poll, now))
      .map(({ poll, hasResponse }) => ({
        id: poll.id,
        code: poll.code,
        title: poll.title,
        description: poll.description,
        status: computeStatus(poll, hasResponse, now),
      }));
    return items;
  });

  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = currentUser(request);
    const poll = await loadPublishedPoll(id, reply);
    if (!poll) return;

    const [myResponse] = await db
      .select()
      .from(hrPollResponses)
      .where(and(eq(hrPollResponses.pollId, id), eq(hrPollResponses.userId, user.id)))
      .limit(1);

    const now = new Date();
    const detail: PollDetail = {
      id: poll.id,
      title: poll.title,
      description: poll.description,
      questions: poll.questions,
      myAnswers: myResponse?.answers ?? null,
      allowRepeat: poll.allowRepeat,
      canSubmit: withinWindow(poll, now) && (!myResponse || poll.allowRepeat),
    };
    return detail;
  });

  fastify.post('/:id/responses', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = currentUser(request);
    const poll = await loadPublishedPoll(id, reply);
    if (!poll) return;

    if (!withinWindow(poll, new Date())) {
      return reply.code(400).send({ error: 'Опрос сейчас недоступен для ответа' });
    }

    const [existing] = await db
      .select({ id: hrPollResponses.id })
      .from(hrPollResponses)
      .where(and(eq(hrPollResponses.pollId, id), eq(hrPollResponses.userId, user.id)))
      .limit(1);
    if (existing && !poll.allowRepeat) {
      return reply.code(400).send({ error: 'Вы уже ответили на этот опрос' });
    }

    const body = (request.body ?? {}) as { answers?: Record<string, unknown> };
    const answers = body.answers ?? {};
    const missing = poll.questions.filter(
      (q: PollQuestion) => q.required && (answers[q.key] === undefined || answers[q.key] === null || answers[q.key] === ''),
    );
    if (missing.length) {
      return reply.code(400).send({ error: `Не заполнены обязательные вопросы: ${missing.map(q => q.label).join(', ')}` });
    }

    await db.transaction(async tx => {
      // Ответ — документ с `creatable: false`, поэтому создание идёт мимо DocumentRuntime.create(),
      // и id приходится брать из индекса явно: responses.id ссылается на core.document_index(id)
      // внешним ключом (миграция 0001_document_index_fk.sql), проверка немедленная. Тот же приём,
      // что в WorkflowEngine.startProcess() и HrStructureService.create*().
      // Actor для анонимного опроса не передаём — иначе document_index.created_by_user_id выдал бы
      // автора ответа, ради сокрытия которого в самой строке и стоит userId = null.
      const actor = poll.anonymous ? undefined : { userId: user.id };
      const responseId = await documentRuntime.allocateDocumentId(HrPollDocuments.RESPONSE, tx, { actor });
      await tx.insert(hrPollResponses).values({ id: responseId, pollId: id, userId: poll.anonymous ? null : user.id, answers });
    });
    return reply.code(201).send({ ok: true });
  });

  fastify.post('/:id/publish', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db.select().from(hrPollPolls).where(eq(hrPollPolls.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'Опрос не найден' });
    if (row.status === 'published') {
      return reply.code(409).send({ error: 'Опрос уже опубликован' });
    }
    const [updated] = await db.update(hrPollPolls).set({ status: 'published' }).where(eq(hrPollPolls.id, id)).returning();
    return updated;
  });
}
