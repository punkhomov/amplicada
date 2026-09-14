export interface LifecycleHook {
  name: string;
  phase: 'before' | 'after';
  handler: (...args: unknown[]) => void | Promise<void>;
}

export interface Lifecycle {
  register(hook: LifecycleHook): void;
  execute(name: string, ...args: unknown[]): Promise<void>;
  executeAfter(name: string, ...args: unknown[]): Promise<void>;
}
