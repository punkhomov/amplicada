import { useIsFetching } from '@tanstack/react-query';
import { useNavigation } from 'react-router-dom';
import { cn } from '../lib/utils.js';

/**
 * Индикатор состояния навигации/загрузки данных. useNavigation() покрывает переход между
 * маршрутами, useIsFetching() — фактическую загрузку данных смонтированной страницей (у нас
 * нет route loader'ов, поэтому именно fetch запросов, а не сама навигация, занимает время).
 */
export function RouteProgressBar() {
  const navigation = useNavigation();
  const isFetching = useIsFetching();
  const active = navigation.state !== 'idle' || isFetching > 0;

  return (
    <div
      aria-hidden
      className={cn(
        'fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden transition-opacity duration-200',
        active ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div className="h-full w-full animate-pulse bg-primary" />
    </div>
  );
}
