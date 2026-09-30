import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpolate, renderContent } from './notification-render.js';

test('{{user.name}} подставляется по dot-path', () => {
  const { value, missing } = interpolate('Привет, {{user.name}}!', { user: { name: 'Иван' } });
  assert.equal(value, 'Привет, Иван!');
  assert.deepEqual(missing, []);
});

test('отсутствующий путь → пустая строка и missing', () => {
  const { value, missing } = interpolate('x{{a.b}}y', {});
  assert.equal(value, 'xy');
  assert.deepEqual(missing, ['a.b']);
});

test('null и undefined считаются отсутствующими', () => {
  const { value, missing } = interpolate('{{a}}|{{b}}', { a: null, b: undefined });
  assert.equal(value, '|');
  assert.deepEqual(missing, ['a', 'b']);
});

test('примитивы приводятся к строке', () => {
  const { value } = interpolate('{{n}}/{{t}}', { n: 42, t: false });
  assert.equal(value, '42/false');
});

test('объекты сериализуются в JSON', () => {
  const { value } = interpolate('{{o}}', { o: { a: 1 } });
  assert.equal(value, '{"a":1}');
});

test('escapeHtml экранирует только подстановки', () => {
  const { value } = interpolate('<b>{{x}}</b>', { x: `<a href="1">'&` }, { escapeHtml: true });
  assert.equal(value, '<b>&lt;a href=&quot;1&quot;&gt;&#39;&amp;</b>');
});

test('renderContent не экранирует subject/body, но экранирует html', () => {
  const out = renderContent({ subject: '{{x}}', body: '{{x}}', html: '<p>{{x}}</p>' }, { x: '<i>' });
  assert.equal(out.subject, '<i>');
  assert.equal(out.body, '<i>');
  assert.equal(out.html, '<p>&lt;i&gt;</p>');
});

test('renderContent собирает missing по всем частям без дублей', () => {
  const out = renderContent({ subject: '{{a}}', body: '{{a}} {{b}}', html: '{{c}}' }, {});
  assert.deepEqual(out.missing, ['a', 'b', 'c']);
});
