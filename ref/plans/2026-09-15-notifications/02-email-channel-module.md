---
title: module-notification-email — SMTP-транспорт и адресная книга
type: plan
tier: 2
status: implemented
date: 2026-09-15
---

# 02. `module-notification-email`

## Текущая проблема

- Почтового транспорта нет; email пользователя в core-identity тоже нет — `identity_user` знает
  только `login` (ADR-01: «No email field»).
- Адрес, по которому слать сброс пароля/приглашение, хранить негде.

## Решение

Новый пакет `packages/module-notification-email` — первый канальный модуль. Он владеет **и
транспортом, и адресной книгой**:

- если `SMTP_HOST` задан — регистрирует канал `email` в core-сервисе `notification`;
  если нет — модуль молча логирует «SMTP не сконфигурирован» и не регистрирует канал (узел без
  почты живёт);
- таблица `notification_email.user_email` — email пользователя; редактируется в карточке
  пользователя через document extension (как `passwordHash` у `module-auth-password`), сохранение
  админом считается подтверждением (`verified_at`);
- `resolveAddress` возвращает адрес только при непустом `verified_at` — неподтверждённые адреса в
  рассылку не попадают (задел под самостоятельную смену email с верификацией, фаза auth).

`module-auth-password` при этом **не зависит** от этого пакета: он шлёт `notification.send({ userId, kind })`,
а адрес и транспорт резолвит канал.

## Структура пакета

```
packages/module-notification-email/
├── package.json            # @amplicada/module-notification-email, 4 subpath exports, nodemailer
├── tsconfig.json           # по образцу module-hr-learning
├── migrations/
│   ├── 0000_init.sql       # schema notification_email + user_email
│   └── meta/_journal.json
└── src/
    ├── contracts/
    │   ├── manifest.ts
    │   └── index.ts
    ├── backend/
    │   ├── index.ts
    │   ├── setup.ts
    │   ├── documents/user.ts
    │   ├── locales/{index.ts,ru.json,en.json}
    │   ├── schemas/{_schema.ts,user-email.ts,index.ts}
    │   └── services/email-channel.ts
    └── frontend/
        ├── index.ts
        ├── setup.tsx       # locales для меток в админке; своих страниц нет
        └── tailwind.css
```

## Схема и миграция

`notification_email.user_email`:

```sql
CREATE SCHEMA IF NOT EXISTS "notification_email";

CREATE TABLE IF NOT EXISTS "notification_email"."user_email" (
  "user_id" uuid PRIMARY KEY REFERENCES "core"."identity_user"("id") ON DELETE cascade,
  "email" varchar(320) NOT NULL,
  "verified_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_email_email_unique" UNIQUE ("email")
);
```

`UNIQUE(email)` — не два пользователя на один адрес: иначе сброс пароля неоднозначен. Email хранится
в нижнем регистре (нормализует модуль).

`schemas/_schema.ts` — `pgSchema('notification_email')`, `services/email-channel.ts` — реализация
`NotificationChannel`:

```ts
export class EmailChannel implements NotificationChannel {
  readonly id = 'email';

  constructor(private db: BackendDbService, private transport: Transporter, private from: string) {}

  async resolveAddress(userId: string): Promise<string | null> {
    const [row] = await this.db.select().from(userEmail).where(eq(userEmail.userId, userId)).limit(1);
    return row?.verifiedAt ? row.email : null;
  }

  async send(message: ResolvedNotification): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.address,
      subject: message.subject,
      text: message.body,
      html: message.html ?? undefined,
    });
  }
}
```

SMTP-конфиг читается в `setup.ts` из env (секреты — только env, ничего в коде):

| Переменная | Дефолт | Смысл |
|------------|--------|-------|
| `SMTP_HOST` | — | Нет → канал не регистрируется |
| `SMTP_PORT` | `587` (`1025` для Mailpit) | Порт |
| `SMTP_SECURE` | `false` | TLS-обёртка (`true` для 465) |
| `SMTP_USER` / `SMTP_PASSWORD` | — | Если заданы — передаются в transport |
| `SMTP_FROM` | `Amplicada <no-reply@amplicada.local>` | Отправитель |

