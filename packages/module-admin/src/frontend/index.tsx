import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { API_CLIENT_TOKEN, type ApiClient } from '@amplicada/platform-core/frontend';
import type { LoaderFunction } from 'react-router-dom';
import { moduleManifest } from '../contracts/manifest.js';
import { AdminDocuments } from '../contracts/notification-template.js';
import type { AdminToolbarService } from '../contracts/toolbar.js';
import { AdminLayout } from './layouts/admin-layout.js';
import { registerComponent } from './lib/component-registry.js';
import { createToolbarService } from './lib/toolbar-action-registry.js';
import { adminLocales } from './locales/index.js';
import { AdminDashboard, adminDashboardQueryOptions } from './pages/admin-dashboard/index.js';
import { AdminDocumentCard, adminDocumentDetailQueryOptions } from './pages/admin-document-card/index.js';
import {
  AdminDocumentList,
  adminDocumentListInfiniteQueryOptions,
  filtersForType,
  readAdminTableSettings,
} from './pages/admin-document-list/index.js';
import { AdminModules, adminApiModulesQueryOptions } from './pages/admin-modules/index.js';
import { AdminNotifications, adminNotificationsQueryOptions } from './pages/admin-notifications/index.js';
import { AdminStorage, adminStorageObjectsQueryOptions } from './pages/admin-storage/index.js';
import { AdminTaskDetail, adminTaskRunsQueryOptions } from './pages/admin-task-detail/index.js';
import { AuthLogDisplay } from './widgets/auth-log-display/index.js';
import { MembersDisplay } from './widgets/members-display/index.js';
import { NotificationTemplateEditor } from './widgets/notification-template-editor/index.js';
import { ScheduledTaskCard } from './widgets/scheduled-task-card/index.js';
import { SendNotificationTemplateAction } from './widgets/send-notification-template/index.js';

const adminFrontendModule: FrontendModule = {
  ...moduleManifest,
  locales: { frontend: { ru: adminLocales.ru, en: adminLocales.en } },
  setup(context) {
    context.services.register('admin:toolbar', createToolbarService());
    registerComponent('user-group-members', MembersDisplay);
    registerComponent('user-auth-log', AuthLogDisplay);
    registerComponent('scheduled-task-fields', ScheduledTaskCard);
    registerComponent('notification-template-editor', NotificationTemplateEditor);
    context.services.resolve<AdminToolbarService>('admin:toolbar').register({
      id: 'notification-template-send',
      documentType: AdminDocuments.NOTIFICATION_TEMPLATE,
      label: 'admin:template_send_action',
      component: SendNotificationTemplateAction,
      order: 10,
    });
    context.layouts.register('admin', AdminLayout);

    const api = context.services.resolve<ApiClient>(API_CLIENT_TOKEN);

    context.routes.register('/admin', <AdminDashboard />, {
      layout: 'admin',
      loader: async () => {
        await context.queryClient.ensureQueryData(adminDashboardQueryOptions(api));
        return null;
      },
    });
    context.routes.register('/admin/modules', <AdminModules />, {
      layout: 'admin',
      loader: async () => {
        await context.queryClient.ensureQueryData(adminApiModulesQueryOptions(api));
        return null;
      },
    });
    // Статический сегмент ранжируется React Router'ом выше generic '/admin/:type' — конфликта с
    // списком документов нет.
    context.routes.register('/admin/notifications', <AdminNotifications />, {
      layout: 'admin',
      loader: async () => {
        await context.queryClient.ensureQueryData(adminNotificationsQueryOptions(api, { status: 'all', kind: '', userId: '' }, 0));
        return null;
      },
    });
    context.routes.register('/admin/storage', <AdminStorage />, {
      layout: 'admin',
      loader: async () => {
        await context.queryClient.ensureQueryData(adminStorageObjectsQueryOptions(api));
        return null;
      },
    });
    // Список задач рендерится через общий /admin/:type (document type 'scheduled-task').
    // Эта страница — ручной запуск/live-логи конкретного run'а, доступна по ссылке-табу
    // "История запусков" на карточке задачи (linkTemplate в document-definitions.ts).
    context.routes.register('/admin/scheduled-task/:id/runs', <AdminTaskDetail />, {
      layout: 'admin',
      loader: async ({ params }) => {
        if (params.id) await context.queryClient.ensureQueryData(adminTaskRunsQueryOptions(api, params));
        return null;
      },
    });
    context.routes.register('/admin/:type', <AdminDocumentList />, {
      layout: 'admin',
      loader: async ({ params }) => {
        const { type } = params;
        if (!type) return null;
        // 'pages'-режим пагинации и произвольные sort/columnOrder — состояние только компонента,
        // loader покрывает дефолтный ('infinite') первый заход на страницу.
        const settings = readAdminTableSettings();
        if (settings.paginationMode !== 'infinite') return null;
        // Строго через filtersForType: компонент читает фильтры ею же, а queryKey должен совпасть
        // байт в байт — иначе loader засеет не тот ключ и на каждой загрузке будет рефетч-вспышка.
        const filters = filtersForType(settings, type);
        await context.queryClient.ensureInfiniteQueryData(
          adminDocumentListInfiniteQueryOptions(api, params, { sorting: [], pageSize: settings.pageSize, filters }),
        );
        return null;
      },
    });

    // Общий loader для /admin/:type/create (id отсутствует) и /admin/:type/:id —
    // adminDocumentDetailQueryOptions сама решает по наличию params.id, что запрашивать.
    const documentCardLoader: LoaderFunction = async ({ params }) => {
      if (params.type) await context.queryClient.ensureQueryData(adminDocumentDetailQueryOptions(api, params));
      return null;
    };
    context.routes.register('/admin/:type/create', <AdminDocumentCard />, { layout: 'admin', loader: documentCardLoader });
    context.routes.register('/admin/:type/:id', <AdminDocumentCard />, { layout: 'admin', loader: documentCardLoader });
  },
};

export type { AdminToolbarService, ToolbarAction, ToolbarActionProps } from '../contracts/toolbar.js';
export { AdminLayout } from './layouts/admin-layout.js';
export type { TableAction, TableActionProps } from './lib/admin-table-action-registry.js';
export { registerTableAction } from './lib/admin-table-action-registry.js';
export { registerComponent } from './lib/component-registry.js';
export type { DocumentCardContextValue } from './lib/document-card-context.js';
export { useDocumentCardContext } from './lib/document-card-context.js';
export { AdminDashboard } from './pages/admin-dashboard/index.js';
export { AdminDocumentCard } from './pages/admin-document-card/index.js';
export { AdminDocumentList } from './pages/admin-document-list/index.js';
export { AdminModules } from './pages/admin-modules/index.js';
export { AdminNotifications } from './pages/admin-notifications/index.js';
export { AdminStorage } from './pages/admin-storage/index.js';
export { AdminTaskDetail } from './pages/admin-task-detail/index.js';

export { adminFrontendModule as module };
