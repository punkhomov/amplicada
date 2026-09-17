import type { AdminApp, AdminAppsService } from '../../contracts/apps.js';

export function createAdminAppsService(): AdminAppsService {
  const apps = new Map<string, AdminApp>();

  return {
    register(app) {
      apps.set(app.id, app);
    },
    getAll() {
      return [...apps.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },
    getById(id) {
      return apps.get(id);
    },
  };
}
