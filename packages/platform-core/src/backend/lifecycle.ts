import type { Lifecycle, LifecycleHook } from '../contracts/lifecycle.js';

export class LifecycleImpl implements Lifecycle {
  private hooks: LifecycleHook[] = [];

  register(hook: LifecycleHook): void {
    this.hooks.push(hook);
  }

  async execute(name: string, ...args: unknown[]): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.name === name && hook.phase === 'before') {
        await hook.handler(...args);
      }
    }
  }

  async executeAfter(name: string, ...args: unknown[]): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.name === name && hook.phase === 'after') {
        await hook.handler(...args);
      }
    }
  }
}
