import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { API_CLIENT_TOKEN, type ApiClient } from '@amplicada/platform-core/frontend';
import type { LoaderFunction } from 'react-router-dom';
import { frontendManifest } from '../contracts/manifest.js';
import { AdminLayout } from './layouts/admin-layout.js';
import { registerComponent } from './lib/component-registry.js';
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
import { AdminStorage, adminStorageObjectsQueryOptions } from './pages/admin-storage/index.js';
import { AdminTaskDetail, adminTaskRunsQueryOptions } from './pages/admin-task-detail/index.js';
import { AuthLogDisplay } from './widgets/auth-log-display/index.js';
import { MembersDisplay } from './widgets/members-display/index.js';
import { ScheduledTaskCard } from './widgets/scheduled-task-card/index.js';

export const adminFrontendModule: FrontendModule = {
  ...frontendManifest,
  locales: { frontend: { ru: adminLocales.ru, en: adminLocales.en } },
  setup(context) {
    registerComponent('user-group-members', MembersDisplay);
    registerComponent('user-auth-log', AuthLogDisplay);
    registerComponent('scheduled-task-fields', ScheduledTaskCard);
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

export { AdminLayout } from './layouts/admin-layout.js';
export type { TableAction, TableActionProps } from './lib/admin-table-action-registry.js';
export { registerTableAction } from './lib/admin-table-action-registry.js';
export { registerComponent } from './lib/component-registry.js';
export type { DocumentCardContextValue } from './lib/document-card-context.js';
export { useDocumentCardContext } from './lib/document-card-context.js';
export type { ToolbarAction, ToolbarActionProps } from './lib/toolbar-action-registry.js';
export { registerToolbarAction } from './lib/toolbar-action-registry.js';
export { AdminDashboard } from './pages/admin-dashboard/index.js';
export { AdminDocumentCard } from './pages/admin-document-card/index.js';
export { AdminDocumentList } from './pages/admin-document-list/index.js';
export { AdminModules } from './pages/admin-modules/index.js';
export { AdminStorage } from './pages/admin-storage/index.js';
export { AdminTaskDetail } from './pages/admin-task-detail/index.js';
