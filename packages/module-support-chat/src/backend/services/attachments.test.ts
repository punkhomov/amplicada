import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAttachmentKey,
  isAttachmentKeyAllowed,
  parseAttachmentInput,
  sanitizeAttachmentName,
  userAttachmentPrefix,
} from './attachments.js';

describe('sanitizeAttachmentName', () => {
  it('оставляет только последний сегмент пути', () => {
    assert.equal(sanitizeAttachmentName('C:\\Users\\me\\report final.pdf'), 'report final.pdf');
    assert.equal(sanitizeAttachmentName('/tmp/../../etc/passwd'), 'passwd');
  });

  it('вырезает управляющие символы и ограничивает длину', () => {
    assert.equal(sanitizeAttachmentName('a\u0000b\u001fc<d>e:f"g|h?i*j.txt'), 'abcdefghij.txt');
    assert.equal(sanitizeAttachmentName('x'.repeat(300))?.length, 200);
  });

  it('отвергает пустое имя и точки', () => {
    assert.equal(sanitizeAttachmentName(undefined), null);
    assert.equal(sanitizeAttachmentName('   '), null);
    assert.equal(sanitizeAttachmentName('.'), null);
    assert.equal(sanitizeAttachmentName('..'), null);
  });
});

describe('buildAttachmentKey', () => {
  it('сохраняет расширение в нижнем регистре', () => {
    assert.equal(buildAttachmentKey('support-chat/u1', 'abc', 'Photo.PNG'), 'support-chat/u1/abc.png');
  });

  it('не тащит имя файла без расширения и отвергает слишком длинное', () => {
    assert.equal(buildAttachmentKey('support-chat/u1', 'abc', 'README'), 'support-chat/u1/abc');
    assert.equal(buildAttachmentKey('support-chat/u1', 'abc', 'file.superlongextension'), 'support-chat/u1/abc');
  });
});

describe('isAttachmentKeyAllowed', () => {
  const userId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const otherId = 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
  const key = buildAttachmentKey(userAttachmentPrefix(userId), 'a1b2c3d4-0000-0000-0000-000000000000', 'x.png');

  it('пропускает ключ своего префикса', () => {
    assert.ok(isAttachmentKeyAllowed(key, [userAttachmentPrefix(userId)]));
  });

  it('отвергает чужой префикс, вложенность и обход путей', () => {
    assert.equal(isAttachmentKeyAllowed(key, [userAttachmentPrefix(otherId)]), false);
    assert.equal(isAttachmentKeyAllowed(`support-chat/${otherId}/../${userId}/x`, [userAttachmentPrefix(userId)]), false);
    assert.equal(isAttachmentKeyAllowed(`${userAttachmentPrefix(userId)}/nested/abc.png`, [userAttachmentPrefix(userId)]), false);
    assert.equal(isAttachmentKeyAllowed(`${userAttachmentPrefix(userId)}/not-a-uuid.png`, [userAttachmentPrefix(userId)]), false);
  });
});

describe('parseAttachmentInput', () => {
  const valid = { key: 'support-chat/u1/abc.png', name: 'pic.png', mime: 'image/png', size: 1024 };

  it('разбирает корректное вложение', () => {
    assert.deepEqual(parseAttachmentInput(valid), valid);
    assert.deepEqual(parseAttachmentInput({ ...valid, size: 10.6 })?.size, 11);
  });

  it('подставляет mime по умолчанию', () => {
    assert.equal(parseAttachmentInput({ ...valid, mime: '' })?.mime, 'application/octet-stream');
  });

  it('отвергает неполные и подделанные объекты', () => {
    assert.equal(parseAttachmentInput(null), null);
    assert.equal(parseAttachmentInput('file'), null);
    assert.equal(parseAttachmentInput({ ...valid, key: undefined }), null);
    assert.equal(parseAttachmentInput({ ...valid, name: '' }), null);
    assert.equal(parseAttachmentInput({ ...valid, size: -1 }), null);
    assert.equal(parseAttachmentInput({ ...valid, size: Number.NaN }), null);
    assert.equal(parseAttachmentInput({ ...valid, size: 11 * 1024 * 1024 }), null);
  });
});
