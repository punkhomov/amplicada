import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPgError, isPgErrorCode, mapDbError, PG_EXCLUSION_VIOLATION } from './db-errors.js';
import { DocumentRuntimeError } from './document-runtime-error.js';

/** Так выглядит ошибка драйвера `pg`, доехавшая до приложения: drizzle оборачивает её в DrizzleQueryError. */
function wrapped(code: string, extra: Record<string, unknown> = {}): Error {
  const driverError = Object.assign(new Error('driver error'), { code, ...extra });
  return Object.assign(new Error('Failed query: insert into ...'), { cause: driverError });
}

test('код драйвера достаётся из cause, а не с самой ошибки', () => {
  const err = wrapped('23505', { constraint: 'department_node_code_key' });
  assert.equal((err as { code?: string }).code, undefined, 'на верхнем уровне кода нет — в этом и была проблема');
  assert.equal(findPgError(err)?.code, '23505');
  assert.equal(findPgError(err)?.constraint, 'department_node_code_key');
});

test('код достаётся и с неупакованной ошибки (прямой вызов драйвера)', () => {
  assert.equal(findPgError(Object.assign(new Error('x'), { code: '23503' }))?.code, '23503');
});

test('обычная ошибка без кода не притворяется ошибкой БД', () => {
  assert.equal(findPgError(new Error('boom')), undefined);
  assert.equal(findPgError(undefined), undefined);
  assert.equal(findPgError(null), undefined);
});

test('самоссылающаяся цепочка cause не зацикливает обход', () => {
  const err = new Error('loop') as Error & { cause?: unknown };
  err.cause = err;
  assert.equal(findPgError(err), undefined);
});

test('23505 → 409 с человеческим текстом и именем констрейнта в details', () => {
  const mapped = mapDbError(wrapped('23505', { constraint: 'workflows_code_key' }), 'create');
  assert.ok(mapped instanceof DocumentRuntimeError);
  assert.equal(mapped.status, 409);
  assert.match(mapped.message, /уже существует/);
  assert.deepEqual(mapped.details, { pgCode: '23505', constraint: 'workflows_code_key' });
});

test('23502 → 400 с именем незаполненной колонки (это не конфликт, а кривой запрос)', () => {
  const mapped = mapDbError(wrapped('23502', { column: 'login', table: 'identity_user' }), 'create');
  assert.ok(mapped instanceof DocumentRuntimeError);
  assert.equal(mapped.status, 400);
  assert.match(mapped.message, /login/);
  assert.equal((mapped.details as { column?: string }).column, 'login');
});

test('23503 формулируется по операции: удаление vs запись', () => {
  const onDelete = mapDbError(wrapped('23503'), 'delete') as DocumentRuntimeError;
  const onCreate = mapDbError(wrapped('23503'), 'create') as DocumentRuntimeError;
  assert.equal(onDelete.status, 409);
  assert.equal(onCreate.status, 409);
  assert.match(onDelete.message, /используется/);
  assert.match(onCreate.message, /не существует/);
});

test('23P01 не перехватывается — его обрабатывает версионирование hr на своём уровне', () => {
  const err = wrapped(PG_EXCLUSION_VIOLATION);
  assert.equal(mapDbError(err, 'update'), err, 'ошибка должна вернуться той же самой');
  assert.ok(isPgErrorCode(err, PG_EXCLUSION_VIOLATION), 'но распознаваться — обязана');
});

test('ошибка не про констрейнты возвращается как есть', () => {
  const err = wrapped('42P01'); // undefined_table
  assert.equal(mapDbError(err, 'update'), err);
  const plain = new Error('boom');
  assert.equal(mapDbError(plain, 'create'), plain);
});
