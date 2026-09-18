import { identityUser } from '@amplicada/platform-core/backend';
import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  SUPPORT_CHAT_EVENTS,
  type SupportAdminThreadDto,
  type SupportAdminThreadPatch,
  type SupportAttachmentUploadDto,
  type SupportAuthorRole,
  type SupportChatBackendService,
  type SupportChatEventPayload,
  type SupportMessageDto,
  type SupportThreadDto,
  type SupportThreadStatus,
  type SupportUserStatusPatch,
  type SupportUserThreadSummaryDto,
} from '../../contracts/index.js';
import { type SupportChatMessageRow, supportChatMessages } from '../schemas/messages.js';
import { type SupportChatThreadRow, supportChatThreads } from '../schemas/threads.js';
import { isAttachmentKeyAllowed, userAttachmentPrefix } from './attachments.js';
import {
  canUserSetStatus,
  collectParticipants,
  countUnread,
  lifecyclePatch,
  previewMessage,
  statusAfterAdminMessage,
  statusAfterUserMessage,
} from './helpers.js';

export class SupportChatError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'SupportChatError';
  }
}

export interface SupportThreadWithMessages {
  thread: SupportChatThreadRow;
  messages: SupportChatMessageWithAuthor[];
}

/** Строка сообщения вместе с логином автора: имя показывается в подписи группы в UI. */
export type SupportChatMessageWithAuthor = SupportChatMessageRow & { authorLogin: string | null };

/** Обращение, привязанное к инциденту: поддержка видит, кого затронул инцидент. */
export interface SupportLinkedThread {
  id: string;
  userLogin: string;
  status: SupportThreadStatus;
}

export interface SupportChatService extends SupportChatBackendService {
  /** Активное обращение пользователя — свежее по updatedAt; его показывает плавающий виджет. */
  getActiveUserThread(userId: string): Promise<SupportThreadWithMessages | null>;
  /** Все обращения пользователя со сводкой для страницы «Мои обращения». */
  listUserThreads(userId: string): Promise<SupportUserThreadSummaryDto[]>;
  /** Сумма непрочитанного по всем обращениям — для бейджа на виджете. */
  getUserUnreadTotal(userId: string): Promise<number>;
  /** Обращение пользователя по id; `null` — чужое или несуществующее. */
  getUserThreadById(userId: string, threadId: string): Promise<SupportThreadWithMessages | null>;
  /** Новое обращение с первым сообщением. */
  createUserThread(
    userId: string,
    body: string,
    attachment?: SupportAttachmentUploadDto | null,
  ): Promise<SupportThreadWithMessages & { message: SupportChatMessageWithAuthor }>;
  /** Сообщение в конкретное обращение пользователя (в отличие от виджета, который пишет в активное). */
  sendUserThreadMessage(
    userId: string,
    threadId: string,
    body: string,
    attachment?: SupportAttachmentUploadDto | null,
  ): Promise<SupportThreadWithMessages & { message: SupportChatMessageWithAuthor }>;
  markUserThreadRead(userId: string, threadId: string): Promise<void>;
  sendUserMessage(
    userId: string,
    body: string,
    attachment?: SupportAttachmentUploadDto | null,
  ): Promise<SupportThreadWithMessages & { message: SupportChatMessageWithAuthor }>;
  /** Отметка прочтения активного обращения (виджет). */
  markUserRead(userId: string): Promise<void>;
  listThreads(): Promise<SupportAdminThreadDto[]>;
  getThread(threadId: string): Promise<SupportThreadWithMessages & { userLogin: string; linkedThreads: SupportLinkedThread[] }>;
  sendAdminMessage(
    threadId: string,
    adminId: string,
    body: string,
    attachment?: SupportAttachmentUploadDto | null,
  ): Promise<SupportThreadWithMessages & { message: SupportChatMessageWithAuthor }>;
  markAdminRead(threadId: string): Promise<void>;
  /** Смена жизненного цикла и атрибутов обращения поддержкой. */
  updateThread(threadId: string, patch: SupportAdminThreadPatch): Promise<SupportThreadWithMessages>;
  /** Закрытие/переоткрытие обращения самим пользователем. */
  setUserThreadStatus(userId: string, threadId: string, patch: SupportUserStatusPatch): Promise<SupportThreadWithMessages>;
  /** Рассылка сообщения поддержки по обращениям, привязанным к инциденту; возвращает число получателей. */
  broadcastToLinked(threadId: string, adminId: string, body: string): Promise<number>;
  /** Вложение сообщения для скачивания; `null` — сообщения нет или файла в нём нет. */
  getMessageAttachment(messageId: string): Promise<{ threadUserId: string; key: string; name: string; mime: string } | null>;
}

