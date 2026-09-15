import { registerComponent, registerToolbarAction } from '@amplicada/module-admin/frontend';
import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { API_CLIENT_TOKEN, type ApiClient } from '@amplicada/platform-core/frontend';
import { HrPollDocuments } from '../contracts/index.js';
import { frontendManifest } from '../contracts/manifest.js';
import { PublishPollAction } from './features/publish-poll/index.js';
import { PollTakePage, pollDetailQueryOptions } from './pages/poll-take/index.js';
import { PollsListPage, pollsListQueryOptions } from './pages/polls-list/index.js';
import { PollQuestionsEditor } from './widgets/poll-questions-editor/index.js';

export const hrPollFrontendModule: FrontendModule = {
  ...frontendManifest,

  setup(context) {
    // Мини-редактор вопросов на карточке документа «Опрос» (component-ключ из backend/documents/poll.ts)
    registerComponent('poll-questions-editor', PollQuestionsEditor);

    registerToolbarAction({
      id: 'poll-publish',
      label: 'Опубликовать',
      documentType: HrPollDocuments.POLL,
      component: PublishPollAction,
    });

    const api = context.services.resolve<ApiClient>(API_CLIENT_TOKEN);

    context.routes.register('/polls', <PollsListPage />, {
      layout: 'app',
      loader: async () => {
        await context.queryClient.ensureQueryData(pollsListQueryOptions(api));
        return null;
      },
    });
    context.routes.register('/polls/:id', <PollTakePage />, {
      layout: 'app',
      loader: async ({ params }) => {
        if (params.id) await context.queryClient.ensureQueryData(pollDetailQueryOptions(api, params));
        return null;
      },
    });

    context.navigation.register({ id: 'hr-polls', label: 'Опросы', path: '/polls' });
  },
};
