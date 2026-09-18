import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMetricsOptedOut, METRICS_OPT_OUT_KEY } from './optout.js';
import type { KeyValueStorage } from './session.js';

function storageWith(value: string | null): KeyValueStorage {
  return {
    getItem: () => value,
    setItem: () => undefined,
  };
}

test('opt-out по флагу, DNT и GPC', () => {
  assert.equal(isMetricsOptedOut({ storage: storageWith('1') }), true);
  assert.equal(isMetricsOptedOut({ storage: storageWith(null), doNotTrack: '1' }), true);
  assert.equal(isMetricsOptedOut({ globalPrivacyControl: true }), true);
  assert.equal(isMetricsOptedOut({ storage: storageWith('0'), doNotTrack: '0' }), false);
  assert.equal(isMetricsOptedOut({ storage: storageWith(null), doNotTrack: 'unspecified' }), false);
});

test('флаг хранится под стабильным ключом', () => {
  assert.equal(METRICS_OPT_OUT_KEY, 'metrics.optout');
});
