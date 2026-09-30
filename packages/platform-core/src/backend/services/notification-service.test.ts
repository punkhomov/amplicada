import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { BackendDbService } from '../../contracts/backend/db.js';
import type { EventBus } from '../../contracts/event-bus.js';
import type { NotificationChannel } from '../../contracts/notification.js';
import { BACKOFF_CAP_MS, backoffDelayMs, NotificationServiceImpl, pickChannel } from './notification-service.js';

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
