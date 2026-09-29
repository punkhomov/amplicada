import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileKindOf } from './file-kind.js';

test('docx → word', () => assert.equal(fileKindOf({ name: 'contract.docx' }), 'word'));
test('docm → word', () => assert.equal(fileKindOf({ name: 'form.docm' }), 'word'));
test('xlsx → spreadsheet', () => assert.equal(fileKindOf({ name: 'budget.xlsx' }), 'spreadsheet'));
test('xlsm → spreadsheet', () => assert.equal(fileKindOf({ name: 'macro.xlsm' }), 'spreadsheet'));
test('mime важнее расширения', () =>
  assert.equal(fileKindOf({ name: 'x', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'spreadsheet'));
test('устаревшие .doc/.xls остаются other (не OOXML)', () => {
  assert.equal(fileKindOf({ name: 'old.doc' }), 'other');
  assert.equal(fileKindOf({ name: 'old.xls' }), 'other');
});
