import type { RouteObject } from 'react-router-dom';
import type { FrontendSetupContext } from '../../contracts/frontend/index.js';
import { RouteError } from './route-error.js';

/**
 * Строит дерево маршрутов (RouteObject[]) для createBrowserRouter из реестра
 * маршрутов/лэйаутов, заполненного модулями во время bootstrapFrontend.
 * Маршруты группируются по layout — каждый лэйаут становится родительским
 * маршрутом с <Outlet/>, а его страницы — дочерними.
 */
export function buildModuleRouteTree(context: Pick<FrontendSetupContext, 'routes' | 'layouts'>): RouteObject[] {
  const allRoutes = context.routes.getAll();

  const noLayout: RouteObject[] = [];
  const grouped = new Map<string, RouteObject[]>();

  for (const route of allRoutes) {
    const routeObject: RouteObject = { path: route.path, element: route.element };
    if (route.loader) {
      routeObject.loader = route.loader;
      // Только маршруты с loader'ом реально могут упасть до рендера — errorElement ловит
      // именно эти исключения (например, ensureQueryData на упавшем запросе).
      routeObject.errorElement = <RouteError />;
    }
    if (route.layout) {
      const group = grouped.get(route.layout) ?? [];
      group.push(routeObject);
      grouped.set(route.layout, group);
    } else {
      noLayout.push(routeObject);
    }
  }

  const tree: RouteObject[] = [...noLayout];

  for (const [layoutName, children] of grouped) {
    const Layout = context.layouts.get(layoutName);
    if (!Layout) {
      console.warn(`Layout "${layoutName}" not registered`);
      tree.push(...children);
      continue;
    }
    tree.push({ element: <Layout />, children });
  }

  return tree;
}
