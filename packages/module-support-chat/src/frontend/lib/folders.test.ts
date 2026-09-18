import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupportAdminThreadDto } from '../../contracts/index.js';
import { folderCounts, matchesFolder } from './folders.js';

function thread(overrides: Partial<SupportAdminThreadDto>): SupportAdminThreadDto {
  return {
    id: 't',
    userId: 'u',
    userLogin: 'user',
    status: 'open',
    kind: 'question',
    severity: null,
    incidentThreadId: null,
    hasSupportReply: false,
    updatedAt: new Date().toISOString(),
    unreadCount: 0,
    lastMessagePreview: null,
    ...overrides,
  };
}

test('questions — нетронутые вопросы без инцидента и ответа поддержки', () => {
  assert.equal(matchesFolder(thread({}), 'questions'), true);
  assert.equal(matchesFolder(thread({ hasSupportReply: true }), 'questions'), false);
  assert.equal(matchesFolder(thread({ incidentThreadId: 'inc' }), 'questions'), false);
  assert.equal(matchesFolder(thread({ kind: 'incident' }), 'questions'), false);
});

test('requests — обычные обращения с участием поддержки или связанные с инцидентом', () => {
  assert.equal(matchesFolder(thread({ hasSupportReply: true }), 'requests'), true);
  assert.equal(matchesFolder(thread({ incidentThreadId: 'inc' }), 'requests'), true);
  assert.equal(matchesFolder(thread({}), 'requests'), false);
  assert.equal(matchesFolder(thread({ kind: 'incident' }), 'requests'), false);
});

test('incidents — только инциденты, all — всё', () => {
  assert.equal(matchesFolder(thread({ kind: 'incident' }), 'incidents'), true);
  assert.equal(matchesFolder(thread({}), 'incidents'), false);
  assert.equal(matchesFolder(thread({ kind: 'incident' }), 'all'), true);
});

test('folderCounts считает количество и непрочитанные', () => {
  const counts = folderCounts([
    thread({ id: 'q1', unreadCount: 2 }),
    thread({ id: 'r1', hasSupportReply: true, unreadCount: 1 }),
    thread({ id: 'i1', kind: 'incident', severity: 'high' }),
  ]);

  assert.deepEqual(counts.all, { total: 3, unread: 3 });
  assert.deepEqual(counts.questions, { total: 1, unread: 2 });
  assert.deepEqual(counts.requests, { total: 1, unread: 1 });
  assert.deepEqual(counts.incidents, { total: 1, unread: 0 });
});
