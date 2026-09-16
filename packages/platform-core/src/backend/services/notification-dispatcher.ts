import type { NotificationServiceImpl } from './notification-service.js';

const DEFAULT_INTERVAL_MS = 10_000;

/**
 * Тонкий цикл над `NotificationServiceImpl`: добирает должные к отправке строки, чинит зависшие
 * `sending` после краша и раз в час чистит историю. Eager-попытка в `send()` работает и без него,
 * поэтому на web-роли письма тоже уходят — здесь живут только ретраи и восстановление.
 */
export class NotificationDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private notification: NotificationServiceImpl,
    private intervalMs: number = DEFAULT_INTERVAL_MS,
  ) {}

  start(): void {
    this.run().catch(err => console.error('[notification-dispatcher] цикл упал', err));
    this.timer = setInterval(() => {
      this.run().catch(err => console.error('[notification-dispatcher] цикл упал', err));
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Защита от наложения: медленный цикл (недоступный SMTP) не должен копить параллельные проходы. */
  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.notification.requeueStaleSending();
      await this.notification.dispatchDue();
      await this.notification.cleanupOld();
    } finally {
      this.running = false;
    }
  }
}
