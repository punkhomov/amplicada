import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorFingerprint, normalizeErrorText, normalizeStackFrame } from './error-fingerprint.js';

test('normalizeErrorText убирает origin, query, числа и id', () => {
  const normalized = normalizeErrorText(
    'Failed to fetch https://api.example.com/users/42?token=secret for id 550e8400-e29b-41d4-a716-446655440000 after 3 retries',
  );
  assert.equal(normalized, 'Failed to fetch /users/<n> for id <id> after <n> retries');
});

test('кадры стека нормализуются без query и origin', () => {
  assert.equal(
    normalizeStackFrame('    at renderThread (http://localhost:5173/src/pages/thread.tsx?t=1:42:7)'),
    'renderThread@/src/pages/thread.tsx:42',
  );
  assert.equal(normalizeStackFrame('not a frame'), null);
});

test('fingerprint стабилен для одинаковых ошибок с разными данными', () => {
  const stack = 'Error: boom\n    at handler (/src/app.tsx:10:2)\n    at div (/src/list.tsx:4:1)';
  const a = errorFingerprint({ type: 'TypeError', message: 'Cannot read x of undefined 42', stack, route: '/support/:id' });
  const b = errorFingerprint({ type: 'TypeError', message: 'Cannot read x of undefined 77', stack, route: '/support/:id' });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.messageTemplate, 'Cannot read x of undefined <n>');
});

test('другой стек или маршрут — другой fingerprint', () => {
  const base = { type: 'Error', stack: 'Error: x\n    at a (/s/a.ts:1:1)', route: '/a' };
  const otherFrame = { ...base, stack: 'Error: x\n    at b (/s/b.ts:2:2)' };
  const otherRoute = { ...base, route: '/b' };
  assert.notEqual(errorFingerprint(base).fingerprint, errorFingerprint(otherFrame).fingerprint);
  assert.notEqual(errorFingerprint(base).fingerprint, errorFingerprint(otherRoute).fingerprint);
});
