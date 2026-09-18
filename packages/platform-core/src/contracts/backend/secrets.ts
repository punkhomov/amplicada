/**
 * Доступ модулей к секретам узла. Только core читает `process.env`: модуль просит секрет
 * по неймспейсному имени (`metrics.pseudonym_salt` → `AMPLICADA_METRICS_PSEUDONYM_SALT`),
 * а не лезет в окружение сам. Значения не кэшируются и не логируются.
 */
export interface BackendSecretsService {
  /** Секрет или `undefined`, если не задан. */
  get(name: string): string | undefined;
  /** Секрет или исключение — для обязательных (соль псевдонимизации и т.п.). */
  require(name: string): string;
}
