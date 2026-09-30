import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { NOTIFICATION_ATTACHMENT_LIMITS, type ResolvedNotification } from '@amplicada/platform-core/contracts';
import type { BackendDbService, BackendStorageService } from '@amplicada/platform-core/contracts/backend';
import type { Transporter } from 'nodemailer';
import { EmailChannel, readSendersConfig, type SenderConfig, selectSender } from './email-channel.js';

interface SentMail {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  headers?: Record<string, string>;
  attachments?: Array<{ filename?: string; contentType?: string; content?: unknown }>;
}

function fakeTransport(): { transport: Transporter; sent: SentMail[] } {
  const sent: SentMail[] = [];
  const transport = {
    sendMail: async (options: SentMail) => {
      sent.push(options);
    },
  } as unknown as Transporter;
  return { transport, sent };
}

const db = {} as BackendDbService;

/** Хранилище-заглушка: известные ключи отдаются, неизвестные — null (пропавший объект). */
function fakeStorage(objects: Record<string, { size: number; contentType?: string } | undefined> = {}): BackendStorageService {
  return {
    headObject: async (key: string) => {
      const info = objects[key];
      return info ? { key, size: info.size, contentType: info.contentType } : null;
    },
    getObjectStream: async (key: string) => ({
      body: Readable.from([`data:${key}`]),
      contentType: objects[key]?.contentType,
    }),
  } as unknown as BackendStorageService;
}

function channelWith(
  storage: BackendStorageService,
  senders: Record<string, SenderConfig> = {},
): { channel: EmailChannel; sent: SentMail[] } {
  const { transport, sent } = fakeTransport();
  return { channel: new EmailChannel(db, transport, 'D <d@b>', senders, storage), sent };
}

function message(over: Partial<ResolvedNotification> = {}): ResolvedNotification {
  return {
    deliveryId: 'd1',
    userId: 'u1',
    kind: 'test.kind',
    channel: 'email',
    address: 'user@example.com',
    subject: 'Тема',
    body: 'Тело',
    ...over,
  };
}

test('readSendersConfig парсит карту и пропускает записи без from', () => {
  const senders = readSendersConfig({
    SMTP_SENDERS: JSON.stringify({
      'no-reply': { from: 'A <a@b>' },
      broken: { replyTo: 'x@y' },
      support: { from: 'S <s@b>', replyTo: 'r@b' },
    }),
  });
  assert.deepEqual(senders, {
    'no-reply': { from: 'A <a@b>' },
    support: { from: 'S <s@b>', replyTo: 'r@b' },
  });
});

test('readSendersConfig: пусто или битый JSON → {}', () => {
  assert.deepEqual(readSendersConfig({}), {});
  assert.deepEqual(readSendersConfig({ SMTP_SENDERS: '{oops' }), {});
});

test('selectSender: известное имя, неизвестное и пустое', () => {
  const senders: Record<string, SenderConfig> = { 'no-reply': { from: 'A <a@b>' } };
  assert.deepEqual(selectSender(senders, 'no-reply'), { from: 'A <a@b>' });
  assert.equal(selectSender(senders, 'ghost'), null);
  assert.equal(selectSender(senders, undefined), null);
});

test('send: конверты уходят в sendMail', async () => {
  const { transport, sent } = fakeTransport();
  const channel = new EmailChannel(db, transport, 'D <d@b>', { 'no-reply': { from: 'N <n@b>', replyTo: 'r@b' } }, fakeStorage({}));

  await channel.send(message({ sender: 'no-reply', cc: ['c@b'], bcc: ['h@b'], headers: { 'X-Test': '1' } }));

  assert.equal(sent[0].from, 'N <n@b>');
  assert.equal(sent[0].replyTo, 'r@b');
  assert.deepEqual(sent[0].cc, ['c@b']);
  assert.deepEqual(sent[0].bcc, ['h@b']);
  assert.deepEqual(sent[0].headers, { 'X-Test': '1' });
});

test('send: явный replyTo сообщения приоритетнее sender', async () => {
  const { transport, sent } = fakeTransport();
  const channel = new EmailChannel(db, transport, 'D <d@b>', { 'no-reply': { from: 'N <n@b>', replyTo: 'r@b' } }, fakeStorage({}));

  await channel.send(message({ sender: 'no-reply', replyTo: 'explicit@b' }));

  assert.equal(sent[0].replyTo, 'explicit@b');
});

test('send: неизвестный sender → дефолтный from', async () => {
  const { transport, sent } = fakeTransport();
  const channel = new EmailChannel(db, transport, 'D <d@b>', { 'no-reply': { from: 'N <n@b>' } }, fakeStorage({}));

  await channel.send(message({ sender: 'ghost' }));

  assert.equal(sent[0].from, 'D <d@b>');
});

test('listSenders отдаёт имена из конфига по алфавиту', () => {
  const channel = new EmailChannel(db, fakeTransport().transport, 'D <d@b>', {
    support: { from: 's@b' },
    'no-reply': { from: 'n@b' },
  }, fakeStorage({}));

  assert.deepEqual(channel.listSenders(), ['no-reply', 'support']);
});

test('send: пропавший объект вложения → ошибка доставки', async () => {
  const { channel } = channelWith(fakeStorage({}));

  await assert.rejects(
    () => channel.send(message({ attachments: [{ storageKey: 'missing', filename: 'f.txt' }] })),
    /Вложение не найдено/,
  );
});

test('send: файл больше 10 МиБ → ошибка лимита', async () => {
  const { channel } = channelWith(fakeStorage({ big: { size: NOTIFICATION_ATTACHMENT_LIMITS.maxFileBytes + 1 } }));

  await assert.rejects(
    () => channel.send(message({ attachments: [{ storageKey: 'big', filename: 'big.bin' }] })),
    /10 МиБ/,
  );
});

test('send: сумма вложений больше 20 МиБ → ошибка лимита', async () => {
  const ten = NOTIFICATION_ATTACHMENT_LIMITS.maxFileBytes;
  const { channel } = channelWith(
    fakeStorage({
      a: { size: ten },
      b: { size: ten },
      c: { size: ten },
    }),
  );

  await assert.rejects(
    () =>
      channel.send(
        message({
          attachments: [
            { storageKey: 'a', filename: 'a.bin' },
            { storageKey: 'b', filename: 'b.bin' },
            { storageKey: 'c', filename: 'c.bin' },
          ],
        }),
      ),
    /20 МиБ/,
  );
});

test('send: вложения уходят стримом с filename/contentType', async () => {
  const { channel, sent } = channelWith(fakeStorage({ doc: { size: 100, contentType: 'application/pdf' } }));

  await channel.send(message({ attachments: [{ storageKey: 'doc', filename: 'report.pdf' }] }));

  assert.equal(sent[0].attachments?.[0].filename, 'report.pdf');
  assert.equal(sent[0].attachments?.[0].contentType, 'application/pdf');
  assert.ok(sent[0].attachments?.[0].content instanceof Readable);
});
