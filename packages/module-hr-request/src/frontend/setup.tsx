import { registerComponent } from '@amplicada/module-admin/frontend';
import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { API_CLIENT_TOKEN, type ApiClient } from '@amplicada/platform-core/frontend';
import { moduleManifest } from '../contracts/manifest.js';
import { RequestCardPage, requestDetailQueryOptions } from './pages/request-card/index.js';
import { RequestNewPage, requestTypesQueryOptions } from './pages/request-new/index.js';
import { RequestsListPage, requestsListMyQueryOptions } from './pages/requests-list/index.js';
import { RequestTypeFieldsEditor } from './widgets/request-type-fields-editor/index.js';

export const hrRequestsFrontendModule: FrontendModule = {
  ...moduleManifest,

  setup(context) {
    // Мини-редактор полей на карточке документа «Тип заявки» (component-ключ из backend/documents.ts)
    registerComponent('hr-request-type-fields', RequestTypeFieldsEditor);

    const api = context.services.resolve<ApiClient>(API_CLIENT_TOKEN);

    context.routes.register('/requests', <RequestsListPage />, {
      layout: 'app',
      loader: async () => {
        await context.queryClient.ensureQueryData(requestsListMyQueryOptions(api));
        return null;
      },
    });
    context.routes.register('/requests/new/:type', <RequestNewPage />, {
      layout: 'app',
      loader: async () => {
        await context.queryClient.ensureQueryData(requestTypesQueryOptions(api));
        return null;
      },
    });
    context.routes.register('/requests/:id', <RequestCardPage />, {
      layout: 'app',
      loader: async ({ params }) => {
        if (params.id) await context.queryClient.ensureQueryData(requestDetailQueryOptions(api, params));
        return null;
      },
    });

    context.navigation.register({ id: 'hr-requests', label: 'Заявки', path: '/requests' });
  },
};
