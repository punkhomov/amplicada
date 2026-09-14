/**
 * Вынесено из document-runtime.ts отдельным модулем, чтобы filter-sql.ts мог бросать эту ошибку
 * без циклического импорта (document-runtime → filter-sql → document-runtime).
 * document-runtime.ts ре-экспортирует класс, поэтому все существующие пути импорта продолжают работать.
 */
export class DocumentRuntimeError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Машиночитаемые подробности (напр. список проблем фильтра) — пробрасывается в тело ответа. */
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DocumentRuntimeError';
  }
}
