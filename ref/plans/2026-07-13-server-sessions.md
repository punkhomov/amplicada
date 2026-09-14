---
title: Безопасные серверные сессии
type: plan
tier: 4
status: implemented
date: 2026-07-09
note: RedisStore, AuthServiceImpl, bcrypt — всё реализовано.
---

# План: Безопасные серверные сессии

> **Статус:** Частично реализовано
> **Дата:** 2026-07-09

---

## Текущие проблемы

1. **Токен = base64(JSON)** — не подписан, любой может подделать `{id, login, exp}`
2. **Пароль хранится в открытом виде** — `passwordHash !== password` без хеширования
3. **Нет серверных сессий** — невозможно отозвать сессию досрочно
4. **Нет автоматической очистки** — истёкшие токены остаются валидными

## Решение

- **`@fastify/session`** — стандартный плагин сессий для Fastify, подписанный cookie (HMAC)
- **Redis** — быстрое server-side хранилище сессий с TTL
- **bcrypt** — хеширование паролей
- **Кастомный RedisStore** — адаптация connect-redis под `@fastify/session` интерфейс

---

## Архитектура

```
Browser                     Server                          Redis
  │                           │                               │
  │  POST /api/auth/login     │                               │
  │  {login, password}        │                               │
  │ ─────────────────────────>│                               │
  │                           │  bcrypt.compare()             │
  │                           │  session.set('user', user)    │
  │                           │ ─────────────────────────────>│ SET sess:<id> {user, cookie} EX 3600
  │                           │ <─────────────────────────────│ OK
  │  Set-Cookie: session=...  │                               │
  │<──────────────────────────│                               │
  │                           │                               │
  │  GET /api/auth/me         │                               │
  │  Cookie: session=...      │                               │
  │ ─────────────────────────>│                               │
  │                           │  session.get('user')          │
  │                           │ ─────────────────────────────>│ GET sess:<id>
  │                           │ <─────────────────────────────│ {user, cookie}
  │  {user: {id, login}}     │                               │
  │<──────────────────────────│                               │
```

### Что даёт `@fastify/session`

- Подписанный cookie (HMAC SHA-256 с секретом) — нельзя подделать
- Серверная валидация — токен ищется в Redis, не декодируется на клиенте
- `rolling: true` — сброс TTL при каждом запросе (Activity-based expiry)
- `request.session.get/set/destroy/regenerate` — удобный API
- Совместимость с express-session store интерфейсом

### Почему Redis, а не PostgreSQL для сессий

- Сессии — ephemeral данные с TTL, Redis заточен под это
- `SETEX` — атомарная запись с expiry, без доп. колонок
- Автоматическая очистка через `maxmemory-policy`
- Не нагружает PostgreSQL (который и так хранит business-данные)

---

## Зависимости

### Новые пакеты

| Пакет | Куда | Зачем |
|-------|------|-------|
| `@fastify/session` | platform-core (dep) | Плагин сессий |
| `redis` | platform-core (dep) | Redis-клиент (node-redis) |
| `bcrypt` | module-auth-password (dep) | Хеширование паролей |
| `@types/bcrypt` | module-auth-password (devDep) | Типы bcrypt |

### Инфраструктура

| Ресурс | Где | Зачем |
|--------|-----|-------|
| Redis 7 container | docker-compose (prod + dev) | Хранилище сессий |
| `SESSION_SECRET` env var | docker-compose | HMAC-ключ для подписи cookie (≥32 символов) |
| `REDIS_URL` env var | docker-compose | Подключение к Redis |

---

## Изменения по файлам

### Docker (2 файла)

#### `docker-compose.yaml` (prod)

Добавить сервис `redis`:

```yaml
redis:
  image: redis:7-alpine
  container_name: amplicada-redis
  ports:
    - "6379:6379"
  volumes:
    - redisdata:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
  deploy:
    resources:
      limits:
        cpus: "0.5"
        memory: 512M
```

Добавить в `api`:
```yaml
environment:
  - REDIS_URL=redis://redis:6379
  - SESSION_SECRET=change-me-in-production-at-least-32-chars!!
depends_on:
  redis:
    condition: service_healthy
```

Добавить volume:
```yaml
volumes:
  pgdata:
  redisdata:   # <-- новый
```

#### `docker-compose.dev.yaml` (dev)

Аналогично — добавить `redis` сервис + env vars для `api`.

---

### platform-core: package.json

Добавить зависимости:
```json
{
  "dependencies": {
    "@fastify/session": "^11.1.1",
    "redis": "^4.7.0"
  }
}
```

---

### platform-core: contracts/backend/auth.ts

Обновить сигнатуры — `login` и `logout` теперь принимают `request`:

```typescript
export interface BackendAuthProvider {
  id: string
  authenticate(request: unknown): Promise<AuthResult | null>
}

export interface BackendAuthService {
  registerProvider(provider: BackendAuthProvider): void
  authenticate(request: unknown): Promise<AuthResult | null>
  login(request: unknown, reply: unknown, user: User): void
  logout(request: unknown, reply: unknown): void
  getCurrentUser(request: unknown): User | null
}
```

---

### platform-core: backend/session/redis-store.ts (НОВЫЙ ФАЙЛ)

Кастомный RedisStore, реализующий `SessionStore` из `@fastify/session`.

---

### platform-core: backend/auth-service.ts (REWRITE)

Удаляем base64 токены, используем `request.session`:

