import type { ReactNode } from 'react';
import type { LoaderFunction } from 'react-router-dom';

export interface FrontendRouteDefinition {
  path: string;
  element: ReactNode;
  layout?: string;
  meta?: Record<string, unknown>;
  /**
   * Опциональный react-router loader. Если задан, RouterProvider дожидается его перед сменой
   * страницы — предыдущий маршрут остаётся на экране вместо мигания текста "Загрузка...".
   * Обычно это `queryClient.ensureQueryData(...)` тем же queryKey, что использует useQuery
   * внутри страницы, чтобы данные попали в тот же кэш react-query.
   */
  loader?: LoaderFunction;
}

export interface FrontendRouteRegistry {
  register(path: string, element: ReactNode, options?: { layout?: string; meta?: Record<string, unknown>; loader?: LoaderFunction }): void;
  getAll(): FrontendRouteDefinition[];
}
