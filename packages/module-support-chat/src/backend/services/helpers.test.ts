import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canUserSetStatus,
  collectParticipants,
  countUnread,
  lifecyclePatch,
  previewMessage,
  previewText,
  statusAfterAdminMessage,
  statusAfterUserMessage,
} from './helpers.js';

const base = new Date('2026-09-17T10:00:00Z');
const earlier = new Date('2026-09-17T09:00:00Z');
const later = new Date('2026-09-17T11:00:00Z');

test('statusAfterUserMessage переоткрывает любое закрытое состояние', () => {
  assert.equal(statusAfterUserMessage('closed'), 'open');
  assert.equal(statusAfterUserMessage('solved'), 'open');
  assert.equal(statusAfterUserMessage('pending'), 'open');
  assert.equal(statusAfterUserMessage('open'), 'open');
});

test('statusAfterAdminMessage переоткрывает решённое и закрытое, pending не трогает', () => {
  assert.equal(statusAfterAdminMessage('solved'), 'open');
  assert.equal(statusAfterAdminMessage('closed'), 'open');
  assert.equal(statusAfterAdminMessage('pending'), 'pending');
  assert.equal(statusAfterAdminMessage('open'), 'open');
});

test('canUserSetStatus: закрыть можно не из closed, переоткрыть — только не из open', () => {
  assert.equal(canUserSetStatus('open', 'closed'), true);
  assert.equal(canUserSetStatus('pending', 'closed'), true);
  assert.equal(canUserSetStatus('solved', 'closed'), true);
  assert.equal(canUserSetStatus('closed', 'closed'), false);
  assert.equal(canUserSetStatus('closed', 'open'), true);
  assert.equal(canUserSetStatus('solved', 'open'), true);
  assert.equal(canUserSetStatus('open', 'open'), false);
});

test('lifecyclePatch фиксирует решение и закрытие, возврат в работу очищает', () => {
  const now = new Date('2026-09-18T10:00:00Z');
  const earlier = new Date('2026-09-17T09:00:00Z');

  assert.deepEqual(lifecyclePatch({ status: 'open', resolvedAt: null }, 'solved', 'admin', null, now), {
    status: 'solved',
    resolvedBy: 'admin',
    closeReason: null,
    resolvedAt: now,
    closedAt: null,
  });

  assert.deepEqual(lifecyclePatch({ status: 'open', resolvedAt: null }, 'closed', 'user', 'not_relevant', now), {
    status: 'closed',
    resolvedBy: 'user',
    closeReason: 'not_relevant',
    resolvedAt: now,
    closedAt: now,
  });

  // Закрываем уже решённое — дата решения сохраняется.
  assert.deepEqual(lifecyclePatch({ status: 'solved', resolvedAt: earlier }, 'closed', 'admin', null, now), {
    status: 'closed',
    resolvedBy: 'admin',
    closeReason: 'resolved',
    resolvedAt: earlier,
    closedAt: now,
  });

  assert.deepEqual(lifecyclePatch({ status: 'closed', resolvedAt: earlier }, 'open', 'user', null, now), {
    status: 'open',
    resolvedBy: null,
    closeReason: null,
    resolvedAt: null,
    closedAt: null,
  });
});

test('countUnread считает только сообщения собеседника после отметки прочтения', () => {
  const messages = [
    { authorRole: 'user' as const, createdAt: earlier },
    { authorRole: 'admin' as const, createdAt: earlier },
    { authorRole: 'admin' as const, createdAt: later },
  ];

  assert.equal(countUnread(messages, 'user', base), 1);
  assert.equal(countUnread(messages, 'admin', base), 0);
});

test('countUnread без отметки прочтения считает все сообщения собеседника', () => {
  const messages = [
    { authorRole: 'admin' as const, createdAt: earlier },
    { authorRole: 'admin' as const, createdAt: later },
    { authorRole: 'user' as const, createdAt: later },
  ];

  assert.equal(countUnread(messages, 'user', null), 2);
});

test('countUnread считает ai непрочитанным для пользователя, но не для поддержки', () => {
  const messages = [
    { authorRole: 'ai' as const, createdAt: later },
    { authorRole: 'user' as const, createdAt: later },
  ];

  assert.equal(countUnread(messages, 'user', null), 1);
  assert.equal(countUnread(messages, 'admin', null), 1);
});

test('statusAfterUserMessage переоткрывает закрытый тред', () => {
  assert.equal(statusAfterUserMessage('closed'), 'open');
  assert.equal(statusAfterUserMessage('open'), 'open');
});

test('previewText схлопывает пробелы и обрезает длинный текст', () => {
  assert.equal(previewText('  привет\n\n  мир  '), 'привет мир');

  const preview = previewText('a'.repeat(200), 20);
  assert.equal(preview.length, 20);
  assert.ok(preview.endsWith('…'));
});

test('previewMessage падает на имя вложения, когда текста нет', () => {
  assert.equal(previewMessage('привет', null), 'привет');
  assert.equal(previewMessage('   ', 'file.png'), 'file.png');
  assert.equal(previewMessage('', null), '');
});

test('collectParticipants собирает логины поддержки по порядку и без дублей', () => {
  const messages = [
    { authorRole: 'user' as const, authorLogin: 'petya' },
    { authorRole: 'admin' as const, authorLogin: 'ivan' },
    { authorRole: 'admin' as const, authorLogin: 'ivan' },
    { authorRole: 'ai' as const, authorLogin: null },
    { authorRole: 'admin' as const, authorLogin: 'olga' },
  ];

  assert.deepEqual(collectParticipants(messages), ['ivan', 'olga']);
  assert.deepEqual(collectParticipants([]), []);
});
