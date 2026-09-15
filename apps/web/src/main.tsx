import { adminFrontendModule } from '@amplicada/module-admin/frontend';
import { authPasswordFrontendModule } from '@amplicada/module-auth-password/frontend';
import { hrFrontendModule } from '@amplicada/module-hr/frontend';
import { hrLearningFrontendModule } from '@amplicada/module-hr-learning/frontend';
import { hrPollFrontendModule } from '@amplicada/module-hr-poll/frontend';
import { hrRequestsFrontendModule } from '@amplicada/module-hr-request/frontend';
import { workflowFrontendModule } from '@amplicada/module-workflow/frontend';
import {
  bootstrapFrontend,
  buildModuleRouteTree,
  createFrontendApp,
  FrontendProvider,
  RootLayout,
} from '@amplicada/platform-core/frontend';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { HomePage } from './routes/home';
import './index.css';

const { context, queryClient } = createFrontendApp();

async function init() {
  await bootstrapFrontend(
    [
      authPasswordFrontendModule,
      hrFrontendModule,
      workflowFrontendModule,
      hrRequestsFrontendModule,
      hrPollFrontendModule,
      hrLearningFrontendModule,
      adminFrontendModule,
    ],
    context,
  );

  context.routes.register('/home', <HomePage />, { layout: 'app' });

  const router = createBrowserRouter([
    {
      element: <RootLayout />,
      children: [...buildModuleRouteTree(context), { path: '*', element: <Navigate to="/home" replace /> }],
    },
  ]);

  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Root element not found');
  createRoot(rootEl).render(
    <StrictMode>
      <FrontendProvider context={context} queryClient={queryClient}>
        <RouterProvider router={router} />
      </FrontendProvider>
    </StrictMode>,
  );
}

init();
