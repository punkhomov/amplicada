import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { BackendDbService } from '../../contracts/backend/db.js';
import type { EventBus } from '../../contracts/event-bus.js';
import type { NotificationChannel, ResolvedNotification } from '../../contracts/notification.js';
import { notificationOutbox } from '../schemas/index.js';
import { BACKOFF_CAP_MS, backoffDelayMs, countBatchOutcomes, NotificationServiceImpl, pickChannel } from './notification-service.js';

function channel(id: string, address: string | null): NotificationChannel {
  return {
    id,
    resolveAddress: async () => address,
    send: async () => {},
  };
}

test('backoffDelayMs растёт экспоненциально от базы', () => {
  assert.equal(backoffDelayMs(0, 1000), 1000);
  assert.equal(backoffDelayMs(1, 1000), 2000);
  assert.equal(backoffDelayMs(3, 1000), 8000);
});

test('backoffDelayMs не превышает часовой потолок', () => {
  assert.equal(backoffDelayMs(20, 30_000), BACKOFF_CAP_MS);
});

test('backoffDelayMs не ломается на отрицательных значениях', () => {
  assert.equal(backoffDelayMs(-1, 1000), 1000);
});

test('pickChannel без явного канала берёт первый с адресом', () => {
  const email = channel('email', null);
  const sms = channel('sms', '+70000000000');
  const picked = pickChannel(
    [
      { channel: email, address: null },
      { channel: sms, address: '+70000000000' },
    ],
    undefined,
  );
  assert.equal(picked?.channel.id, 'sms');
  assert.equal(picked?.address, '+70000000000');
});

test('pickChannel с явным каналом не подменяет его другим', () => {
  const email = channel('email', null);
  const sms = channel('sms', '+70000000000');
  const picked = pickChannel(
    [
      { channel: email, address: null },
      { channel: sms, address: '+70000000000' },
    ],
    'email',
  );
  assert.equal(picked, null);
});

test('pickChannel возвращает null, когда адресов нет ни у кого', () => {
  const picked = pickChannel([{ channel: channel('email', null), address: null }], undefined);
  assert.equal(picked, null);
});

interface RecordedQuery {
  text: string;
  values: unknown[];
}

