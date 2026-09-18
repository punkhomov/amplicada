import { identityUser } from '@amplicada/platform-core/backend';
import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  SUPPORT_CHAT_EVENTS,
  type SupportAdminThreadDto,
  type SupportAttachmentUploadDto,
  type SupportAuthorRole,
  type SupportChatBackendService,
  type SupportChatEventPayload,
  type SupportMessageDto,
  type SupportThreadDto,
  type SupportThreadStatus,
  type SupportUserThreadSummaryDto,
} from '../../contracts/index.js';
import { type SupportChatMessageRow, supportChatMessages } from '../schemas/messages.js';
import { type SupportChatThreadRow, supportChatThreads } from '../schemas/threads.js';
import { isAttachmentKeyAllowed, userAttachmentPrefix } from './attachments.js';
import { collectParticipants, countUnread, previewMessage, statusAfterUserMessage } from './helpers.js';

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
  getThread(threadId: string): Promise<SupportThreadWithMessages & { userLogin: string }>;
  sendAdminMessage(
    threadId: string,
    adminId: string,
    body: string,
    attachment?: SupportAttachmentUploadDto | null,
  ): Promise<SupportThreadWithMessages & { message: SupportChatMessageWithAuthor }>;
  markAdminRead(threadId: string): Promise<void>;
  setStatus(threadId: string, status: SupportThreadStatus): Promise<SupportThreadWithMessages>;
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
      patch.status = statusAfterUserMessage(thread.status);
    }
    if (authorRole === 'admin') patch.adminLastReadAt = now;

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
        const [existing] = await tx.select().from(supportChatThreads).where(eq(supportChatThreads.userId, userId)).limit(1);

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
          updatedAt: row.updatedAt.toISOString(),
          unreadCount: unreadByThread.get(row.id) ?? 0,
          lastMessagePreview: last ? previewMessage(last.body, last.attachmentName) : null,
        };
      });
    },

    async getThread(threadId) {
      const thread = await loadThreadOrThrow(threadId);
      const [user] = await db.select({ login: identityUser.login }).from(identityUser).where(eq(identityUser.id, thread.userId)).limit(1);
      return { thread, messages: await loadMessages(db, thread.id), userLogin: user?.login ?? '' };
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

    async setStatus(threadId, status) {
      await loadThreadOrThrow(threadId);
      const [thread] = await db
        .update(supportChatThreads)
        .set({ status, updatedAt: new Date() })
        .where(eq(supportChatThreads.id, threadId))
        .returning();
      const messages = await loadMessages(db, threadId);
      publish?.(SUPPORT_CHAT_EVENTS.THREAD_UPDATED, {
        threadId: thread.id,
        userId: thread.userId,
        authorRole: 'admin',
        status: thread.status,
      });
      return { thread, messages };
    },
  };
}
