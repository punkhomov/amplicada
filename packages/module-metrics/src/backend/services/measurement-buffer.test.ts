import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashDims, MeasurementBuffer, type MeasurementSeries } from './measurement-buffer.js';

const series = (dims: Record<string, string> = { route: '/a' }): MeasurementSeries => ({
  instrument: 'http.server.request.duration',
  kind: 'histogram',
  unit: 's',
  dims,
});

test('hashDims не зависит от порядка ключей', () => {
  assert.equal(hashDims({ a: '1', b: '2' }), hashDims({ b: '2', a: '1' }));
  assert.notEqual(hashDims({ a: '1' }), hashDims({ a: '2' }));
});

test('буфер агрегирует окно: count/sum/min/max и гистограмма', () => {
  const buffer = new MeasurementBuffer(10_000);
  const at = 1_000_000;
  buffer.record(series(), 0.05, at);
  buffer.record(series(), 0.2, at + 100);
  buffer.record(series({ route: '/b' }), 1.5, at);

  const points = buffer.drain();
  assert.equal(points.length, 2);
  const first = points.find(point => point.series.dims.route === '/a');
  assert.ok(first);
  assert.equal(first.count, 2);
  assert.ok(Math.abs(first.sum - 0.25) < 1e-9);
  assert.equal(first.min, 0.05);
  assert.equal(first.max, 0.2);
  assert.equal(
    first.histogram?.bucketCounts.reduce((total, count) => total + count, 0),
    2,
  );
  assert.equal(buffer.size(), 0);
});

test('cap серий сворачивает лишние измерения в overflow', () => {
  const buffer = new MeasurementBuffer(10_000, undefined, 2);
  buffer.record(series({ route: '/a' }), 0.1, 1_000_000);
  buffer.record(series({ route: '/b' }), 0.1, 1_000_000);
  buffer.record(series({ route: '/c' }), 0.1, 1_000_000);
  buffer.record(series({ route: '/d' }), 0.1, 1_000_000);

  const points = buffer.drain();
  const overflow = points.find(point => point.series.dims.__overflow === 'true');
  assert.ok(overflow);
  assert.equal(overflow.count, 2);
  assert.equal(buffer.overflowCount(), 2);

  // Новое окно снова даёт место обычным сериям.
  buffer.record(series({ route: '/e' }), 0.1, 1_010_000);
  assert.equal(buffer.drain().length, 1);
});

test('разные окна дают разные точки', () => {
  const buffer = new MeasurementBuffer(10_000);
  buffer.record(series(), 0.1, 1_000_000);
  buffer.record(series(), 0.1, 1_010_000);
  assert.equal(buffer.drain().length, 2);
});