export interface CreateSupportChatServiceOptions {
  db: BackendDbService;
  publish?: (type: string, payload: SupportChatEventPayload) => void;
}

type SupportChatTx = Parameters<Parameters<BackendDbService['transaction']>[0]>[0];

/**
 * Прикладывать можно только объекты, загруженные участниками этого разговора:
 * собственный префикс автора сообщения или префикс владельца треда (публичный
 * сервис для AI тоже ходит от имени треда).
 */
function assertAttachmentAllowed(attachment: SupportAttachmentUploadDto, authorId: string | null, threadUserId: string): void {
  const allowed = [threadUserId, ...(authorId ? [authorId] : [])].map(userAttachmentPrefix);
  if (!isAttachmentKeyAllowed(attachment.key, allowed)) {
    throw new SupportChatError('Attachment does not belong to this conversation', 400);
  }
}

/** Общее подмножество `db` и транзакции: обоим нужен один и тот же select сообщений. */
type MessageReader = Pick<BackendDbService, 'select'>;

export function toMessageDto(message: SupportChatMessageWithAuthor): SupportMessageDto {
  return {
    id: message.id,
    authorId: message.authorId,
    authorLogin: message.authorLogin,
    authorRole: message.authorRole,
    body: message.body,
    attachment: message.attachmentKey
      ? {
          name: message.attachmentName ?? 'file',
          mime: message.attachmentMime ?? 'application/octet-stream',
          size: message.attachmentSize ?? 0,
        }
      : null,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toThreadDto(
  thread: SupportChatThreadRow,
  messages: SupportChatMessageWithAuthor[],
  readerRole: SupportAuthorRole,
): SupportThreadDto {
  const lastReadAt = readerRole === 'user' ? thread.userLastReadAt : thread.adminLastReadAt;
  return {
    id: thread.id,
    status: thread.status,
    kind: thread.kind,
    severity: thread.severity,
    incidentThreadId: thread.incidentThreadId,
    resolvedBy: thread.resolvedBy,
    closeReason: thread.closeReason,
    resolvedAt: thread.resolvedAt?.toISOString() ?? null,
    closedAt: thread.closedAt?.toISOString() ?? null,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    unreadCount: countUnread(messages, readerRole, lastReadAt),
    messages: messages.map(toMessageDto),
  };
}

export function createSupportChatService(options: CreateSupportChatServiceOptions): SupportChatService {
  const { db, publish } = options;

  async function loadMessages(reader: MessageReader, threadId: string): Promise<SupportChatMessageWithAuthor[]> {
    const rows = await reader
      .select({ message: supportChatMessages, authorLogin: identityUser.login })
      .from(supportChatMessages)
      .leftJoin(identityUser, eq(identityUser.id, supportChatMessages.authorId))
      .where(eq(supportChatMessages.threadId, threadId))
      .orderBy(asc(supportChatMessages.createdAt));

    return rows.map(({ message, authorLogin }) => ({ ...message, authorLogin }));
  }

  /** Сообщения нескольких тредов одним запросом: страница «Мои обращения» показывает сводки. */
  async function loadMessagesForThreads(threadIds: string[]): Promise<Map<string, SupportChatMessageWithAuthor[]>> {
    const grouped = new Map<string, SupportChatMessageWithAuthor[]>();
    if (threadIds.length === 0) return grouped;

    const rows = await db
      .select({ message: supportChatMessages, authorLogin: identityUser.login })
      .from(supportChatMessages)
      .leftJoin(identityUser, eq(identityUser.id, supportChatMessages.authorId))
      .where(inArray(supportChatMessages.threadId, threadIds))
      .orderBy(asc(supportChatMessages.createdAt));

    for (const { message, authorLogin } of rows) {
      const list = grouped.get(message.threadId) ?? [];
      list.push({ ...message, authorLogin });
      grouped.set(message.threadId, list);
    }
    return grouped;
  }

  /** Привязка к инциденту: цель существует, сама является инцидентом и это не сам тред. */
  async function resolveIncidentLink(incidentThreadId: string | null, threadId: string): Promise<string | null> {
    if (!incidentThreadId) return null;
    if (incidentThreadId === threadId) throw new SupportChatError('Thread cannot be linked to itself', 400);
    const [incident] = await db
      .select({ id: supportChatThreads.id, kind: supportChatThreads.kind })
      .from(supportChatThreads)
      .where(eq(supportChatThreads.id, incidentThreadId))
      .limit(1);
    if (incident?.kind !== 'incident') throw new SupportChatError('Incident thread not found', 404);
    return incident.id;
  }

  async function loadThreadOrThrow(threadId: string) {
    const [thread] = await db.select().from(supportChatThreads).where(eq(supportChatThreads.id, threadId)).limit(1);
    if (!thread) throw new SupportChatError('Thread not found', 404);
    return thread;
  }

  function emitMessage(thread: SupportChatThreadRow, message: SupportChatMessageRow): void {
    publish?.(SUPPORT_CHAT_EVENTS.MESSAGE_CREATED, {
      threadId: thread.id,
      userId: thread.userId,
      authorRole: message.authorRole,
      status: thread.status,
      messageId: message.id,
    });
    publish?.(SUPPORT_CHAT_EVENTS.THREAD_UPDATED, {
      threadId: thread.id,
      userId: thread.userId,
      authorRole: message.authorRole,
      status: thread.status,
    });
  }

  async function writeMessage(
    tx: SupportChatTx,
    thread: SupportChatThreadRow,
    authorRole: SupportAuthorRole,
    authorId: string | null,
    body: string,
    attachment: SupportAttachmentUploadDto | null,
    now: Date,
  ) {
    if (attachment) assertAttachmentAllowed(attachment, authorId, thread.userId);
    const [message] = await tx
      .insert(supportChatMessages)
      .values({
        threadId: thread.id,
        authorId,
        authorRole,
        body,
        attachmentKey: attachment?.key ?? null,
        attachmentName: attachment?.name ?? null,
        attachmentMime: attachment?.mime ?? null,
        attachmentSize: attachment?.size ?? null,
        createdAt: now,
      })
      .returning();

    const patch: Partial<SupportChatThreadRow> = { updatedAt: now };
    if (authorRole === 'user') {
      patch.userLastReadAt = now;
      Object.assign(patch, lifecyclePatch(thread, statusAfterUserMessage(thread.status), 'user', null, now));
    }
    if (authorRole === 'admin') {
      patch.adminLastReadAt = now;
      Object.assign(patch, lifecyclePatch(thread, statusAfterAdminMessage(thread.status), 'admin', null, now));
    }

    const [updated] = await tx.update(supportChatThreads).set(patch).where(eq(supportChatThreads.id, thread.id)).returning();

    const messages = await loadMessages(tx, thread.id);

    // Автор только что вставленного сообщения уже есть в выборке — заодно получает authorLogin.
    const stored = messages.find(candidate => candidate.id === message.id) ?? { ...message, authorLogin: null };
    return { thread: updated, messages, message: stored };
  }

  async function appendMessage(input: Parameters<SupportChatBackendService['appendMessage']>[0]): Promise<SupportMessageDto> {
    const now = new Date();
    const result = await db.transaction(async tx => {
      const [thread] = await tx.select().from(supportChatThreads).where(eq(supportChatThreads.id, input.threadId)).limit(1);
      if (!thread) throw new SupportChatError('Thread not found', 404);
      return writeMessage(tx, thread, input.authorRole, input.authorId ?? null, input.body, input.attachment ?? null, now);
    });
    emitMessage(result.thread, result.message);
    return toMessageDto(result.message);
  }

  return {
    async appendMessage(input) {
      return appendMessage(input);
    },

    async getThreadMessages(threadId) {
      const thread = await loadThreadOrThrow(threadId);
      const messages = await loadMessages(db, thread.id);
      return { threadId: thread.id, status: thread.status, messages: messages.map(toMessageDto) };
    },

    async getActiveUserThread(userId) {
      const [thread] = await db
        .select()
        .from(supportChatThreads)
        .where(eq(supportChatThreads.userId, userId))
        .orderBy(desc(supportChatThreads.updatedAt))
        .limit(1);
      if (!thread) return null;
      return { thread, messages: await loadMessages(db, thread.id) };
    },

    async listUserThreads(userId) {
      const threads = await db
        .select()
        .from(supportChatThreads)
        .where(eq(supportChatThreads.userId, userId))
        .orderBy(desc(supportChatThreads.updatedAt));
      if (threads.length === 0) return [];

      const messagesByThread = await loadMessagesForThreads(threads.map(thread => thread.id));

      return threads.map<SupportUserThreadSummaryDto>(thread => {
        const messages = messagesByThread.get(thread.id) ?? [];
        const last = messages[messages.length - 1];
        return {
          id: thread.id,
          status: thread.status,
          kind: thread.kind,
          severity: thread.severity,
          incidentThreadId: thread.incidentThreadId,
          createdAt: thread.createdAt.toISOString(),
          updatedAt: thread.updatedAt.toISOString(),
          unreadCount: countUnread(messages, 'user', thread.userLastReadAt),
          messageCount: messages.length,
          lastMessagePreview: last ? previewMessage(last.body, last.attachmentName) : null,
          participants: collectParticipants(messages),
        };
      });
    },

    async getUserUnreadTotal(userId) {
      const [row] = await db
        .select({
          unread: sql<number>`count(*) filter (where ${supportChatMessages.authorRole} <> 'user' and ${supportChatMessages.createdAt} > coalesce(${supportChatThreads.userLastReadAt}, '-infinity'::timestamptz))::int`,
        })
        .from(supportChatMessages)
        .innerJoin(supportChatThreads, eq(supportChatThreads.id, supportChatMessages.threadId))
        .where(eq(supportChatThreads.userId, userId));
      return row?.unread ?? 0;
    },

    async getUserThreadById(userId, threadId) {
      const [thread] = await db.select().from(supportChatThreads).where(eq(supportChatThreads.id, threadId)).limit(1);
      if (!thread || thread.userId !== userId) return null;
      return { thread, messages: await loadMessages(db, thread.id) };
    },

    async sendUserMessage(userId, body, attachment) {
      const now = new Date();
      const result = await db.transaction(async tx => {
        const [existing] = await tx
          .select()
          .from(supportChatThreads)
          .where(eq(supportChatThreads.userId, userId))
          .orderBy(desc(supportChatThreads.updatedAt))
          .limit(1);

        let thread = existing;
        if (!thread) {
          [thread] = await tx
            .insert(supportChatThreads)
            .values({ userId, status: 'open', createdAt: now, updatedAt: now, userLastReadAt: now })
            .returning();
        }

        return writeMessage(tx, thread, 'user', userId, body, attachment ?? null, now);
      });
      emitMessage(result.thread, result.message);
      return result;
    },

    async markUserRead(userId) {
      const [thread] = await db
        .select({ id: supportChatThreads.id })
        .from(supportChatThreads)
        .where(eq(supportChatThreads.userId, userId))
        .orderBy(desc(supportChatThreads.updatedAt))
        .limit(1);
      if (!thread) return;
      await db.update(supportChatThreads).set({ userLastReadAt: new Date() }).where(eq(supportChatThreads.id, thread.id));
    },

    async markUserThreadRead(userId, threadId) {
      const [thread] = await db.select().from(supportChatThreads).where(eq(supportChatThreads.id, threadId)).limit(1);
      if (!thread || thread.userId !== userId) throw new SupportChatError('Thread not found', 404);
      await db.update(supportChatThreads).set({ userLastReadAt: new Date() }).where(eq(supportChatThreads.id, threadId));
    },

    async createUserThread(userId, body, attachment) {
      const now = new Date();
      const result = await db.transaction(async tx => {
        const [thread] = await tx
          .insert(supportChatThreads)
          .values({ userId, status: 'open', createdAt: now, updatedAt: now, userLastReadAt: now })
          .returning();
        return writeMessage(tx, thread, 'user', userId, body, attachment ?? null, now);
      });
      emitMessage(result.thread, result.message);
      return result;
    },

    async sendUserThreadMessage(userId, threadId, body, attachment) {
      const now = new Date();
      const result = await db.transaction(async tx => {
        const [thread] = await tx.select().from(supportChatThreads).where(eq(supportChatThreads.id, threadId)).limit(1);
        if (!thread || thread.userId !== userId) throw new SupportChatError('Thread not found', 404);
        return writeMessage(tx, thread, 'user', userId, body, attachment ?? null, now);
      });
      emitMessage(result.thread, result.message);
      return result;
    },

    async listThreads() {
      const rows = await db
        .select({
          id: supportChatThreads.id,
          userId: supportChatThreads.userId,
          userLogin: identityUser.login,
          status: supportChatThreads.status,
          kind: supportChatThreads.kind,
          severity: supportChatThreads.severity,
          incidentThreadId: supportChatThreads.incidentThreadId,
          updatedAt: supportChatThreads.updatedAt,
          adminLastReadAt: supportChatThreads.adminLastReadAt,
        })
        .from(supportChatThreads)
        .innerJoin(identityUser, eq(identityUser.id, supportChatThreads.userId))
        .orderBy(desc(supportChatThreads.updatedAt));

      if (rows.length === 0) return [];

      const ids = rows.map(row => row.id);
      const lastMessages = await db
        .selectDistinctOn([supportChatMessages.threadId], {
          threadId: supportChatMessages.threadId,
          body: supportChatMessages.body,
          attachmentName: supportChatMessages.attachmentName,
          createdAt: supportChatMessages.createdAt,
        })
        .from(supportChatMessages)
        .where(inArray(supportChatMessages.threadId, ids))
        .orderBy(supportChatMessages.threadId, desc(supportChatMessages.createdAt));

      const unreadRows = await db
        .select({
          threadId: supportChatMessages.threadId,
          unread: sql<number>`count(*) filter (where ${supportChatMessages.createdAt} > coalesce(${supportChatThreads.adminLastReadAt}, '-infinity'::timestamptz))::int`,
        })
        .from(supportChatMessages)
        .innerJoin(supportChatThreads, eq(supportChatThreads.id, supportChatMessages.threadId))
        .where(and(inArray(supportChatMessages.threadId, ids), eq(supportChatMessages.authorRole, 'user')))
        .groupBy(supportChatMessages.threadId);

      const lastByThread = new Map(lastMessages.map(row => [row.threadId, row]));
      const unreadByThread = new Map(unreadRows.map(row => [row.threadId, row.unread]));

      return rows.map<SupportAdminThreadDto>(row => {
        const last = lastByThread.get(row.id);
        return {
          id: row.id,
          userId: row.userId,
          userLogin: row.userLogin,
          status: row.status,
          kind: row.kind,
          severity: row.severity,
          incidentThreadId: row.incidentThreadId,
          updatedAt: row.updatedAt.toISOString(),
          unreadCount: unreadByThread.get(row.id) ?? 0,
          lastMessagePreview: last ? previewMessage(last.body, last.attachmentName) : null,
        };
      });
    },

    async getThread(threadId) {
      const thread = await loadThreadOrThrow(threadId);
      const [user] = await db.select({ login: identityUser.login }).from(identityUser).where(eq(identityUser.id, thread.userId)).limit(1);
      const linked = await db
        .select({ id: supportChatThreads.id, userLogin: identityUser.login, status: supportChatThreads.status })
        .from(supportChatThreads)
        .innerJoin(identityUser, eq(identityUser.id, supportChatThreads.userId))
        .where(eq(supportChatThreads.incidentThreadId, thread.id))
        .orderBy(desc(supportChatThreads.updatedAt));
      return {
        thread,
        messages: await loadMessages(db, thread.id),
        userLogin: user?.login ?? '',
        linkedThreads: linked.map(item => ({ id: item.id, userLogin: item.userLogin, status: item.status })),
      };
    },

    async sendAdminMessage(threadId, adminId, body, attachment) {
      const now = new Date();
      const result = await db.transaction(async tx => {
        const [thread] = await tx.select().from(supportChatThreads).where(eq(supportChatThreads.id, threadId)).limit(1);
        if (!thread) throw new SupportChatError('Thread not found', 404);
        return writeMessage(tx, thread, 'admin', adminId, body, attachment ?? null, now);
      });
      emitMessage(result.thread, result.message);
      return result;
    },

    async markAdminRead(threadId) {
      await loadThreadOrThrow(threadId);
      await db.update(supportChatThreads).set({ adminLastReadAt: new Date() }).where(eq(supportChatThreads.id, threadId));
    },

    async getMessageAttachment(messageId) {
      const [row] = await db
        .select({
          threadUserId: supportChatThreads.userId,
          key: supportChatMessages.attachmentKey,
          name: supportChatMessages.attachmentName,
          mime: supportChatMessages.attachmentMime,
        })
        .from(supportChatMessages)
        .innerJoin(supportChatThreads, eq(supportChatThreads.id, supportChatMessages.threadId))
        .where(eq(supportChatMessages.id, messageId))
        .limit(1);

      if (!row?.key) return null;
      return {
        threadUserId: row.threadUserId,
        key: row.key,
        name: row.name ?? 'file',
        mime: row.mime ?? 'application/octet-stream',
      };
    },

    async updateThread(threadId, patch) {
      const current = await loadThreadOrThrow(threadId);
      const now = new Date();
      const next: Partial<SupportChatThreadRow> = { updatedAt: now };

      if (patch.status && patch.status !== current.status) {
        Object.assign(next, lifecyclePatch(current, patch.status, 'admin', patch.closeReason ?? null, now));
      }

      if (patch.kind !== undefined) {
        if (patch.kind === 'incident') {
          const severity = patch.severity ?? current.severity;
          if (!severity) throw new SupportChatError('Incident requires severity', 400);
          next.kind = 'incident';
          next.severity = severity;
          // Инцидент не может быть привязан к другому инциденту.
          next.incidentThreadId = null;
        } else {
          next.kind = 'question';
          next.severity = null;
        }
      } else if (patch.severity !== undefined) {
        if (current.kind !== 'incident') throw new SupportChatError('Severity is only for incidents', 400);
        next.severity = patch.severity;
      }

      if (patch.incidentThreadId !== undefined) {
        next.incidentThreadId = await resolveIncidentLink(patch.incidentThreadId, threadId);
      }

      const [thread] = await db.update(supportChatThreads).set(next).where(eq(supportChatThreads.id, threadId)).returning();
      const messages = await loadMessages(db, thread.id);

      if (patch.status && patch.status !== current.status) {
        publish?.(SUPPORT_CHAT_EVENTS.THREAD_UPDATED, {
          threadId: thread.id,
          userId: thread.userId,
          authorRole: 'admin',
          status: thread.status,
        });
      }
      return { thread, messages };
    },

    async setUserThreadStatus(userId, threadId, patch) {
      const current = await loadThreadOrThrow(threadId);
      if (current.userId !== userId) throw new SupportChatError('Thread not found', 404);
      if (!canUserSetStatus(current.status, patch.status)) {
        throw new SupportChatError(`Cannot change status from ${current.status} to ${patch.status}`, 400);
      }

      const now = new Date();
      const [thread] = await db
        .update(supportChatThreads)
        .set({ updatedAt: now, ...lifecyclePatch(current, patch.status, 'user', patch.closeReason ?? null, now) })
        .where(eq(supportChatThreads.id, threadId))
        .returning();
      const messages = await loadMessages(db, thread.id);
      publish?.(SUPPORT_CHAT_EVENTS.THREAD_UPDATED, {
        threadId: thread.id,
        userId: thread.userId,
        authorRole: 'user',
        status: thread.status,
      });
      return { thread, messages };
    },

    async broadcastToLinked(threadId, adminId, body) {
      const incident = await loadThreadOrThrow(threadId);
      if (incident.kind !== 'incident') throw new SupportChatError('Thread is not an incident', 400);

      const linked = await db
        .select({ id: supportChatThreads.id })
        .from(supportChatThreads)
        .where(eq(supportChatThreads.incidentThreadId, threadId));
      for (const item of linked) {
        await appendMessage({ threadId: item.id, authorRole: 'admin', authorId: adminId, body });
      }
      return linked.length;
    },
  };
}
