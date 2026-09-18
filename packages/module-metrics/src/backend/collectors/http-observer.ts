import { hostname } from 'node:os';
import type { HttpObserver } from '@amplicada/platform-core/contracts/backend';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MeasurementBuffer } from '../services/measurement-buffer.js';

const INSTRUMENT = 'http.server.request.duration';

/** Метрики роутов: длительность (гистограмма) + измерения route/method/status. */
export function createHttpObserver({ buffer, instance = hostname() }: { buffer: MeasurementBuffer; instance?: string }): HttpObserver {
  return {
    onResponse(request: FastifyRequest, reply: FastifyReply) {
      // Unmatched-запросы — в отдельный бакет: сырой URL в измерения не попадает.
      const route = request.routeOptions?.url ?? '<unmatched>';
      const status = String(reply.statusCode);
      const durationSeconds = reply.elapsedTime / 1000;
      buffer.record(
        {
          instrument: INSTRUMENT,
          kind: 'histogram',
          unit: 's',
          dims: {
            route,
            method: request.method,
            status,
            status_class: `${Math.floor(reply.statusCode / 100)}xx`,
            instance,
          },
        },
        durationSeconds,
      );
    },
  };
}
