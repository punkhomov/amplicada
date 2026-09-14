import type { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

const EXTEND_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export interface TaskLockHandle {
  key: string;
  token: string;
}

export class TaskLock {
  constructor(private redis: RedisClient) {}

  private keyFor(taskId: string): string {
    return `task-lock:${taskId}`;
  }

  async acquire(taskId: string, token: string, ttlMs: number): Promise<TaskLockHandle | null> {
    const key = this.keyFor(taskId);
    const result = await this.redis.set(key, token, { NX: true, PX: ttlMs });
    if (result !== 'OK') return null;
    return { key, token };
  }

  async extend(handle: TaskLockHandle, ttlMs: number): Promise<boolean> {
    const result = await this.redis.eval(EXTEND_SCRIPT, { keys: [handle.key], arguments: [handle.token, String(ttlMs)] });
    return result === 1;
  }

  async release(handle: TaskLockHandle): Promise<boolean> {
    const result = await this.redis.eval(RELEASE_SCRIPT, { keys: [handle.key], arguments: [handle.token] });
    return result === 1;
  }

  async exists(taskId: string): Promise<boolean> {
    const result = await this.redis.exists(this.keyFor(taskId));
    return result > 0;
  }
}
