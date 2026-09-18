import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnvSecretsService, secretEnvName } from './secrets-service.js';

test('secretEnvName маппит неймспейсное имя в переменную окружения', () => {
  assert.equal(secretEnvName('metrics.pseudonym_salt'), 'AMPLICADA_METRICS_PSEUDONYM_SALT');
  assert.equal(secretEnvName('yandex-metrica.token'), 'AMPLICADA_YANDEX_METRICA_TOKEN');
});

test('get возвращает значение и undefined для пустого/отсутствующего', () => {
  const service = new EnvSecretsService();
  process.env.AMPLICADA_TEST_SECRET = 'value';
  try {
    assert.equal(service.get('test.secret'), 'value');
    assert.equal(service.get('test.missing'), undefined);
    process.env.AMPLICADA_TEST_SECRET = '';
    assert.equal(service.get('test.secret'), undefined);
  } finally {
    delete process.env.AMPLICADA_TEST_SECRET;
  }
});

test('require бросает с именем переменной', () => {
  const service = new EnvSecretsService();
  assert.throws(() => service.require('test.missing'), /AMPLICADA_TEST_MISSING/);
});
