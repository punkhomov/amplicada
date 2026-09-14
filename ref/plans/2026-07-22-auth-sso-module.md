---
title: Auth SSO Module — Implementation Plan
type: plan
tier: 4
status: draft
date: 2026-07-22
---

# Auth SSO Module — Implementation Plan

SSO-аутентификация (OAuth2 / OpenID Connect) как отдельный модуль `@amplicada/module-auth-sso`. Работает параллельно с `module-auth-password`.

---

## 1. База данных

Таблица `sso_credential` — привязка SSO-аккаунтов к `identity_user`:

```sql
CREATE TABLE sso_credential (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES identity_user(id) ON DELETE CASCADE,
  provider     VARCHAR(64) NOT NULL,
  sub          VARCHAR(255) NOT NULL,
  email        VARCHAR(255),
  name         VARCHAR(255),
  raw_json     JSONB,
  created_at   TIMESTAMP DEFAULT now(),
  UNIQUE(provider, sub)
);
```

- `provider` — `'google'`, `'github'`, `'azure-ad'` и т.д.
- `sub` — уникальный ID пользователя у провайдера (subject claim)
- `(provider, sub)` — уникальность гарантирует, что один внешний аккаунт привязан не более чем к одному локальному пользователю
- `raw_json` — полный профиль с провайдера (audit / data portability)
- Один `identity_user` может иметь несколько SSO-привязок (Google + GitHub)

---

## 2. Структура пакета

```
packages/module-auth-sso/
├── package.json
├── tsconfig.json
├── migrations/
│   ├── 0000_create_sso_credential.sql
│   └── meta/_journal.json
└── src/
    ├── contracts/
    │   ├── index.ts
    │   ├── manifest.ts
    │   └── types.ts
    ├── backend/
    │   ├── index.ts
    │   ├── setup.ts
    │   ├── routes.ts
    │   ├── schemas/
    │   │   ├── index.ts
    │   │   └── sso-credential.ts
    │   ├── documents/
    │   │   ├── index.ts
    │   │   └── user.ts
    │   └── services/
    │       ├── index.ts
    │       ├── sso-registry.ts
    │       └── providers/
    │           ├── base.ts
    │           ├── google.ts
    │           ├── github.ts
    │           └── oidc.ts
    └── frontend/
        ├── index.ts
        ├── setup.tsx
        ├── tailwind.css
        └── features/
            └── sso-buttons/
                ├── index.ts
                └── ui/
                    └── sso-login-buttons.tsx
```

---

## 3. Backend

### 3.1. AbstractSsoProvider (base.ts)

```ts
interface SsoProfile {
  sub: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

abstract class AbstractSsoProvider implements BackendAuthProvider {
  abstract id: string;
  abstract name: string;

  abstract getAuthorizationUrl(state: string): string;
  abstract getProfile(code: string, state: string): Promise<SsoProfile>;

  // Bearer-токен — автоматическая аутентификация на каждый запрос
  async authenticate(request: unknown): Promise<AuthResult | null> {
    const req = request as FastifyRequest;
    const token = this.extractBearer(req);
    if (!token) return null;
    const payload = await this.verifyToken(token);
    if (!payload) return null;
    const credential = await findCredential(this.id, payload.sub);
    if (!credential) return null;
    const user = await findUser(credential.userId);
    return user ? { user } : null;
  }

  protected abstract extractBearer(req: FastifyRequest): string | null;
  protected abstract verifyToken(token: string): Promise<SsoProfile | null>;
}
```

### 3.2. SsoRegistry (sso-registry.ts)

```ts
class SsoRegistry {
  private providers = new Map<string, AbstractSsoProvider>();

  register(provider: AbstractSsoProvider): void {
    this.providers.set(provider.id, provider);
  }
  get(id: string): AbstractSsoProvider | undefined {
    return this.providers.get(id);
  }
  getAll(): AbstractSsoProvider[] {
    return [...this.providers.values()];
  }
}
```

Регистрируется как сервис: `context.services.register('sso-registry', registry)`.

