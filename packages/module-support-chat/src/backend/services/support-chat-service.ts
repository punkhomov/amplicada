import { identityUser } from '@amplicada/platform-core/backend';
import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  SUPPORT_CHAT_EVENTS,
  type SupportAdminThreadDto,
  type SupportAuthorRole,
  type SupportChatBackendService,
  type SupportChatEventPayload,
  type SupportMessageDto,
  type SupportThreadDto,
  type SupportThreadStatus,
} from '../../contracts/index.js';
import { type SupportChatMessageRow, supportChatMessages } from '../schemas/messages.js';
import { type SupportChatThreadRow, supportChatThreads } from '../schemas/threads.js';
import { countUnread, previewText, statusAfterUserMessage } from './helpers.js';

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
  messages: SupportChatMessageRow[];
}

export interface SupportChatService extends SupportChatBackendService {
  getUserThread(userId: string): Promise<SupportThreadWithMessages | null>;
  sendUserMessage(userId: string, body: string): Promise<SupportThreadWithMessages & { message: SupportChatMessageRow }>;
  markUserRead(userId: string): Promise<void>;
  listThreads(): Promise<SupportAdminThreadDto[]>;
  getThread(threadId: string): Promise<SupportThreadWithMessages & { userLogin: string }>;
  sendAdminMessage(
    threadId: string,
    adminId: string,
    body: string,
  ): Promise<SupportThreadWithMessages & { message: SupportChatMessageRow }>;
  markAdminRead(threadId: string): Promise<void>;
  setStatus(threadId: string, status: SupportThreadStatus): Promise<SupportThreadWithMessages>;
}

export interface CreateSupportChatServiceOptions {
  db: BackendDbService;
  publish?: (type: string, payload: SupportChatEventPayload) => void;
}

type SupportChatTx = Parameters<Parameters<BackendDbService['transaction']>[0]>[0];

export function toMessageDto(row: SupportChatMessageRow): SupportMessageDto {
  return {
    id: row.id,
    authorId: row.authorId,
    authorRole: row.authorRole,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toThreadDto(
  thread: SupportChatThreadRow,
  messages: SupportChatMessageRow[],
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

  async function loadMessages(threadId: string): Promise<SupportChatMessageRow[]> {
    return db
      .select()
      .from(supportChatMessages)
      .where(eq(supportChatMessages.threadId, threadId))
      .orderBy(asc(supportChatMessages.createdAt));
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
    now: Date,
  ) {
    const [message] = await tx
      .insert(supportChatMessages)
      .values({ threadId: thread.id, authorId, authorRole, body, createdAt: now })
      .returning();

    const patch: Partial<SupportChatThreadRow> = { updatedAt: now };
    if (authorRole === 'user') {
      patch.userLastReadAt = now;
      patch.status = statusAfterUserMessage(thread.status);
    }
    if (authorRole === 'admin') patch.adminLastReadAt = now;

    const [updated] = await tx.update(supportChatThreads).set(patch).where(eq(supportChatThreads.id, thread.id)).returning();

    const messages = await tx
      .select()
      .from(supportChatMessages)
      .where(eq(supportChatMessages.threadId, thread.id))
      .orderBy(asc(supportChatMessages.createdAt));

    return { thread: updated, messages, message };
  }

  async function appendMessage(input: Parameters<SupportChatBackendService['appendMessage']>[0]): Promise<SupportMessageDto> {
    const now = new Date();
    const result = await db.transaction(async tx => {
      const [thread] = await tx.select().from(supportChatThreads).where(eq(supportChatThreads.id, input.threadId)).limit(1);
      if (!thread) throw new SupportChatError('Thread not found', 404);
      return writeMessage(tx, thread, input.authorRole, input.authorId ?? null, input.body, now);
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
      const messages = await loadMessages(thread.id);
      return { threadId: thread.id, status: thread.status, messages: messages.map(toMessageDto) };
    },

    async getUserThread(userId) {
      const [thread] = await db.select().from(supportChatThreads).where(eq(supportChatThreads.userId, userId)).limit(1);
      if (!thread) return null;
      return { thread, messages: await loadMessages(thread.id) };
    },

    async sendUserMessage(userId, body) {
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

        return writeMessage(tx, thread, 'user', userId, body, now);
      });
      emitMessage(result.thread, result.message);
      return result;
    },

    async markUserRead(userId) {
      await db.update(supportChatThreads).set({ userLastReadAt: new Date() }).where(eq(supportChatThreads.userId, userId));
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
          lastMessagePreview: last ? previewText(last.body) : null,
        };
      });
    },

    async getThread(threadId) {
      const thread = await loadThreadOrThrow(threadId);
      const [user] = await db.select({ login: identityUser.login }).from(identityUser).where(eq(identityUser.id, thread.userId)).limit(1);
      return { thread, messages: await loadMessages(thread.id), userLogin: user?.login ?? '' };
    },

    async sendAdminMessage(threadId, adminId, body) {
      const now = new Date();
      const result = await db.transaction(async tx => {
        const [thread] = await tx.select().from(supportChatThreads).where(eq(supportChatThreads.id, threadId)).limit(1);
        if (!thread) throw new SupportChatError('Thread not found', 404);
        return writeMessage(tx, thread, 'admin', adminId, body, now);
      });
      emitMessage(result.thread, result.message);
      return result;
    },

    async markAdminRead(threadId) {
      await loadThreadOrThrow(threadId);
      await db.update(supportChatThreads).set({ adminLastReadAt: new Date() }).where(eq(supportChatThreads.id, threadId));
    },

    async setStatus(threadId, status) {
      await loadThreadOrThrow(threadId);
      const [thread] = await db
        .update(supportChatThreads)
        .set({ status, updatedAt: new Date() })
        .where(eq(supportChatThreads.id, threadId))
        .returning();
      const messages = await loadMessages(threadId);
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
