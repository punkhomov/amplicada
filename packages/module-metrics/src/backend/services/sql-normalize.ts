import { createHash } from 'node:crypto';

const MAX_TEXT_LENGTH = 2000;
const PARAM_PLACEHOLDER = '\u0000';
const PARAM_RE = /\$\d+/g;
const STRING_LITERAL_RE = /'(?:[^']|'')*'/g;
const NUMBER_RE = /(?<![\w$\u0000])\d+(?:\.\d+)?/g;
const IN_QUESTION_RE = /\(\s*\?(?:\s*,\s*\?)+\)/g;
const IN_PARAM_RE = /\(\s*\$\d+(?:\s*,\s*\$\d+)+\)/g;

/**
 * Нормализует SQL для хранения в метриках: литералы → `?`, схлопывание whitespace,
 * свёртка `IN (?, ?, ?)`. Параметры `$n` сохраняются.
 */
export function normalizeSql(sql: string): string {
  const protectedParams = sql.replace(PARAM_RE, match => `${PARAM_PLACEHOLDER}${match.slice(1)}${PARAM_PLACEHOLDER}`);
  const withoutStrings = protectedParams.replace(STRING_LITERAL_RE, '?');
  const withoutNumbers = withoutStrings.replace(NUMBER_RE, '?');
  const restoredParams = withoutNumbers.replace(
    new RegExp(`${PARAM_PLACEHOLDER}(\\d+)${PARAM_PLACEHOLDER}`, 'g'),
    (_, index: string) => `$${index}`,
  );
  const folded = restoredParams.replace(IN_QUESTION_RE, '(?)').replace(IN_PARAM_RE, '($1)');
  return folded.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

export interface SqlFingerprint {
  fingerprint: string;
  normalized: string;
}

export function fingerprintSql(sql: string): SqlFingerprint {
  const normalized = normalizeSql(sql);
  return {
    normalized,
    fingerprint: createHash('sha256').update(normalized).digest('hex'),
  };
}

/** Запросы самого модуля метрик не инструментируются — иначе обратная связь и шум. */
export function isMetricsInternalSql(sql: string): boolean {
  return sql.includes('metrics.') || sql.includes('"metrics"');
}
