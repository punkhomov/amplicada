import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBytes } from './format.js';

test('байты остаются байтами', () => {
  assert.match(formatBytes(0), /^0/);
  assert.match(formatBytes(512), /^512/);
});

test('килобайты и мегабайты подбираются по величине', () => {
  // Разделитель дробной части и сокращение единицы зависят от локали — проверяем только число и то,
  // что единица вообще показана (для en это "KB", для ru — "КБ").
  assert.match(formatBytes(1024), /^1\D/);
  assert.match(formatBytes(1536), /^1[.,]5\D/);
  assert.match(formatBytes(5 * 1024 ** 2), /^5\D/);
});
