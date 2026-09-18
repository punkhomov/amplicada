import {
  bootstrapFrontend,
  buildModuleRouteTree,
  createFrontendApp,
  frontendErrors,
  FrontendProvider,
  RootLayout,
} from '@amplicada/platform-core/frontend';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { modules } from './generated/frontend-modules.js';
import { HomePage } from './routes/home';
import './index.css';

const { context, queryClient } = createFrontendApp();

async function init() {
  await bootstrapFrontend(modules, context);

  context.routes.register('/home', <HomePage />, { layout: 'app' });

  const router = createBrowserRouter([
    {
      element: <RootLayout />,
      children: [...buildModuleRouteTree(context), { path: '*', element: <Navigate to="/home" replace /> }],
    },
  ]);

  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Root element not found');
  createRoot(rootEl, {
    // React 19: ошибки рендера идут в общий репортер ядра, откуда их читает модуль метрик.
    onUncaughtError: (error, errorInfo) =>
      frontendErrors.report(error, { source: 'react-uncaught', componentStack: errorInfo.componentStack ?? undefined }),
    onCaughtError: (error, errorInfo) =>
      frontendErrors.report(error, { source: 'react-caught', componentStack: errorInfo.componentStack ?? undefined }),
  }).render(
    <StrictMode>
      <FrontendProvider context={context} queryClient={queryClient}>
        <RouterProvider router={router} />
      </FrontendProvider>
    </StrictMode>,
  );
}

init();