### 3.3. Роуты (routes.ts)

| Метод | Путь | Назначение |
|-------|------|-----------|
| `GET` | `/api/auth/sso/:provider` | Редирект на провайдера (state = HMAC(session.id)) |
| `GET` | `/api/auth/sso/:provider/callback` | Принимает code, получает профиль, auto-provision, логинит |
| `POST` | `/api/auth/sso/link` | Привязывает SSO к текущему пользователю (из сессии) |
| `POST` | `/api/auth/sso/unlink` | Отвязывает SSO от текущего пользователя |
| `GET` | `/api/auth/sso/providers` | Список настроенных провайдеров для фронта |

**Callback handler — user provisioning**:

```ts
async function handleCallback(provider, code, state, request, reply) {
  const profile = await provider.getProfile(code, state);

  // 1. Поиск существующей привязки
  let credential = await findCredential(provider.id, profile.sub);
  if (credential) {
    const user = await findUser(credential.userId);
    if (user) {
      authService.login(request, reply, user);
      return reply.redirect(frontendUrl);
    }
  }

  // 2. Auto-provision: создаём пользователя, если нет
  const [user] = await db.insert(identityUser).values({
    login: profile.email ?? `${provider.id}_${profile.sub}`,
  }).returning();

  // 3. Сохраняем credential
  await db.insert(ssoCredential).values({
    userId: user.id,
    provider: provider.id,
    sub: profile.sub,
    email: profile.email,
    name: profile.name,
    rawJson: profile,
  });

  authService.login(request, reply, { id: user.id, login: user.login });
  return reply.redirect(frontendUrl);
}
```

### 3.4. setup.ts

```ts
setup(context) {
  // Миграции
  context.migrations.register('auth-sso', migrationsPath);

  // Реестр провайдеров
  const registry = new SsoRegistry();

  // Провайдеры конфигурируются из env
  if (process.env.SSO_GOOGLE_CLIENT_ID) {
    registry.register(new GoogleProvider({
      clientId: process.env.SSO_GOOGLE_CLIENT_ID,
      clientSecret: process.env.SSO_GOOGLE_CLIENT_SECRET,
      redirectUri: `${publicUrl}/api/auth/sso/google/callback`,
    }));
  }
  if (process.env.SSO_GITHUB_CLIENT_ID) {
    registry.register(new GitHubProvider({ ... }));
  }

  context.services.register('sso-registry', registry);

  // Регистрируем провайдеров в auth-service (для Bearer-аутентификации)
  const authService = context.services.resolve<BackendAuthService>('auth-service');
  for (const p of registry.getAll()) {
    authService.registerProvider(p);
  }

  // Роуты
  context.routes.register('get', '/api/auth/sso/:provider', createInitiateHandler(registry));
  context.routes.register('get', '/api/auth/sso/:provider/callback', createCallbackHandler(registry, authService, authLog));
  context.routes.register('post', '/api/auth/sso/link', createLinkHandler(registry, authService));
  context.routes.register('post', '/api/auth/sso/unlink', createUnlinkHandler(registry));
  context.routes.register('get', '/api/auth/sso/providers', createProvidersHandler(registry));

  // Документы
  extendUserDoc(context.documents);
}
```

---

## 4. Frontend

### 4.1. sso-login-buttons.tsx

Запрашивает список провайдеров, рендерит кнопки:

```tsx
export function SsoLoginButtons() {
  const { data: providers } = useQuery({
    queryKey: ['sso', 'providers'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/auth/sso/providers'),
  });

  if (!providers?.length) return null;

  return (
    <div className="space-y-2">
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">или войти через</span>
        </div>
      </div>
      {providers.map(p => (
        <a key={p.id} href={`/api/auth/sso/${p.id}`}>
          <Button variant="outline" className="w-full">{p.name}</Button>
        </a>
      ))}
    </div>
  );
}
```

### 4.2. setup.tsx

