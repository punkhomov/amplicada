import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHistogram, histogramCount, mergeHistograms, percentileFromHistogram, recordHistogram } from './histogram.js';

test('recordHistogram раскладывает по бакетам, последний — +Inf', () => {
  const histogram = createHistogram([0.1, 1]);
  recordHistogram(histogram, 0.05);
  recordHistogram(histogram, 0.5);
  recordHistogram(histogram, 5);
  assert.deepEqual(histogram.bucketCounts, [1, 1, 1]);
  assert.equal(histogramCount(histogram), 3);
});

test('mergeHistograms складывает одинаковые формы и игнорирует разные', () => {
  const target = createHistogram([0.1, 1]);
  const source = createHistogram([0.1, 1]);
  recordHistogram(source, 0.05);
  mergeHistograms(target, source);
  assert.deepEqual(target.bucketCounts, [1, 0, 0]);

  const other = createHistogram([1, 2, 3]);
  recordHistogram(other, 1.5);
  mergeHistograms(target, other);
  assert.deepEqual(target.bucketCounts, [1, 0, 0]);
});

test('percentileFromHistogram интерполирует и уважает края', () => {
  const histogram = createHistogram([1, 2, 3, 4]);
  for (const value of [0.5, 1.5, 2.5, 3.5, 10]) recordHistogram(histogram, value);

  const p50 = percentileFromHistogram(histogram, 0.5);
  assert.ok(p50 !== null && p50 >= 1.5 && p50 <= 3.5, `p50=${p50}`);

  const p95 = percentileFromHistogram(histogram, 0.95);
  assert.ok(p95 !== null && p95 >= 4, `p95=${p95}`);

  assert.equal(percentileFromHistogram(createHistogram([1]), 0.5), null);
});
