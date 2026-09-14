import type { RedisClientType } from 'redis';

export const TASK_EVENTS_CHANNEL = 'task:events';

/**
 * Публикует событие в Redis. Единственный путь распространения task-событий — без прямого
 * emit на локальный eventBus. Локальный eventBus наполняется исключительно через TaskEventBridge,
 * который подписан на этот же канал на любом процессе (включая тот, что событие опубликовал).
 * Так поведение одинаково для web/worker/all — нет отдельной ветки "эмитить и локально, и в Redis
 * одновременно", которая раньше требовала спецкейса на ROLE=all, чтобы не задвоить доставку.
 */
export function emitTaskEvent<T>(redis: RedisClientType, type: string, payload: T): void {
  redis.publish(TASK_EVENTS_CHANNEL, JSON.stringify({ type, payload })).catch(() => {});
}
