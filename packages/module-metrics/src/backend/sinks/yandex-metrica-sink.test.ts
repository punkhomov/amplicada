import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SinkConfigRow } from '../schemas/index.js';
import type { SinkItem } from './sink.js';
import {
  buildMeasurementProtocolUrl,
  buildOfflineConversionsCsv,
  createYandexMetricaSink,
  parseYandexSettings,
  type YandexMetricaSettings,
} from './yandex-metrica-sink.js';

const settings: YandexMetricaSettings = { counterId: '12345678', goalMap: { 'support.thread.opened': 'GOAL1' } };

function item(overrides: Record<string, unknown>): SinkItem {
  return {
    id: 'evt-1',
    kind: 'event',
    payload: {
      name: 'support.thread.opened',
      occurredAt: '2026-09-18T12:00:00.000Z',
      actorHash: null,
      attributes: {},
      ...overrides,
    },
  };
}

function config(overrides: Record<string, unknown> = {}): SinkConfigRow {
  return {
    id: 'yandex-metrica',
    enabled: true,
    settings: { counterId: '12345678', goalMap: { 'support.thread.opened': 'GOAL1' }, ...overrides },
    mapping: {},
    updatedAt: new Date(),
  };
}

test('parseYandexSettings валидирует счётчик и карту целей', () => {
  assert.equal(parseYandexSettings({ counterId: 'abc' }), null);
  assert.deepEqual(parseYandexSettings({ counterId: '42', goalMap: { a: 'G1', b: 7 } }), {
    counterId: '42',
    goalMap: { a: 'G1' },
  });
});

test('Measurement Protocol строится только при ClientId и известной цели', () => {
  const withClient = item({ attributes: { 'yandex.client_id': '1690000000123456' } });
  const url = buildMeasurementProtocolUrl(withClient, settings, 'secret-token');
  assert.ok(url);
  const params = new URL(url).searchParams;
  assert.equal(params.get('tid'), '12345678');
  assert.equal(params.get('cid'), '1690000000123456');
  assert.equal(params.get('t'), 'event');
  assert.equal(params.get('ea'), 'GOAL1');
  assert.equal(params.get('et'), String(Math.floor(Date.parse('2026-09-18T12:00:00.000Z') / 1000)));
  assert.equal(params.get('ms'), 'secret-token');

  assert.equal(buildMeasurementProtocolUrl(item({ attributes: {} }), settings), null);
  assert.equal(buildMeasurementProtocolUrl(item({ name: 'unknown.event', attributes: { 'yandex.client_id': '1' } }), settings), null);
});

test('Offline Conversions CSV строится по псевдониму актора', () => {
  const csv = buildOfflineConversionsCsv(
    [item({ actorHash: 'pseudo-1' }), item({ actorHash: 'pseudo-2', attributes: { 'yandex.client_id': '1' } })],
    settings,
  );
  const lines = (csv ?? '').trim().split('\n');
  assert.equal(lines[0], 'UserId,Target,DateTime');
  assert.equal(lines[1], `pseudo-1,GOAL1,${Math.floor(Date.parse('2026-09-18T12:00:00.000Z') / 1000)}`);
  assert.equal(lines[2].startsWith('pseudo-2,GOAL1,'), true);
  assert.equal(buildOfflineConversionsCsv([item({ actorHash: null })], settings), null);
});

test('sanitizeSettings оставляет только валидные поля', () => {
  const sink = createYandexMetricaSink({ getSecret: () => undefined });
  assert.deepEqual(sink.sanitizeSettings?.({ counterId: '42', goalMap: { a: 'G1', b: 2 }, extra: true }), {
    counterId: '42',
    goalMap: { a: 'G1' },
  });
  assert.deepEqual(sink.sanitizeSettings?.({ counterId: 'nope' }), {});
});

test('send: MP-запросы и загрузка CSV вызываются по конфигу', async () => {
  const calls: { url: string; method: string }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response('ok', { status: 200 });
  }) as typeof fetch;

  const sink = createYandexMetricaSink({
    getSecret: name => (name === 'metrics.yandex_token' ? 'oauth-token' : undefined),
    fetchImpl,
  });

  const items = [item({ attributes: { 'yandex.client_id': 'cid-1' } }), item({ actorHash: 'pseudo-1' })];
  const result = await sink.send(items, config(), new AbortController().signal);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);

  const empty = await sink.send([item({})], config(), new AbortController().signal);
  assert.equal(empty.ok, false);
  assert.match(empty.error ?? '', /no sendable items/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /^https:\/\/mc\.yandex\.ru\/collect\?/);
  assert.equal(calls[1].method, 'POST');
  assert.match(calls[1].url, /offline_conversions\/upload/);
});
