import type { FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';

export type BackendRouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export interface BackendRouteDefinition {
  method: HTTPMethods;
  path: string;
  handler: BackendRouteHandler;
}

export interface BackendRouteRegistry {
  register(method: HTTPMethods, path: string, handler: BackendRouteHandler): void;
  getAll(): BackendRouteDefinition[];
}
