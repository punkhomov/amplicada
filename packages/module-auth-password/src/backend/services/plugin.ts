import { documentIndex, identityUser } from '@amplicada/platform-core/backend';
import type { AuthResult, BackendAuthProvider, BackendDbService } from '@amplicada/platform-core/contracts/backend';
import bcrypt from 'bcrypt';
import { and, eq, isNull } from 'drizzle-orm';
import { passwordCredential } from '../schemas/index.js';

export class PasswordAuthProvider implements BackendAuthProvider {
  id = 'password';

  constructor(private db: BackendDbService) {}

  async authenticate(): Promise<AuthResult | null> {
    return null;
  }

  async validateCredentials(login: string, password: string): Promise<AuthResult | null> {
    const result = await this.db
      .select({
        id: identityUser.id,
        login: identityUser.login,
        passwordHash: passwordCredential.passwordHash,
      })
      .from(identityUser)
      .innerJoin(passwordCredential, eq(identityUser.id, passwordCredential.userId))
      // Признак удалённости живёт в document_index (этап 2 плана 06), поэтому джойн: soft-deleted
      // пользователь (DocumentRuntime.delete) не может залогиниться. Активные сессии не
      // инвалидируются — приемлемо для dev, не для prod.
      .innerJoin(documentIndex, eq(documentIndex.id, identityUser.id))
      .where(and(eq(identityUser.login, login), isNull(documentIndex.deletedAt)))
      .limit(1);

    const user = result[0];
    if (!user) return null;

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;

    return { user: { id: user.id, login: user.login } };
  }

  async findUserIdByLogin(login: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: identityUser.id })
      .from(identityUser)
      .innerJoin(documentIndex, eq(documentIndex.id, identityUser.id))
      .where(and(eq(identityUser.login, login), isNull(documentIndex.deletedAt)))
      .limit(1);
    return row?.id ?? null;
  }
}
