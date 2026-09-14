export interface ServiceRegistry {
  register<T = unknown>(token: string, implementation: T): void;
  resolve<T = unknown>(token: string): T;
  has(token: string): boolean;
}
