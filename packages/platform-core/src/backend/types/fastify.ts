import 'fastify';
import type { TFunction } from 'i18next';

declare module 'fastify' {
  interface FastifyRequest {
    t: TFunction;
  }
}
