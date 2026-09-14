/**
 * Трансляция ошибок драйвера `pg` в осмысленные ошибки рантайма. Живёт отдельным модулем (а не в
 * setErrorHandler конкретного приложения), потому что у DocumentRuntime есть потребители помимо
 * admin-роутов — свои роуты модулей и не-HTTP вызовы.
 */
import { DocumentRuntimeError } from './document-runtime-error.js';

/** SQLSTATE class 23 — integrity_constraint_violation. */
export const PG_NOT_NULL_VIOLATION = '23502';
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';
export const PG_EXCLUSION_VIOLATION = '23P01';

/** Поля ошибки драйвера, которые нам интересны. У `pg` их больше — берём только используемые. */
export interface PgDriverError {
  code: string;
  constraint?: string;
  detail?: string;
  table?: string;
  /** Заполняется для 23502 — имя колонки, оставшейся пустой. */
  column?: string;
}

/** Ограничитель обхода цепочки `cause` — на случай самоссылающейся ошибки. */
const MAX_CAUSE_DEPTH = 8;

/**
 * Достаёт ошибку драйвера из того, что реально долетело наверх.
 *
 * ВАЖНО: drizzle оборачивает **любую** ошибку запроса в `DrizzleQueryError` (см. `pg-core/session.js`),
 * поэтому `.code` лежит не на самой ошибке, а в `cause`. Проверка `err.code === '...'` напрямую по
 * пойманной ошибке не срабатывает никогда.
 */
export function findPgError(err: unknown): PgDriverError | undefined {
  let current: unknown = err;
  for (let depth = 0; current && depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current === 'object' && typeof (current as { code?: unknown }).code === 'string') {
      return current as PgDriverError;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isPgErrorCode(err: unknown, code: string): boolean {
  return findPgError(err)?.code === code;
}

/** Операция, в которой произошла ошибка, — задаёт формулировку для FK-нарушения (оно читается в обе стороны). */
export type DbOperation = 'create' | 'update' | 'delete';

/**
 * Переводит нарушение констрейнта в `DocumentRuntimeError(409)`. Всё остальное (включая `23P01`,
 * который перехватывают версионные хелперы hr на более глубоком уровне) возвращается как есть.
 */
export function mapDbError(err: unknown, op: DbOperation): unknown {
  const pg = findPgError(err);
  if (!pg) return err;
  const details = { pgCode: pg.code, constraint: pg.constraint };
  switch (pg.code) {
    case PG_NOT_NULL_VIOLATION:
      // 400, а не 409: это не конфликт с чужими данными, а незаполненное поле в самом запросе.
      return new DocumentRuntimeError(400, pg.column ? `Не заполнено обязательное поле «${pg.column}»` : 'Не заполнено обязательное поле', {
        ...details,
        column: pg.column,
      });
    case PG_CHECK_VIOLATION:
      return new DocumentRuntimeError(400, 'Значение не проходит проверку, заданную в базе данных', details);
    case PG_UNIQUE_VIOLATION:
      return new DocumentRuntimeError(409, 'Запись с такими значениями уже существует', details);
    case PG_FOREIGN_KEY_VIOLATION:
      // Направление нарушения определяем по операции, а не по тексту `detail`: он локализуется
      // сервером (lc_messages) и разбирать его строкой ненадёжно.
      return new DocumentRuntimeError(
        409,
        op === 'delete' ? 'Запись используется в других данных — удалить её нельзя' : 'Указана ссылка на запись, которой не существует',
        details,
      );
    default:
      return err;
  }
}

/** Обёртка вокруг блока запросов (обычно транзакции): ошибки констрейнтов наружу уходят как 409. */
export async function withDbErrors<T>(op: DbOperation, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw mapDbError(err, op);
  }
}
