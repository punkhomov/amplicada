import type { FastifyRequest } from 'fastify';
import type { AuthLogEntry, BackendAuthLogService } from '../../contracts/backend/auth.js';
import type { BackendDbService } from '../../contracts/backend/db.js';
import { authLog } from '../schemas/index.js';

export function requestAuthMeta(request: unknown): { ipAddress: string | null; userAgent: string | null } {
  const req = request as FastifyRequest;
  const ipAddress = req?.ip ?? null;
  const rawAgent = req?.headers?.['user-agent'];
  const userAgent = typeof rawAgent === 'string' ? rawAgent.slice(0, 512) : null;
  return { ipAddress, userAgent };
}

export class AuthLogServiceImpl implements BackendAuthLogService {
  constructor(private readonly db: BackendDbService) {}

  async record(entry: AuthLogEntry): Promise<void> {
    await this.db.insert(authLog).values({
      userId: entry.userId ?? null,
      login: entry.login ?? null,
      action: entry.action,
      success: entry.success,
      reason: entry.reason ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    });
  }
}
