import type { BackendSecretsService } from '../../contracts/backend/secrets.js';

const ENV_PREFIX = 'AMPLICADA_';

export function secretEnvName(name: string): string {
  return `${ENV_PREFIX}${name.toUpperCase().replace(/[.-]/g, '_')}`;
}

/** Читает секреты из окружения процесса по предсказуемому имени. */
export class EnvSecretsService implements BackendSecretsService {
  get(name: string): string | undefined {
    const value = process.env[secretEnvName(name)];
    return value && value.length > 0 ? value : undefined;
  }

  require(name: string): string {
    const value = this.get(name);
    if (!value) {
      throw new Error(`Secret "${name}" is not set (env ${secretEnvName(name)})`);
    }
    return value;
  }
}
