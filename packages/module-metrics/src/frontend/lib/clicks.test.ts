import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractClickAttributes, isValidMetricEventName } from './clicks.js';

test('собирает только data-metrics-* и обрезает значения', () => {
  const attributes = extractClickAttributes([
    { name: 'class', value: 'btn' },
    { name: 'data-metrics', value: 'ui.click.export' },
    { name: 'data-metrics-format', value: 'csv' },
    { name: 'data-metrics-long', value: 'x'.repeat(400) },
  ]);
  assert.deepEqual(Object.keys(attributes).sort(), ['format', 'long']);
  assert.equal(attributes.format, 'csv');
  assert.equal(attributes.long.length, 256);
});

test('имена событий: только точечная нотация в lower_snake', () => {
  assert.equal(isValidMetricEventName('ui.click.support_send'), true);
  assert.equal(isValidMetricEventName('ui.click'), true);
  assert.equal(isValidMetricEventName('singleword'), false);
  assert.equal(isValidMetricEventName('Bad.Name'), false);
  assert.equal(isValidMetricEventName(null), false);
});

test('пустой ключ и слишком длинный ключ игнорируются', () => {
  const attributes = extractClickAttributes([
    { name: 'data-metrics-', value: 'no' },
    { name: `data-metrics-${'k'.repeat(70)}`, value: 'no' },
  ]);
  assert.deepEqual(attributes, {});
});
