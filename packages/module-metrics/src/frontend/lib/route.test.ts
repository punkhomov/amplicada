import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeRoute } from './route.js';

test('UUID и числовые сегменты превращаются в :id', () => {
  assert.equal(normalizeRoute('/support/2f1c4c1e-9f0e-4b7a-8c3d-1234567890ab'), '/support/:id');
  assert.equal(normalizeRoute('/admin/apps/42'), '/admin/apps/:id');
  assert.equal(normalizeRoute('/posts/deadbeefdeadbeef'), '/posts/:id');
});

test('статические сегменты сохраняются', () => {
  assert.equal(normalizeRoute('/support/new'), '/support/new');
  assert.equal(normalizeRoute('/admin/apps/support-chat'), '/admin/apps/support-chat');
  assert.equal(normalizeRoute('/'), '/');
});
