/** Контекст текущего HTTP-запроса (ALS): доступен в любой глубине вызова, включая SQL-обёртки. */
export interface BackendRequestContext {
  requestId: string;
  method: string;
  /** Шаблон маршрута Fastify (`/api/support-chat/threads/:id`), `null` до матчинга. */
  route: string | null;
}

export interface BackendRequestContextService {
  current(): BackendRequestContext | undefined;
}
