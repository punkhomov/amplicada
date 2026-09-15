---
title: Метод аутентификации — свойство узла, логин вне платформы
type: plan
tier: 2
status: implemented
date: 2026-09-15
---

# Метод аутентификации — свойство узла, логин вне платформы

## Текущая проблема

1. `/login` был платформенным роутом: `module-auth-password` регистрировал его с `layout: 'public'`,
   и платформа сама рендерила страницу логина. Слот `auth:login-page` при этом никем не потреблялся.
2. Core жёстко знал `/login` в шести местах: `AppLayout`, `AdminLayout`, `query-client`,
   `useCurrentUser`, `home.tsx` и catch-all в `apps/web`. Узел с другим методом аутентификации
   (kerberos, SSO) платформа обслужить не могла.
3. Не было понятия метода аутентификации узла. `BackendAuthProvider.authenticate()` — мёртвая
   ветка: единственный провайдер всегда возвращал `null`, реальная аутентификация — только сессия.
4. `/api/auth/me` и `/logout` — метод-агностичные роуты, но жили в парольном модуле: узел без
   парольного модуля остался бы без них.

## Решение

Метод аутентификации — свойство узла (деплоя), а не платформы. Модули аутентификации регистрируют
свои методы в core-сервисе `auth-node`; активный метод узел выбирает из env. Core публикует его
через публичный `GET /api/auth/context`. Платформа не знает страниц логина: при 401 она берёт
`loginUrl` активного метода и делает full-page redirect. Парольный логин живёт на своём URL
`/auth/password/login` — роут модуля на `public`-layout (без навигации и меню, только переключатели
языка и темы) — и не упоминается в core.

## Архитектура

```text
Браузер (SPA)                          API (узел)
  │ GET /api/auth/me → 401
  │ GET /api/auth/context ────────────▶ AuthNodeServiceImpl
  │   { method:"password",                ├─ env AUTH_METHOD / AUTH_LOGIN_URL
  │     loginUrl:"/auth/password/login",  └─ AuthMethodResolver — точка расширения (Host и т.п.)
  │     logoutUrl:"/auth/logout" }
  ▼ window.location.replace(loginUrl)    ← полная навигация, годится и для внешнего URL
Страница логина метода (свой URL)
  │ POST /api/auth/login → cookie-сессия
  ▼ navigate(auth:redirect ?? /home)
SPA
```

Ключевые контракты (`platform-core/contracts`):

```ts
interface AuthMethodDescriptor { id: string; loginUrl: string; logoutUrl?: string; }

interface BackendAuthNodeService {
  registerMethod(method: AuthMethodDescriptor): void;
  getMethods(): AuthMethodDescriptor[];
  getActiveMethod(request: unknown): AuthMethodDescriptor | null;
}

interface AuthNodeContext { method: string | null; loginUrl: string | null; logoutUrl: string; }
```

Резолвер активного метода — `AuthMethodResolver` (функция `(request, methods) => descriptor | null`).
Сейчас реализован env-резолвер: `AUTH_METHOD` выбирает зарегистрированный метод; без него берётся
единственный зарегистрированный; если модуля нет, но задан `AUTH_LOGIN_URL` — узел описывает внешний
метод (kerberos-портал, SSO). Позже сюда встаёт выбор метода по `Host`, без изменения контракта.

Фронтенд: `useAuthContext()` читает `/auth/context`; `useRequireAuth()` — гейт защищённых layout'ов;
`redirectToLogin()` сохраняет `auth:redirect` и уводит на `loginUrl`; `useLogout()` выходит по
правилам узла (POST относительного `logoutUrl` или redirect на внешний). Страницы аутентификации
живут под `/auth/*` — 401 с них (неверный пароль) не затирает сохранённый путь возврата.

## Зависимости

| Что | Где | Примечание |
|-----|-----|------------|
| `AUTH_METHOD` | env узла | id зарегистрированного метода (`password`); без него — единственный зарегистрированный |
| `AUTH_LOGIN_URL` | env узла | внешний вход без модуля (kerberos/SSO-портал) |
| `AUTH_LOGOUT_URL` | env узла | внешний выход, опционально |
| `PASSWORD_LOGIN_PATH` | `module-auth-password/contracts/paths.ts` | `/auth/password/login` — один источник для бэкенда и фронта |
| `AuthNodeContext`, `DEFAULT_LOGOUT_URL` | `platform-core/contracts/auth.ts` | общий фронт/бэк контракт |

Новых пакетов и миграций нет.

## Изменения по файлам

