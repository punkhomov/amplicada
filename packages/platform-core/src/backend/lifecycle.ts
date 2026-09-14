import type { Lifecycle, LifecycleHook } from '../contracts/lifecycle.js';

export class LifecycleImpl implements Lifecycle {
  private hooks: LifecycleHook[] = [];

  register(hook: LifecycleHook): void {
    this.hooks.push(hook);
  }

  async execute(name: string, ...args: unknown[]): Promise<void> {
    await this.executePhase(name, 'before', args);
  }

  async executeAfter(name: string, ...args: unknown[]): Promise<void> {
    await this.executePhase(name, 'after', args);
  }

  private async executePhase(name: string, phase: LifecycleHook['phase'], args: unknown[]): Promise<void> {
    const errors: unknown[] = [];
    for (const hook of this.hooks) {
      if (hook.name !== name || hook.phase !== phase) continue;
      try {
        await hook.handler(...args);
      } catch (error) {
        // Shutdown must attempt every cleanup; other lifecycle operations remain fail-fast.
        if (name !== 'shutdown') throw error;
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, `Lifecycle "${name}" phase "${phase}" failed`);
  }
}
