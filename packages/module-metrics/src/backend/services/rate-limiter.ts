export interface RateLimiterRedis {
  incrBy(key: string, value: number): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Сколько секунд ждать до конца окна — для заголовка `Retry-After`. */
  retryAfterSeconds: number;
  remaining: number;
}

const WINDOW_MS = 60_000;
const KEY_TTL_SECONDS = 120;

/**
 * Фиксированное минутное окно на Redis: `INCRBY` + `EXPIRE` (TTL в два окна, чтобы ключ
 * не жил вечно). Позволяет принимать решения без Lua и блокировок; на границе окна
 * возможно «двойное» окно — для телеметрии это допустимо (см. notes).
 */
export class IngestRateLimiter {
  constructor(private readonly redis: RateLimiterRedis) {}

  async consume(key: string, cost: number, limitPerMinute: number, now = Date.now()): Promise<RateLimitDecision> {
    const window = Math.floor(now / WINDOW_MS);
    const redisKey = `metrics:rl:${key}:${window}`;
    const used = await this.redis.incrBy(redisKey, cost);
    if (used === cost) await this.redis.expire(redisKey, KEY_TTL_SECONDS);

    const retryAfterSeconds = Math.max(1, Math.ceil((WINDOW_MS - (now % WINDOW_MS)) / 1000));
    if (used > limitPerMinute) {
      return { allowed: false, retryAfterSeconds, remaining: 0 };
    }
    return { allowed: true, retryAfterSeconds, remaining: Math.max(0, limitPerMinute - used) };
  }
}