## Document extension

`documents/user.ts` — по образцу `module-auth-password/src/backend/documents/user.ts` (ручные
`load`/`save`, потому что `save` вычисляет `verified_at`):

```ts
docs.objects.extend('user', {
  module: 'notification-email',
  layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.SECURITY]: {} } },
  fields: {
    email: { label: 'notification-email:field_email', widget: 'text' },
    verifiedAt: { label: 'notification-email:field_verified_at', widget: 'datetime', readonly: true },
  },
  load: async (db, docId) => { /* select userEmail → { email, verifiedAt } */ },
  save: async (tx, id, data) => {
    const { email } = data as { email?: string };
    if (!email) return;
    await tx.insert(userEmail)
      .values({ userId: id, email: email.toLowerCase(), verifiedAt: new Date() })
      .onConflictDoUpdate({ target: userEmail.userId, set: { email: email.toLowerCase(), verifiedAt: new Date(), updatedAt: new Date() } });
  },
});
```

Сохранение админом = подтверждение. Позже, когда появится самостоятельная смена email, эта же таблица
получит путь «пользователь меняет → verified_at сбрасывается → письмо-подтверждение»; текущее решение
миграции не потребует.

## setup.ts

```ts
setup(context) {
  context.migrations.register('notification-email', migrationsPath);
  extendUserDoc(context.documents);

  const smtp = readSmtpConfig(process.env);
  if (!smtp) {
    logger.info('SMTP не сконфигурирован — канал email не зарегистрирован');
    return;
  }

  const db = context.services.resolve<BackendDbService>('db');
  const notification = context.services.resolve<BackendNotificationService>('notification');
  notification.registerChannel(new EmailChannel(db, nodemailer.createTransport({...}), smtp.from));
}
```

## Подключение

- `apps/api/src/index.ts` — `notificationEmailModule` в массив bootstrap (после `authPasswordModule`,
  порядок не критичен).
- `apps/web/src/main.tsx` — `notificationEmailFrontendModule` (нужен ради locales меток).
- `apps/web/src/index.css` — `@import "@amplicada/module-notification-email/frontend/tailwind.css";`.
- `pnpm install` для линковки workspace-пакета.

## Зависимости

| Пакет | Где | Зачем |
|-------|-----|-------|
| `nodemailer` ^7 (dependency) | module-notification-email | SMTP-транспорт |
| `@types/nodemailer` (dev) | там же | Типы |

## Изменения по файлам

| Файл | Действие |
|------|----------|
| `packages/module-notification-email/**` | + новый пакет целиком |
| `apps/api/src/index.ts` | + backend-модуль в bootstrap |
| `apps/web/src/main.tsx`, `apps/web/src/index.css` | + frontend-модуль и tailwind-импорт |
| `pnpm-lock.yaml` | пересборка после `pnpm install` |

## Порядок реализации

- [x] Каркас пакета (package.json/tsconfig/бочки экспортов), `pnpm install`
- [x] Схема + миграция `0000_init`, `_journal.json`
- [x] Document extension с ручными `load`/`save` + locales (backend и frontend)
- [x] `EmailChannel` + чтение SMTP-конфига + регистрация в `notification`
- [x] Провод в apps, `pnpm build && pnpm typecheck && pnpm lint`

## Проверка

1. Без `SMTP_HOST` — приложение стартует, в логе «канал email не зарегистрирован», `send` вернул
   `null`.
2. С Mailpit ([04](./04-dev-infra-and-adr.md)) — задать email пользователю в админке, вызвать
   `notification.send({ userId, kind: 'test', subject, body, html })` → письмо в Mailpit (text и html
   видны оба), строка `sent`.
3. Сменить email в карточке → `verified_at` обновился; очистить `verified_at` в БД → `resolveAddress`
   возвращает `null`, доставки нет.
4. Повторная регистрация канала/перезапуск — канал не дублируется (Map по id).
5. `UNIQUE(email)` — попытка сохранить занятый адрес даёт 409 через маппинг ошибок БД.