| Файл | Действие |
|------|----------|
| `platform-core/src/contracts/auth.ts` | + `AuthNodeContext`, `DEFAULT_LOGOUT_URL` |
| `platform-core/src/contracts/backend/auth.ts` | + `AuthMethodDescriptor`, `BackendAuthNodeService` |
| `platform-core/src/contracts/backend/index.ts`, `contracts/index.ts` | экспорты новых типов |
| `platform-core/src/backend/services/auth-node-service.ts` | + реестр методов, env-резолвер, `AuthMethodResolver` |
| `platform-core/src/backend/routes/auth.ts` | + `context`, перенесены `me` и `logout` из модуля |
| `platform-core/src/backend/app.ts` | регистрация сервиса `auth-node` и core-роутов до setup модулей |
| `platform-core/src/backend/index.ts` | экспорт `AuthNodeServiceImpl` |
| `platform-core/src/frontend/lib/auth-redirect.ts` | + `AUTH_REDIRECT_KEY`, `saveRedirectPath`, `redirectToLogin`, `isLoginLocation`, `isExternalUrl` |
| `platform-core/src/frontend/lib/query-client.ts` | `saveRedirectPath` вынесен, логика 401 без изменений |
| `platform-core/src/frontend/hooks/use-auth-context.ts` | + контекст узла |
| `platform-core/src/frontend/hooks/use-require-auth.ts` | + гейт защищённых layout'ов |
| `platform-core/src/frontend/hooks/use-logout.ts` | + выход по правилам узла |
| `platform-core/src/frontend/hooks/use-current-user.ts` | убран параметр `redirectTo` |
| `platform-core/src/frontend/layouts/app-layout.tsx` | `useRequireAuth` + `useLogout` вместо `/login` |
| `platform-core/src/frontend/index.ts` | экспорты новых хуков/хелперов |
| `module-admin/src/frontend/layouts/admin-layout.tsx` | `useRequireAuth` + `useLogout` вместо `/login` |
| `module-auth-password/src/contracts/paths.ts` | + `PASSWORD_LOGIN_PATH` |
| `module-auth-password/src/backend/setup.ts` | + `registerMethod({ id: 'password', loginUrl })`, − `/me`, `/logout` |
| `module-auth-password/src/backend/routes.ts` | − `createMeHandler`, `createLogoutHandler` |
| `platform-core/src/frontend/layouts/public-layout.tsx` | + шапка с `LanguageSwitcher`/`ThemeSwitcher`, контент по центру |
| `module-auth-password/src/frontend/setup.tsx` | роут `/auth/password/login` на `layout: 'public'`, − мёртвый слот |
| `module-auth-password/src/frontend/pages/login/ui/login-page.tsx` | без собственного full-screen wrapper |
| `apps/web/src/main.tsx` | catch-all → `/home` |
| `apps/web/src/routes/home.tsx` | `useLogout` вместо локальной мутации |
| `.env.host.example` | + `AUTH_METHOD=password`, закомментированные `AUTH_LOGIN_URL`/`AUTH_LOGOUT_URL` |
| `ref/plans/2026-07-22-auth-sso-module.md` | пометка: встраивание через слот отменено, SSO регистрирует свой метод |

## Порядок реализации

- [x] Контракты: `AuthNodeContext`, `AuthMethodDescriptor`, `BackendAuthNodeService`
- [x] Core: `AuthNodeServiceImpl` + env-резолвер (`resolveAuthMethodFromEnv`)
- [x] Core: роуты `/api/auth/context`, перенос `/api/auth/me` и `/api/auth/logout`, регистрация в `bootstrap`
- [x] Модуль: `PASSWORD_LOGIN_PATH`, `registerMethod`, чистка роутов
- [x] Core frontend: `auth-redirect`, хуки `useAuthContext`/`useRequireAuth`/`useLogout`, рефактор `useCurrentUser`
- [x] Core/module-admin: layout'ы без `/login`
- [x] Core: `public`-layout с переключателями языка/темы; модуль frontend: роут `/auth/password/login`, удаление слота
- [x] `apps/web`: catch-all и `home.tsx`
- [x] env и документация

## Проверка

Выполнено:

- `pnpm build`, `pnpm typecheck` — чисто; `pnpm lint` — только унаследованные замечания в нетронутых файлах.
- Живой API против `docker-compose.infra.yaml`:
  - `GET /api/auth/context` при `AUTH_METHOD=password` → `{ method: "password", loginUrl: "/auth/password/login", logoutUrl: "/auth/logout" }`;
  - `GET /api/auth/me` без сессии → 401; `POST /api/auth/logout` → `{ ok: true }`;
  - перезапуск с `AUTH_METHOD=kerberos AUTH_LOGIN_URL=https://idp.example.local/kerberos` → `{ method: "kerberos", loginUrl: "https://idp.example.local/kerberos", logoutUrl: ".../logout" }`.

За пользователем (браузер):

1. Зайти на защищённую страницу (`/home`, `/admin`) без сессии → full-page redirect на `/auth/password/login`, после входа — возврат на исходный URL.
2. Выход → возврат на страницу логина; неверный пароль не зацикливает возврат.
3. Узел с `AUTH_LOGIN_URL` → редирект на внешний адрес.
