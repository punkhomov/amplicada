export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;

export interface EventBusEvent<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
}

export interface EventBus {
  on<T = unknown>(eventType: string, handler: EventHandler<EventBusEvent<T>>): void;
  off<T = unknown>(eventType: string, handler: EventHandler<EventBusEvent<T>>): void;
  once<T = unknown>(eventType: string, handler: EventHandler<EventBusEvent<T>>): void;
  emit<T = unknown>(eventType: string, payload: T): void;
  removeAllListeners(eventType?: string): void;
}
