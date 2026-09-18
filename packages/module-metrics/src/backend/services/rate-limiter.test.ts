import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IngestRateLimiter, type RateLimiterRedis } from './rate-limiter.js';

function fakeRedis(): RateLimiterRedis & { keys: Map<string, number> } {
  const keys = new Map<string, number>();
  return {
    keys,
    async incrBy(key, value) {
      const next = (keys.get(key) ?? 0) + value;
      keys.set(key, next);
      return next;
    },
    async expire() {
      return 1;
    },
  };
}

test('в пределах лимита — allowed, за лимитом — нет', async () => {
  const redis = fakeRedis();
  const limiter = new IngestRateLimiter(redis);
  const now = 1_000_000;

  const first = await limiter.consume('session-a', 3, 5, now);
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 2);

  const second = await limiter.consume('session-a', 2, 5, now);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);

  const third = await limiter.consume('session-a', 1, 5, now);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
  assert.ok(third.retryAfterSeconds >= 1 && third.retryAfterSeconds <= 60);
});

test('новое окно сбрасывает счётчик, ключи сессий не пересекаются', async () => {
  const redis = fakeRedis();
  const limiter = new IngestRateLimiter(redis);
  const start = 1_000_000;

  await limiter.consume('session-a', 5, 5, start);
  const nextWindow = await limiter.consume('session-a', 1, 5, start + 60_000);
  assert.equal(nextWindow.allowed, true);

  const other = await limiter.consume('session-b', 5, 5, start);
  assert.equal(other.allowed, true);
});

test('TTL ставится только на первый INCRBY окна', async () => {
  const redis = fakeRedis();
  const calls: string[] = [];
  const original = redis.expire;
  redis.expire = async (key, seconds) => {
    calls.push(key);
    return original(key, seconds);
  };
  const limiter = new IngestRateLimiter(redis);
  const now = 1_000_000;

  await limiter.consume('session-a', 1, 10, now);
  await limiter.consume('session-a', 1, 10, now);
  assert.equal(calls.length, 1);
});
