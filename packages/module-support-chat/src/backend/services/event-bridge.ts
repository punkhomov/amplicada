import type { EventBus } from '@amplicada/platform-core/contracts/backend';
import { SUPPORT_CHAT_EVENTS_CHANNEL, type SupportChatEventPayload } from '../../contracts/index.js';

export interface SupportChatRedisClient {
  publish(channel: string, message: string): Promise<number>;
  duplicate(): SupportChatRedisClient;
  connect(): Promise<unknown>;
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  quit(): Promise<unknown>;
}

export interface SupportChatEventBridgeDeps {
  redis: SupportChatRedisClient;
  eventBus: EventBus;
}

export class SupportChatEventBridge {
  private subscriber: SupportChatRedisClient | undefined;

  constructor(private deps: SupportChatEventBridgeDeps) {}

  async start(): Promise<void> {
    this.subscriber = this.deps.redis.duplicate();
    await this.subscriber.connect();
    await this.subscriber.subscribe(SUPPORT_CHAT_EVENTS_CHANNEL, message => {
      try {
        const { type, payload } = JSON.parse(message) as { type: string; payload: SupportChatEventPayload };
        this.deps.eventBus.emit(type, payload);
      } catch {
        return;
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

export async function publishSupportChatEvent(
  redis: SupportChatRedisClient,
  type: string,
  payload: SupportChatEventPayload,
): Promise<void> {
  await redis.publish(SUPPORT_CHAT_EVENTS_CHANNEL, JSON.stringify({ type, payload }));
}
