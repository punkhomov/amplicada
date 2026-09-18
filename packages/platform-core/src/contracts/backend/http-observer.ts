import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Наблюдатель HTTP-запросов. Core вызывает наблюдателей root-хуками `onRequest`/`onResponse`
 * до регистрации любых роутов, поэтому покрытие полное — включая роуты, зарегистрированные
 * модулями в их setup. Контрибуция — extension point `http:observer`.
 *
 * Исключения наблюдателя не влияют на запрос: core ловит их и пишет в лог.
 */
export interface HttpObserver {
  onRequest?(request: FastifyRequest): void;
  onResponse?(request: FastifyRequest, reply: FastifyReply): void;
}
