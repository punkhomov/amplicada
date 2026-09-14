import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { S3Client } from '@aws-sdk/client-s3';
import { StorageServiceImpl } from './storage-service.js';

interface SentCommand {
  constructorName: string;
  input: Record<string, unknown>;
}

/** Клиент, отдающий заранее заготовленные ответы по очереди и запоминающий, с чем его звали. */
function fakeClient(responses: unknown[]): { client: S3Client; sent: SentCommand[] } {
  const sent: SentCommand[] = [];
  let i = 0;
  const client = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ constructorName: command.constructor.name, input: command.input });
      const response = responses[i++];
      if (response instanceof Error) throw response;
      return response;
    },
  } as unknown as S3Client;
  return { client, sent };
}

function page(keys: string[], nextToken?: string) {
  return {
    Contents: keys.map(key => ({ Key: key, Size: 1 })),
    IsTruncated: nextToken !== undefined,
    NextContinuationToken: nextToken,
  };
}

test('listObjects дочитывает все страницы, а не только первую', async () => {
  const { client, sent } = fakeClient([page(['a', 'b'], 'token-1'), page(['c', 'd'], 'token-2'), page(['e'])]);
  const storage = new StorageServiceImpl(client, 'bucket');

  const objects = await storage.listObjects('prefix/');

  assert.deepEqual(
    objects.map(o => o.key),
    ['a', 'b', 'c', 'd', 'e'],
  );
  assert.equal(sent.length, 3);
  // Первый вызов — без токена, последующие продолжают ровно с того, что вернул предыдущий.
  assert.equal(sent[0].input.ContinuationToken, undefined);
  assert.equal(sent[1].input.ContinuationToken, 'token-1');
  assert.equal(sent[2].input.ContinuationToken, 'token-2');
  // Префикс не теряется на страницах после первой.
  assert.ok(sent.every(s => s.input.Prefix === 'prefix/'));
});

test('listObjects не зацикливается, если S3 прислал токен при IsTruncated=false', async () => {
  const { client, sent } = fakeClient([{ Contents: [{ Key: 'a', Size: 1 }], IsTruncated: false, NextContinuationToken: 'ignored' }]);
  const storage = new StorageServiceImpl(client, 'bucket');

  const objects = await storage.listObjects();

  assert.equal(objects.length, 1);
  assert.equal(sent.length, 1);
});

test('listObjects переживает пустой ответ без Contents', async () => {
  const { client } = fakeClient([{ IsTruncated: false }]);
  const storage = new StorageServiceImpl(client, 'bucket');

  assert.deepEqual(await storage.listObjects(), []);
});

test('getObjectStream пробрасывает Range в S3 и отдаёт Content-Range наружу', async () => {
  const { client, sent } = fakeClient([
    {
      Body: Readable.from(['chunk']),
      ContentLength: 1024,
      ContentType: 'video/mp4',
      ContentRange: 'bytes 0-1023/98765',
    },
  ]);
  const storage = new StorageServiceImpl(client, 'bucket');

  const result = await storage.getObjectStream('video.mp4', { range: 'bytes=0-1023' });

  assert.equal(sent[0].input.Range, 'bytes=0-1023');
  assert.equal(result.contentRange, 'bytes 0-1023/98765');
  // contentLength — длина куска, а не всего объекта: именно её роут ставит в Content-Length.
  assert.equal(result.contentLength, 1024);
  assert.equal(result.contentType, 'video/mp4');
});

test('getObjectStream без range не шлёт Range и не выдумывает Content-Range', async () => {
  const { client, sent } = fakeClient([{ Body: Readable.from(['x']), ContentLength: 5 }]);
  const storage = new StorageServiceImpl(client, 'bucket');

  const result = await storage.getObjectStream('file.bin');

  assert.equal(sent[0].input.Range, undefined);
  assert.equal(result.contentRange, undefined);
});

test('диапазон вне размера объекта → ошибка с statusCode 416, а не 500', async () => {
  const invalidRange = Object.assign(new Error('The requested range is not satisfiable'), { name: 'InvalidRange' });
  const { client } = fakeClient([invalidRange]);
  const storage = new StorageServiceImpl(client, 'bucket');

  await assert.rejects(
    () => storage.getObjectStream('file.bin', { range: 'bytes=999999-' }),
    (err: Error & { statusCode?: number }) => err.statusCode === 416,
  );
});

test('putObjectStream передаёт длину — иначе SDK вычитает поток в память ради её подсчёта', async () => {
  const { client, sent } = fakeClient([{}]);
  const storage = new StorageServiceImpl(client, 'bucket');

  await storage.putObjectStream('learning/pkg/video.mp4', Readable.from(['data']), {
    contentLength: 4,
    contentType: 'video/mp4',
  });

  assert.equal(sent[0].constructorName, 'PutObjectCommand');
  assert.equal(sent[0].input.ContentLength, 4);
  assert.equal(sent[0].input.ContentType, 'video/mp4');
});

test('deletePrefix удаляет пачками по 1000, а не по одному ключу', async () => {
  const keys = Array.from({ length: 1500 }, (_, i) => `learning/pkg/file-${i}.html`);
  const { client, sent } = fakeClient([page(keys), {}, {}]);
  const storage = new StorageServiceImpl(client, 'bucket');

  assert.equal(await storage.deletePrefix('learning/pkg/'), 1500);

  const deletes = sent.filter(s => s.constructorName === 'DeleteObjectsCommand');
  assert.equal(deletes.length, 2, 'лимит DeleteObjects — 1000 ключей за запрос');
  assert.equal((deletes[0].input.Delete as { Objects: unknown[] }).Objects.length, 1000);
  assert.equal((deletes[1].input.Delete as { Objects: unknown[] }).Objects.length, 500);
});

test('deletePrefix не соглашается снести бакет целиком', async () => {
  const { client, sent } = fakeClient([]);
  const storage = new StorageServiceImpl(client, 'bucket');

  await assert.rejects(() => storage.deletePrefix(''), /непустой префикс/);
  assert.equal(sent.length, 0, 'до S3 такой вызов доходить не должен');
});

test('прочие ошибки S3 не превращаются в 416', async () => {
  const { client } = fakeClient([Object.assign(new Error('boom'), { name: 'NoSuchKey' })]);
  const storage = new StorageServiceImpl(client, 'bucket');

  await assert.rejects(
    () => storage.getObjectStream('missing'),
    (err: Error & { statusCode?: number }) => err.statusCode === undefined && err.name === 'NoSuchKey',
  );
});
