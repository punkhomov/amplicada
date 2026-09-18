/** Настройки коллекторов, обновляются флашером из `metrics.settings` раз в окно. */
export interface CollectorConfig {
  enabled: boolean;
  sampleSqlRate: number;
  slowSqlThresholdMs: number;
}

export const DEFAULT_COLLECTOR_CONFIG: CollectorConfig = {
  enabled: true,
  sampleSqlRate: 1,
  slowSqlThresholdMs: 1000,
};
