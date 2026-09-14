import type { RedisClientType } from 'redis';
import type { EventBus } from '../../contracts/event-bus.js';
import { TASK_EVENTS_CHANNEL } from '../task-events.js';

export interface TaskEventBridgeDeps {
  redis: RedisClientType;
  eventBus: EventBus;
}

/**
 * Единственный путь наполнения локального eventBus task-событиями. Запускается на КАЖДОМ
 * процессе, независимо от роли: TaskRunner сам ничего не эмитит локально, только публикует
 * в Redis (см. emitTaskEvent) — этот мост подписан на тот же канал и реэмитит на месте.
 * Работает одинаково на web/worker/all, включая процесс, который сам опубликовал событие —
 * никакой ветки "эта роль эмитит напрямую, эта через Redis" нет.
 */
export class TaskEventBridge {
  private subscriber: RedisClientType | undefined;

  constructor(private deps: TaskEventBridgeDeps) {}

  async start(): Promise<void> {
    this.subscriber = this.deps.redis.duplicate();
    await this.subscriber.connect();
    await this.subscriber.subscribe(TASK_EVENTS_CHANNEL, message => {
      try {
        const { type, payload } = JSON.parse(message) as { type: string; payload: unknown };
        this.deps.eventBus.emit(type, payload);
      } catch {
        // malformed message — ignore
      }
    });
  }

  async stop(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = undefined;
    }
  }
}
