import type { FastifySessionOptions } from '@fastify/session';

type SessionStore = NonNullable<FastifySessionOptions['store']>;

// biome-ignore lint/suspicious/noExplicitAny: соответствует @fastify/session callback API
type Callback = (err?: any) => void;
// biome-ignore lint/suspicious/noExplicitAny: соответствует @fastify/session callback API
type CallbackSession = (err: any, result?: any) => void;

interface Serializer {
  // biome-ignore lint/suspicious/noExplicitAny: соответствует @fastify/session callback API
  parse(s: string): any | Promise<any>;
  // biome-ignore lint/suspicious/noExplicitAny: соответствует @fastify/session callback API
  stringify(s: any): string;
}

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<string | null>;
  del(keys: string[]): Promise<number>;
  mGet(keys: string[]): Promise<(string | null)[]>;
  expire(key: string, seconds: number): Promise<number>;
  scanIterator(options: { MATCH: string; COUNT: number }): AsyncIterable<string[]>;
}

interface RedisStoreOptions {
  client: RedisClient;
  prefix?: string;
  scanCount?: number;
  serializer?: Serializer;
  // biome-ignore lint/suspicious/noExplicitAny: sess тип от @fastify/session
  ttl?: number | ((sess: any) => number);
  disableTTL?: boolean;
  disableTouch?: boolean;
}

export class RedisStore implements SessionStore {
  client: RedisClient;
  prefix: string;
  scanCount: number;
  serializer: Serializer;
  // biome-ignore lint/suspicious/noExplicitAny: sess тип от @fastify/session
  ttl: number | ((sess: any) => number);
  disableTTL: boolean;
  disableTouch: boolean;

  constructor(opts: RedisStoreOptions) {
    this.prefix = opts.prefix ?? 'sess:';
    this.scanCount = opts.scanCount ?? 100;
    this.serializer = opts.serializer ?? JSON;
    this.ttl = opts.ttl ?? 86400;
    this.disableTTL = opts.disableTTL ?? false;
    this.disableTouch = opts.disableTouch ?? false;
    this.client = opts.client;
  }

  async get(sid: string, cb?: CallbackSession) {
    const key = this.prefix + sid;
    try {
      const data = await this.client.get(key);
      if (!data) return cb?.(null, null);
      const session = await this.serializer.parse(data);
      return cb?.(null, session);
    } catch (err) {
      return cb?.(err);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: sess от @fastify/session
  async set(sid: string, sess: any, cb?: Callback) {
    const key = this.prefix + sid;
    const ttl = this.getTTL(sess);
    try {
      if (ttl > 0) {
        const val = this.serializer.stringify(sess);
        if (this.disableTTL) {
          await this.client.set(key, val);
        } else {
          await this.client.set(key, val, { EX: ttl });
        }
        return cb?.();
      }
      return this.destroy(sid, cb);
    } catch (err) {
      return cb?.(err);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: _sess от @fastify/session
  async touch(sid: string, _sess: any, cb?: Callback) {
    if (this.disableTouch || this.disableTTL) return cb?.();
    const key = this.prefix + sid;
    try {
      const ttl = typeof this.ttl === 'function' ? this.ttl(_sess) : this.ttl;
      await this.client.expire(key, ttl);
      return cb?.();
    } catch (err) {
      return cb?.(err);
    }
  }

  async destroy(sid: string, cb?: Callback) {
    const key = this.prefix + sid;
    try {
      await this.client.del([key]);
      return cb?.();
    } catch (err) {
      return cb?.(err);
    }
  }

  async clear(cb?: Callback) {
    try {
      const keys = await this.getAllKeys();
      if (keys.length === 0) return cb?.();
      await this.client.del(keys);
      return cb?.();
    } catch (err) {
      return cb?.(err);
    }
  }

  async length(cb?: CallbackSession) {
    try {
      const keys = await this.getAllKeys();
      return cb?.(null, keys.length);
    } catch (err) {
      return cb?.(err);
    }
  }

  async ids(cb?: CallbackSession) {
    const len = this.prefix.length;
    try {
      const keys = await this.getAllKeys();
      return cb?.(
        null,
        keys.map(k => k.substring(len)),
      );
    } catch (err) {
      return cb?.(err);
    }
  }

  async all(cb?: CallbackSession) {
    const len = this.prefix.length;
    try {
      const keys = await this.getAllKeys();
      if (keys.length === 0) return cb?.(null, []);
      const data = await this.client.mGet(keys);
      const results = data.reduce(
        // biome-ignore lint/suspicious/noExplicitAny: acc/sess тип неизвестен до парсинга
        (acc: any[], raw: string | null, idx: number) => {
          if (!raw) return acc;
          // biome-ignore lint/suspicious/noExplicitAny: as any — результат JSON.parse
          const sess = this.serializer.parse(raw) as any;
          sess.id = keys[idx].substring(len);
          acc.push(sess);
          return acc;
        },
        // biome-ignore lint/suspicious/noExplicitAny: []
        [] as any[],
      );
      return cb?.(null, results);
    } catch (err) {
      return cb?.(err);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: sess от @fastify/session
  private getTTL(sess: any): number {
    if (typeof this.ttl === 'function') return this.ttl(sess);
    if (sess?.cookie?.expires) {
      const ms = Number(new Date(sess.cookie.expires)) - Date.now();
      return Math.ceil(ms / 1000);
    }
    return this.ttl;
  }

  private async getAllKeys(): Promise<string[]> {
    // biome-ignore lint/style/useTemplate: мне такой стиль нравится больше в данном случае
    const pattern = this.prefix + '*';
    const set = new Set<string>();
    for await (const keys of this.client.scanIterator({ MATCH: pattern, COUNT: this.scanCount })) {
      for (const key of keys) set.add(key);
    }
    return set.size > 0 ? Array.from(set) : [];
  }
}
