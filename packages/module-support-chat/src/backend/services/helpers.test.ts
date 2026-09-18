import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectParticipants, countUnread, previewMessage, previewText, statusAfterUserMessage } from './helpers.js';

const base = new Date('2026-09-17T10:00:00Z');
const earlier = new Date('2026-09-17T09:00:00Z');
const later = new Date('2026-09-17T11:00:00Z');

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