```typescript
import type { FastifyRequest } from "fastify"
import type { User, AuthResult } from "../contracts/auth.js"
import type { BackendAuthService, BackendAuthProvider } from "../contracts/backend/auth.js"

export class AuthServiceImpl implements BackendAuthService {
  private providers: BackendAuthProvider[] = []

  registerProvider(provider: BackendAuthProvider): void {
    this.providers.push(provider)
  }

  async authenticate(request: unknown): Promise<AuthResult | null> {
    const req = request as { cookies?: Record<string, string> }
    for (const provider of this.providers) {
      const result = await provider.authenticate(req)
      if (result) return result
    }
    return null
  }

  login(request: unknown, reply: unknown, user: User): void {
    const req = request as FastifyRequest
    req.session.set("user", user)
  }

  logout(request: unknown, _reply: unknown): void {
    const req = request as FastifyRequest
    req.session.destroy()
  }

  getCurrentUser(request: unknown): User | null {
    const req = request as FastifyRequest
    return req.session.get("user") ?? null
  }
}
```

**Что удалено:**
- `createToken()` — больше не нужен (Redis хранит сессию)
- `verifyToken()` — больше не нужен
- `COOKIE_NAME` — `@fastify/session` сам управляет cookie
- Логика `setCookie/clearCookie` — плагин делает это сам

---

### platform-core: backend/app.ts

Добавить регистрацию Redis + `@fastify/session`

**Порядок регистрации плагинов критичен:**
1. `cookie` — обязателен для `session`
2. `session` — использует cookie для подписи
3. `cors` — после session

---

### platform-core: backend/index.ts

Добавить экспорт RedisStore.

---

### module-auth-password: package.json

Добавить зависимости: `bcrypt`, `@types/bcrypt`.

---

### module-auth-password: src/backend/plugin.ts

Использовать `bcrypt.compare` вместо plaintext сравнения.

---

### module-auth-password: src/backend/routes.ts

Передавать `request` в `login`/`logout`.

---

### module-auth-password: migrations/0002_rehash_admin_password.sql (НОВЫЙ)

Обновить хеш пароля admin на bcrypt.

---

### module-auth-password: migrations/meta/_journal.json

Добавить запись для новой миграции.

---

## Не трогаем

| Файл | Почему |
|------|--------|
| `apps/api/src/index.ts` | `createApp()` и `bootstrap()` интерфейс не меняется |
| `apps/web/src/routes/home.tsx` | API `/api/auth/me` совместим |
| `packages/module-auth-password/src/frontend/login-page.tsx` | API `/api/auth/login` совместим |
| `packages/platform-core/src/backend/auth-middleware.ts` | Работает через `getCurrentUser()` — интерфейс не изменился |
| `packages/platform-core/src/contracts/auth.ts` | `User` и `AuthResult` без изменений |

---

## Порядок реализации

### Шаг 1: Docker — Redis контейнер
1. `docker-compose.yaml` — добавить сервис `redis` + volume `redisdata` + env vars в `api`
2. `docker-compose.dev.yaml` — аналогично
3. Проверить: `docker compose up redis` → `redis-cli ping` → PONG

### Шаг 2: platform-core — зависимости
4. `packages/platform-core/package.json` — добавить `@fastify/session`, `redis`
5. `pnpm install`

### Шаг 3: platform-core — RedisStore
6. Создать `packages/platform-core/src/backend/session/redis-store.ts`
7. Реализовать `RedisStore`

### Шаг 4: platform-core — контракты
8. `packages/platform-core/src/contracts/backend/auth.ts` — обновить сигнатуры `login`/`logout`

### Шаг 5: platform-core — AuthServiceImpl
9. `packages/platform-core/src/backend/auth-service.ts` — rewrite

### Шаг 6: platform-core — app.ts
10. `packages/platform-core/src/backend/app.ts` — добавить Redis + session регистрацию

### Шаг 7: platform-core — exports
11. `packages/platform-core/src/backend/index.ts` — добавить экспорт `RedisStore`

### Шаг 8: module-auth-password — зависимости
12. `packages/module-auth-password/package.json` — добавить `bcrypt`, `@types/bcrypt`
13. `pnpm install`

### Шаг 9: module-auth-password — bcrypt
14. `packages/module-auth-password/src/backend/plugin.ts` — `bcrypt.compare`
15. `packages/module-auth-password/src/backend/routes.ts` — передавать `request`

### Шаг 10: module-auth-password — миграция
16. Сгенерировать bcrypt хеш: `node -e "console.log(require('bcrypt').hashSync('123456', 10))"`
17. Создать `packages/module-auth-password/migrations/0002_rehash_admin_password.sql`
18. Обновить `packages/module-auth-password/migrations/meta/_journal.json`

### Шаг 11: Сборка и проверка
19. `pnpm build` — все 4 пакета должны собраться без ошибок
20. `docker compose up` — проверить что Redis + Postgres стартуют
21. `docker compose logs api` — проверить что сессии работают
22. В браузере: логин → `/api/auth/me` возвращает user → logout → `/api/auth/me` возвращает 401

---

## Проверка

### Ручные тесты

1. **Login:** `POST /api/auth/login` с `{login: "admin", password: "123456"}` → 200 + cookie `session`
2. **Me:** `GET /api/auth/me` с cookie → 200 `{user: {id, login}}`
3. **Logout:** `POST /api/auth/logout` → 200 + cookie очищен
4. **Me после logout:** `GET /api/auth/me` → 401
5. **Неверный пароль:** `POST /api/auth/login` с `{login: "admin", password: "wrong"}` → 401

### Redis проверка

```bash
docker exec -it amplicada-redis redis-cli
> KEYS sess:*
> GET sess:<session-id>
```

### Автоматические тесты (будущее)

- Unit: RedisStore (get/set/destroy/touch)
- Integration: login → me → logout → me (401)
- Security: невалидный cookie → 401, истёкшая сессия → 401
