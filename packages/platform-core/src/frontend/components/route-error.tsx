import { useRevalidator, useRouteError } from 'react-router-dom';
import { QueryError } from './query-error.js';

/**
 * errorElement для групп маршрутов (по layout) в buildModuleRouteTree. Ловит исключения из
 * route loader'ов (например, ensureQueryData на упавшем запросе) и показывает тот же QueryError,
 * что и клиентский useQuery — без этого падение loader'а показывало бы дефолтный экран react-router.
 */
export function RouteError() {
  const error = useRouteError();
  const revalidator = useRevalidator();

  return <QueryError error={error} onRetry={() => revalidator.revalidate()} />;
}
