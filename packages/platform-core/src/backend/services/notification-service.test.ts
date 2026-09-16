import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NotificationChannel } from '../../contracts/notification.js';
import { BACKOFF_CAP_MS, backoffDelayMs, pickChannel } from './notification-service.js';

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
