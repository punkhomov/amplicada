import type { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TTL_SECONDS = 90;

export const WORKER_HEARTBEAT_PREFIX = 'worker:heartbeat:';

export class WorkerHeartbeat {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private redis: RedisClient,
    private workerId: string,
  ) {}

  start(): void {
    this.beat().catch(() => {});
    this.timer = setInterval(() => {
      this.beat().catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async beat(): Promise<void> {
    await this.redis.set(`${WORKER_HEARTBEAT_PREFIX}${this.workerId}`, Date.now().toString(), { EX: HEARTBEAT_TTL_SECONDS });
  }
}
