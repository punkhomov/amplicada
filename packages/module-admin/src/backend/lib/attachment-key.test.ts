import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAttachmentKey } from './attachment-key.js';

const TEMPLATE_ID = '00000000-0000-0000-0000-000000000001';

test('ключ: notification-templates/<id>/<uuid>-<safe-name>', () => {
  const key = buildAttachmentKey(TEMPLATE_ID, 'report.pdf');
  assert.match(key, new RegExp(`^notification-templates/${TEMPLATE_ID}/[0-9a-f-]{36}-report\\.pdf$`));
});

test('basename: пути не проходят', () => {
  assert.ok(buildAttachmentKey(TEMPLATE_ID, '../../etc/passwd').endsWith('-passwd'));
  assert.ok(buildAttachmentKey(TEMPLATE_ID, '/etc/shadow').endsWith('-shadow'));
  assert.ok(!buildAttachmentKey(TEMPLATE_ID, '../../etc/passwd').includes('..'));
});

test('спецсимволы заменяются, пробелы/скобки/дефис сохраняются', () => {
  const key = buildAttachmentKey(TEMPLATE_ID, 'отчёт (v2) — копия!.docx');
  assert.match(key, /^notification-templates\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[^/]+\.docx$/);
  assert.ok(!key.includes('!'));
  assert.ok(key.includes('(v2)'));
  assert.ok(key.includes(' '));
});

test('пустое имя → file', () => {
  assert.ok(buildAttachmentKey(TEMPLATE_ID, '').endsWith('-file'));
});
