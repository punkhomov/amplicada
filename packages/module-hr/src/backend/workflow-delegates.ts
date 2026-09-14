import type { AssigneeProvider } from '@amplicada/module-workflow/contracts';

/**
 * Минимальный делегат для доказательства механизма Plugin Registry (план 07):
 * исполнитель задаётся прямо в конфиге ноды редактора (assigneeProviderParams.userId).
 * Реальный org-chart-делегат ("текущий руководитель") — предмет отдельного плана:
 * в hr.user_profile пока нет ссылки на руководителя.
 */
export const fixedAssigneeProvider: AssigneeProvider = {
  async resolve({ params }) {
    const userId = (params as { userId?: string } | undefined)?.userId;
    if (!userId) {
      const received = params && Object.keys(params).length ? `получены ключи: ${Object.keys(params).join(', ')}` : 'параметры пусты';
      throw new Error(`fixed-assignee: в параметрах ноды обязателен ключ "userId" (id пользователя identity_user); ${received}`);
    }
    return userId;
  },
};