```tsx
export const authSsoFrontendModule: FrontendModule = {
  ...moduleManifest,
  setup(context) {
    context.slots.register('auth:login-page:additional', <SsoLoginButtons />);
  },
};
```

Для отображения кнопок в `LoginPage` из `auth-password` нужно добавить `<Slot name="auth:login-page:additional" />`. Либо через `context.slots.override` полностью заменить страницу логина на гибридную (пароль + SSO).

---

## 5. Интеграция с приложением

**apps/api/src/index.ts**:
```ts
import { authSsoModule } from '@amplicada/module-auth-sso/backend';
await bootstrap(app, [authPasswordModule, authSsoModule, ...], context);
```

**apps/web/src/main.tsx**:
```ts
import { authSsoFrontendModule } from '@amplicada/module-auth-sso/frontend';
await bootstrapFrontend([authPasswordFrontendModule, authSsoFrontendModule, ...], context);
```

**apps/web/src/index.css**:
```css
@import "@amplicada/module-auth-sso/frontend/tailwind.css";
```

После этого `pnpm install` для линковки.

---

## 6. Провайдеры (v1)

### Google

- `authorization_endpoint`: `https://accounts.google.com/o/oauth2/v2/auth`
- `token_endpoint`: `https://oauth2.googleapis.com/token`
- `userinfo_endpoint`: `https://openidconnect.googleapis.com/v1/userinfo`
- Scopes: `openid email profile`
- Верификация Bearer-токена: JWKS с `https://www.googleapis.com/oauth2/v3/certs`

### GitHub

- `authorization_endpoint`: `https://github.com/login/oauth/authorize`
- `token_endpoint`: `https://github.com/login/oauth/access_token`
- `userinfo_endpoint`: `https://api.github.com/user`
- Scopes: `read:user user:email`
- Bearer-токен верифицируется через introspection: `https://api.github.com/applications/{client_id}/token`

### Generic OIDC

- Конфигурируется через `discovery_url` (`.well-known/openid-configuration`)
- JWKS-верификация id_token
- Подходит для Azure AD, Keycloak, Okta, любого OIDC-провайдера

---

## 7. Граничные случаи и безопасность

- **state + PKCE**: параметр `state` содержит HMAC-подпись session.id + nonce. В callback проверяется, что state не был подменён.
- **auto-provision vs link**: если пользователь уже в сессии (link) — не создаём новый аккаунт, а привязываем к текущему. Если не в сессии — auto-provision.
- **unlink**: нельзя отвязать единственный способ входа, если у пользователя нет password_hash. Проверка перед unlink.
- **rate limiting**: на `/api/auth/sso/:provider` — ограничение по IP.
- **audit**: все логины/логауты пишутся в `auth_log` через `BackendAuthLogService`.
- **конфигурация**: client_secret и другие секреты — только из env, никогда в коде или конфиг-файлах.

---

## 8. Декомпозиция работ

| Шаг | Что делать | Зависит от |
|-----|-----------|-----------|
| 1 | Создать пакет `packages/module-auth-sso/`, package.json, tsconfig.json | — |
| 2 | schema + migration (`sso_credential`) | шаг 1 |
| 3 | `AbstractSsoProvider` + `SsoRegistry` (services) | шаг 1 |
| 4 | `GoogleProvider` | шаг 3 |
| 5 | `GitHubProvider` | шаг 3 |
| 6 | `OidcProvider` (generic) | шаг 3 |
| 7 | routes: initiate + callback + link + unlink + providers | шаг 3 |
| 8 | document extension (`user` doc) | шаг 1 |
| 9 | `setup.ts` (backend module registration) | шаги 2-8 |
| 10 | `sso-login-buttons.tsx` + `setup.tsx` (frontend) | шаг 1 |
| 11 | Интеграция в apps/api, apps/web | шаги 9-10 |
| 12 | Добавить `<Slot name="auth:login-page:additional" />` в LoginPage auth-password | шаг 10 |
| 13 | Проверка: `pnpm build`, `pnpm typecheck` | шаги 1-12 |
