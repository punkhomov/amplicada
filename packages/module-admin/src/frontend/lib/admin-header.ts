import { createContext, type ReactNode, useCallback, useContext, useEffect } from 'react';

export type AdminHeaderRender = () => ReactNode;

export interface AdminHeaderApi {
  /** Подменить левую часть шапки админки, пока страница смонтирована; `null` — вернуть вид по умолчанию. */
  setHeader(render: AdminHeaderRender | null): void;
}

export const AdminHeaderContext = createContext<AdminHeaderApi | null>(null);

/**
 * API для страниц админки: хост приложения или страница документа подставляет в шапку
 * свой заголовок (кнопка «назад», название, действия), не рисуя собственную полосу.
 * Рендер-функция стабилизируется по `deps` — иначе эффект зациклил бы состояние layout'а.
 */
export function useAdminHeader(render: AdminHeaderRender, deps: unknown[] = []): void {
  const api = useContext(AdminHeaderContext);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps задаёт вызывающий — контракт API
  const stable = useCallback(render, deps);

  useEffect(() => {
    api?.setHeader(stable);
    return () => api?.setHeader(null);
  }, [api, stable]);
}
