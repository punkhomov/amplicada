import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupportMessageDto } from '../../../../contracts/index.js';
import { groupMessages } from './grouping.js';

function message(id: string, authorRole: SupportMessageDto['authorRole']): SupportMessageDto {
  return { id, authorRole, authorId: null, authorLogin: null, body: id, attachment: null, createdAt: new Date().toISOString() };
}

test('одиночное сообщение — single', () => {
  const grouped = groupMessages([message('a', 'user')]);
  assert.deepEqual(
    grouped.map(item => [item.message.id, item.position, item.groupStart]),
    [['a', 'single', true]],
  );
});

test('подряд идущие сообщения одной роли схлопываются в группу', () => {
  const grouped = groupMessages([
    message('a', 'user'),
    message('b', 'user'),
    message('c', 'user'),
    message('d', 'admin'),
    message('e', 'admin'),
    message('f', 'user'),
  ]);

  assert.deepEqual(
    grouped.map(item => [item.message.id, item.position]),
    [
      ['a', 'first'],
      ['b', 'middle'],
      ['c', 'last'],
      ['d', 'first'],
      ['e', 'last'],
      ['f', 'single'],
    ],
  );
});

test('groupStart отмечает первое сообщение каждой группы', () => {
  const grouped = groupMessages([message('a', 'user'), message('b', 'user'), message('c', 'ai'), message('d', 'user')]);
  assert.deepEqual(
    grouped.map(item => item.groupStart),
    [true, false, true, true],
  );
});
