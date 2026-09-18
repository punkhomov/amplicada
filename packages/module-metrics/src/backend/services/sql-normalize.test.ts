import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprintSql, isMetricsInternalSql, normalizeSql } from './sql-normalize.js';

test('литералы заменяются, $n сохраняются', () => {
  assert.equal(normalizeSql("select * from users where login = 'admin' and age > 42"), 'select * from users where login = ? and age > ?');
  assert.equal(normalizeSql('select * from t where a = $1 and b = $2'), 'select * from t where a = $1 and b = $2');
});

test('IN-списки свёртываются, идентификаторы с цифрами не трогаются', () => {
  assert.equal(normalizeSql('select 1 from t where id in (?, ?, ?)'), 'select ? from t where id in (?)');
  assert.equal(normalizeSql('select 1 from t where id in ($1, $2, $3)'), 'select ? from t where id in ($1)');
  assert.equal(normalizeSql('select col2 from table_3 where x = 1'), 'select col2 from table_3 where x = ?');
});

test('whitespace схлопывается, fingerprint стабилен и различает запросы', () => {
  const a = fingerprintSql('select   *\n from  t where id = 1');
  const b = fingerprintSql('select * from t where id = 2');
  assert.equal(a.normalized, 'select * from t where id = ?');
  assert.equal(a.fingerprint, b.fingerprint);

  const c = fingerprintSql('select * from t where id = 3 and x = 1');
  assert.notEqual(a.fingerprint, c.fingerprint);
});

test('запросы метрик распознаются как внутренние', () => {
  assert.equal(isMetricsInternalSql('insert into "metrics"."points" ...'), true);
  assert.equal(isMetricsInternalSql('select * from metrics.series'), true);
  assert.equal(isMetricsInternalSql('select * from core.identity_user'), false);
});
