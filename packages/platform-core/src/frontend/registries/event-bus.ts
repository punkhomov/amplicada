import type { EventBus, EventBusEvent, EventHandler } from '../../contracts/event-bus.js';

export class FrontendEventBusImpl implements EventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  on<T = unknown>(eventType: string, handler: EventHandler<EventBusEvent<T>>): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)?.add(handler as EventHandler);
  }

  off<T = unknown>(eventType: string, handler: EventHandler<EventBusEvent<T>>): void {
    this.listeners.get(eventType)?.delete(handler as EventHandler);
  }

  once<T = unknown>(eventType: string, handler: EventHandler<EventBusEvent<T>>): void {
    const wrapper: EventHandler = event => {
      this.off(eventType, wrapper);
      return handler(event as EventBusEvent<T>);
    };
    this.on(eventType, wrapper);
  }

  emit<T = unknown>(eventType: string, payload: T): void {
    const event: EventBusEvent<T> = {
      type: eventType,
      payload,
      timestamp: Date.now(),
    };
    for (const handler of this.listeners.get(eventType) ?? []) {
      handler(event);
    }
  }

  removeAllListeners(eventType?: string): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
    }
  }
}
