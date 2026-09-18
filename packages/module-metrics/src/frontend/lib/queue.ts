import type { ClientEventInput } from '../../contracts/index.js';

export const MAX_QUEUE_SIZE = 200;
export const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
export const DEFAULT_BATCH_BYTES = 32 * 1024;

/** Кольцевая очередь трекера: старые события вытесняются, утечки памяти нет. */
export class MetricsQueue {
  private items: ClientEventInput[] = [];

  push(event: ClientEventInput): void {
    if (this.items.length >= MAX_QUEUE_SIZE) this.items.shift();
    this.items.push(event);
  }

  size(): number {
    return this.items.length;
  }

  drain(): ClientEventInput[] {
    const items = this.items;
    this.items = [];
    return items;
  }
}

/** Режет батч по числу событий и байтам (beacon-лимит ≈ 64 КБ на все keepalive-запросы). */
export function chunkEvents(events: ClientEventInput[], maxEvents: number, maxBytes = DEFAULT_BATCH_BYTES): ClientEventInput[][] {
  const chunks: ClientEventInput[][] = [];
  let current: ClientEventInput[] = [];
  let bytes = 0;

  for (const event of events) {
    const size = JSON.stringify(event).length;
    if (current.length > 0 && (current.length >= maxEvents || bytes + size > maxBytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(event);
    bytes += size;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
