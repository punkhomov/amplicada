import type { FrontendNavigationRegistry, NavigationItem } from '../../contracts/frontend/navigation.js';

export class FrontendNavigationRegistryImpl implements FrontendNavigationRegistry {
  private items: NavigationItem[] = [];

  register(item: NavigationItem): void {
    this.items.push(item);
  }

  getAll(): NavigationItem[] {
    return [...this.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
}
