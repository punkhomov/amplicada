import type { AdminToolbarService, ToolbarAction } from '../../contracts/toolbar.js';

export function createToolbarService(): AdminToolbarService {
  const actions = new Map<string, ToolbarAction>();
  return {
    register(action) {
      actions.set(action.id, action);
    },
    getAll(documentType) {
      return [...actions.values()]
        .filter(action => !documentType || !action.documentType || action.documentType === documentType)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },
  };
}