/** drizzle поверх клиента-заглушки: запросы не выполняются, ответы задаются по порядку. */
function recordingDb(responses: unknown[][][] = []): { db: BackendDbService; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const client = {
    // biome-ignore lint/suspicious/noExplicitAny: минимальная заглушка pg-клиента
    query: async (config: any, params?: unknown[]) => {
      const text = typeof config === 'string' ? config : config.text;
      const rows = responses[queries.length] ?? [];
      queries.push({ text, values: (params ?? config?.values ?? []) as unknown[] });
      return { rows, rowCount: rows.length, fields: [] };
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: драйвер подменён, реального соединения нет
  return { db: drizzle({ client: client as any }) as unknown as BackendDbService, queries };
}

const ID = '00000000-0000-0000-0000-000000000001';

function serviceWith(responses: unknown[][][] = []): {
  service: NotificationServiceImpl;
  queries: RecordedQuery[];
} {
  const { db, queries } = recordingDb(responses);
  const eventBus = { emit: () => {} } as unknown as EventBus;
  const service = new NotificationServiceImpl({ db, eventBus });
  service.registerChannel(channel('test', 'user@example.com'));
  return { service, queries };
}

const INLINE = { subject: 'Тема', body: 'Тело' };

test('send без dedupe вставляет строку и делает eager-попытку', async () => {
  const { service, queries } = serviceWith([[[ID]], []]);

  const result = await service.send({ userId: ID, kind: 'test.kind', content: INLINE });

  assert.deepEqual(result, { id: ID });
  assert.equal(queries.length, 2);
  assert.match(queries[0].text, /^insert into "core"\."notification_outbox"/);
  assert.doesNotMatch(queries[0].text, /on conflict/);
  assert.match(queries[1].text, /^update "core"\."notification_outbox" set "status"/);
});

test('send с существующим dedupeKey возвращает существующий id без eager', async () => {
  const { service, queries } = serviceWith([[], [[ID]]]);

  const result = await service.send({ userId: ID, kind: 'test.kind', content: INLINE, dedupeKey: 'once' });

  assert.deepEqual(result, { id: ID });
  assert.equal(queries.length, 2);
  assert.match(queries[0].text, /on conflict do nothing/);
  assert.match(queries[1].text, /^select .* from "core"\."notification_outbox"/);
  // Последний параметр — LIMIT 1; drizzle передаёт его значением.
  assert.deepEqual(queries[1].values, ['test.kind', 'once', ID, 1]);
});

test('send с scheduledAt в будущем не запускает eager и ставит next_attempt_at', async () => {
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000);
  const { service, queries } = serviceWith([[[ID]]]);

  const result = await service.send({ userId: ID, kind: 'test.kind', content: INLINE, scheduledAt });

  assert.deepEqual(result, { id: ID });
  assert.equal(queries.length, 1);
  // timestamptz драйвер передаёт ISO-строкой.
  assert.ok(queries[0].values.some(value => value === scheduledAt.toISOString()));
});

test('countBatchOutcomes агрегирует исходы', () => {
  const counts = countBatchOutcomes(['queued', 'queued', 'skipped', 'failed', 'deduped', 'skipped']);
  assert.deepEqual(counts, { queued: 2, skipped: 2, failed: 1, deduped: 1 });
});

test('sendMany без шаблона не вставляет строк и считает skipped', async () => {
  const { service, queries } = serviceWith([[]]);
  const other = '00000000-0000-0000-0000-000000000002';

  const result = await service.sendMany({
    userIds: [ID, other],
    kind: 'admin.broadcast',
    content: { template: { code: 'missing.code' } },
  });

  assert.equal(typeof result.batchId, 'string');
  assert.deepEqual(
    { total: result.total, queued: result.queued, skipped: result.skipped, failed: result.failed, deduped: result.deduped },
    { total: 2, queued: 0, skipped: 2, failed: 0, deduped: 0 },
  );
  assert.equal(queries.length, 1);
});

test('listSenders объединяет имена каналов без дублей', () => {
  const { service } = serviceWith();
  service.registerChannel({ ...channel('a', 'x@y'), listSenders: () => ['no-reply', 'support'] });
  service.registerChannel({ ...channel('b', 'x@y'), listSenders: () => ['support'] });

  assert.deepEqual(service.listSenders(), ['no-reply', 'support']);
});

test('retryBatch переводит failed-строки батча в pending и возвращает счётчик', async () => {
  const { service, queries } = serviceWith([[[ID], [ID]]]);

  const retried = await service.retryBatch('00000000-0000-0000-0000-0000000000aa');

  assert.equal(retried, 2);
  assert.match(queries[0].text, /^update "core"\."notification_outbox"/);
  // SET-параметры идут перед WHERE: batch_id и 'failed' — в хвосте значений.
  assert.ok(queries[0].values.includes('00000000-0000-0000-0000-0000000000aa'));
  assert.ok(queries[0].values.includes('failed'));
});

/** Полная строка outbox в порядке колонок — для `.returning()` в claim'е deliver. */
function outboxRow(over: Record<string, unknown> = {}): unknown[] {
  const values: Record<string, unknown> = {
    id: ID,
    userId: ID,
    channel: 'test',
    kind: 'test.kind',
    address: 'user@example.com',
    subject: 'Тема',
    body: 'Тело',
    html: null,
    locale: null,
    batchId: null,
    dedupeKey: null,
    sender: null,
    replyTo: null,
    cc: null,
    bcc: null,
    headers: null,
    attachments: [],
    status: 'pending',
    attempts: 0,
    maxAttempts: 5,
    nextAttemptAt: new Date(),
    lastError: null,
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
  return Object.keys(getTableColumns(notificationOutbox)).map(key => values[key]);
}

function captureService(responses: unknown[][][] = []): {
  service: NotificationServiceImpl;
  queries: RecordedQuery[];
  captured: ResolvedNotification[];
  events: Array<{ type: string; payload: unknown }>;
} {
  const { db, queries } = recordingDb(responses);
  const captured: ResolvedNotification[] = [];
  const events: Array<{ type: string; payload: unknown }> = [];
  const eventBus = {
    emit: (type: string, payload: unknown) => {
      events.push({ type, payload });
    },
  } as unknown as EventBus;
  const service = new NotificationServiceImpl({ db, eventBus });
  service.registerChannel({
    id: 'test',
    resolveAddress: async () => 'user@example.com',
    send: async message => {
      captured.push(message);
    },
  });
  return { service, queries, captured, events };
}

test('deliver: claim не задел строку — письмо не отправляется', async () => {
  const { service, queries, captured } = captureService([[]]);

  await service.deliver(ID);

  assert.equal(queries.length, 1);
  assert.equal(captured.length, 0);
});

test('deliver: конверты уходят каналу, строка помечается sent, событие эмитится', async () => {
  const row = outboxRow({ sender: 'no-reply', replyTo: 'r@b', cc: ['c@b'], bcc: ['h@b'], headers: { 'X-Test': '1' } });
  const { service, queries, captured, events } = captureService([[row]]);

  await service.deliver(ID);

  assert.equal(captured.length, 1);
  assert.equal(captured[0].sender, 'no-reply');
  assert.equal(captured[0].replyTo, 'r@b');
  assert.deepEqual(captured[0].cc, ['c@b']);
  assert.deepEqual(captured[0].bcc, ['h@b']);
  assert.deepEqual(captured[0].headers, { 'X-Test': '1' });
  assert.match(queries[1].text, /^update "core"\."notification_outbox" set "status"/);
  assert.ok(queries[1].values.includes('sent'));
  assert.deepEqual(events.map(e => e.type), ['notification.delivery.sent']);
});

test('deliver: ошибка канала на последней попытке → failed и событие', async () => {
  const row = outboxRow({ attempts: 4, maxAttempts: 5 });
  const { db, queries } = recordingDb([[row], []]);
  const events: Array<{ type: string; payload: unknown }> = [];
  const eventBus = {
    emit: (type: string, payload: unknown) => {
      events.push({ type, payload });
    },
  } as unknown as EventBus;
  const service = new NotificationServiceImpl({ db, eventBus });
  service.registerChannel({
    id: 'test',
    resolveAddress: async () => 'user@example.com',
    send: async () => {
      throw new Error('SMTP отбил');
    },
  });

  await service.deliver(ID);

  assert.ok(queries[1].values.includes('failed'));
  assert.deepEqual(events.map(e => e.type), ['notification.delivery.failed']);
});

test('requeueStaleSending чинит зависшие sending двумя ветками', async () => {
  const { service, queries } = captureService([[], []]);

  await service.requeueStaleSending();

  assert.equal(queries.length, 2);
  assert.match(queries[0].text, /^update "core"\."notification_outbox"/);
  assert.ok(queries[0].values.includes('pending'));
  assert.ok(queries[1].values.includes('failed'));
});

test('retry: false без failed-строки, true когда строка переведена', async () => {
  const miss = captureService([[]]);
  assert.equal(await miss.service.retry(ID), false);

  const hit = captureService([[[ID]]]);
  assert.equal(await hit.service.retry(ID), true);
});

test('cleanupOld(force) удаляет старые sent/failed', async () => {
  const { service, queries } = captureService([[[ID]]]);

  await service.cleanupOld(true);

  assert.match(queries[0].text, /^delete from "core"\."notification_outbox"/);
});
