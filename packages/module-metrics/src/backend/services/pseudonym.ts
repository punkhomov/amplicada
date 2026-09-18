import { createHmac } from 'node:crypto';

export type PseudonymPurpose = 'analytics' | 'errors' | 'session';

/**
 * Псевдонимизация акторов: HMAC с секретом узла (152-ФЗ, приказ РКН № 140 — метод
 * «введение идентификаторов»). Логины и id не сохраняются нигде. Секрет живёт в env,
 * а не в БД (сервис `secrets` ядра).
 */
export class Pseudonymizer {
  constructor(private readonly secret: string) {
    if (secret.length < 16) {
      throw new Error('Pseudonymizer secret must be at least 16 characters');
    }
  }

  hash(value: string, purpose: PseudonymPurpose): string {
    return createHmac('sha256', this.secret).update(`${purpose}:${value}`).digest('base64url');
  }

  forUser(userId: string, purpose: 'analytics' | 'errors' = 'analytics'): string {
    return this.hash(userId, purpose);
  }

  forSession(sessionId: string): string {
    return this.hash(sessionId, 'session');
  }
}
