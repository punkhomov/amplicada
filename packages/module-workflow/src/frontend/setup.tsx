import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { API_CLIENT_TOKEN, type ApiClient } from '@amplicada/platform-core/frontend';
import { moduleManifest } from '../contracts/manifest.js';
import { ProcessTimelinePage, processDetailQueryOptions } from './pages/process-timeline/index.js';
import { WorkflowEditorPage, workflowVersionsQueryOptions } from './pages/workflow-editor/index.js';

export const workflowFrontendModule: FrontendModule = {
  ...moduleManifest,

  setup(context) {
    // layout 'admin' — мягкая рантайм-связь по имени: module-admin регистрирует его,
    // module-workflow ничего из module-admin не импортирует (инвариант родительского плана).
    // Обе страницы достигаются по linkTemplate-табам карточек документов workflow / workflow-process.
    const api = context.services.resolve<ApiClient>(API_CLIENT_TOKEN);

    context.routes.register('/admin/workflows/:id/editor', <WorkflowEditorPage />, {
      layout: 'admin',
      loader: async ({ params }) => {
        if (params.id) await context.queryClient.ensureQueryData(workflowVersionsQueryOptions(api, params));
        return null;
      },
    });
    context.routes.register('/admin/workflows/processes/:id', <ProcessTimelinePage />, {
      layout: 'admin',
      loader: async ({ params }) => {
        if (params.id) await context.queryClient.ensureQueryData(processDetailQueryOptions(api, params));
        return null;
      },
    });
  },
};
