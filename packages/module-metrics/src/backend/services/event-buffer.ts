import type { NewMetricEventRow } from '../schemas/index.js';

/** Кольцевой буфер бизнес-событий: emit не ходит в БД на каждый вызов. */
export class EventBuffer {
  private items: NewMetricEventRow[] = [];

  constructor(private readonly maxSize = 500) {}

  push(row: NewMetricEventRow): void {
    if (this.items.length >= this.maxSize) this.items.shift();
    this.items.push(row);
  }

  size(): number {
    return this.items.length;
  }

  drain(): NewMetricEventRow[] {
    const items = this.items;
    this.items = [];
    return items;
  }
}
