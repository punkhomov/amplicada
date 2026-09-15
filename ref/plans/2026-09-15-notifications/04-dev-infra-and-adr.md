---
title: Mailpit в dev, ADR-04 и обновление документации
type: plan
tier: 2
status: draft
date: 2026-09-15
---

# 04. Dev-инфраструктура, ADR-04 и документация

## Текущая проблема

- Проверять почту живьём не на чем: внешний SMTP в dev-контуре не нужен, а мок-транспорт не
  проверяет ни nodemailer, ни формат письма.
- Архитектурное решение «маршрутизация в ядре, транспорт и адресные книги в модулях» попадает в
  tier 1 (меняет архитектуру), значит должен быть зафиксирован ADR до/вместе с реализацией.

## Решение

### 1. Mailpit в dev-инфраструктуру

`docker-compose.infra.yaml` — сервис `mailpit` (SMTP-ловушка + веб-UI):

```yaml
  mailpit:
    image: axllent/mailpit
    ports:
      - "127.0.0.1:1025:1025"   # SMTP
      - "127.0.0.1:8025:8025"   # Web UI
```

Письма не уходят наружу, веб-UI на <http://127.0.0.1:8025> — смотреть text/html, вложения, заголовки.

`.env.host.example`:

```dotenv
# SMTP (dev: Mailpit из docker-compose.infra.yaml, UI http://127.0.0.1:8025)
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM=Amplicada <no-reply@amplicada.local>
# SMTP_USER=
# SMTP_PASSWORD=
# Уведомления (дефолты совпадают со значениями ниже)
# NOTIFICATION_MAX_ATTEMPTS=5
# NOTIFICATION_RETRY_BASE_MS=30000
# NOTIFICATION_RETENTION_DAYS=30
```

Без `SMTP_HOST` узел стартует без почтового канала — это штатный режим, не ошибка.

### 2. ADR-04 (English, tier 1)

`ref/adr/04-notifications.md`, скелет:

- **Status**: Accepted (после реализации — Implemented).
- **Context**: уведомления нужны минимум трём доменам (auth, workflow, learning); `task.alert` без
  канала; core-таски без ретраев; контакты (email/телефон) — не свойство парольного метода и не поле
  `identity_user` (ADR-01).
- **Decision**: маршрутизация и надёжность (outbox, ретраи, ретенция) — core-сервис `notification`;
  транспорт **и адресная книга** — канальные модули; отправитель знает только `userId` и `kind`.
- **Rationale**: альтернативы — (а) отдельный `module-notification` (тихие no-op у потребителей,
  `task.alert` снова без доставки); (б) адреса в `identity_user` (против ADR-01, конфликт с HR/SSO);
  (в) прямой SMTP из обработчиков (нет ретраев, сеть в request path).
- **Consequences**: + новый core-сервис и таблица; + пакет `module-notification-email`; адресные книги
  множатся по каналам, но не текут в ядро; eager-доставка требует живой БД у вызывающего (строка
  коммитится до попытки отправки).
- **Related**: ADR-01 (identity minimal), ADR-02 (service locator vs extension points), планы
  `2026-09-15-auth-node-method`, `2026-07-14-task-scheduler/04-reliability`.

### 3. Документация

- `ref/README.md` — строка папки `plans/2026-09-15-notifications/` и строка `adr/04-notifications.md`
  в ADR-таблице.
- `ref/context.md` — после реализации: заменить оговорку про отсутствие канала уведомлений в
  `Current Priorities` (если она там появится) и добавить ключевые слова: `notification`,
  `notification_outbox`, `NotificationChannel`, `module-notification-email`, `SMTP_HOST`.
- Корневой `README.md` не трогаем: он ссылается на `.env.host.example` обобщённо.

## Изменения по файлам

| Файл | Действие |
|------|----------|
| `docker-compose.infra.yaml` | + сервис `mailpit` |
| `.env.host.example` | + SMTP и `NOTIFICATION_*` |
| `ref/adr/04-notifications.md` | + ADR |
| `ref/README.md` | + строки плана и ADR |
| `ref/context.md` | обновление после реализации |

## Порядок реализации

- [ ] Mailpit в compose + переменные в `.env.host.example`
- [ ] ADR-04
- [ ] Строки в `ref/README.md`
- [ ] Обновление `ref/context.md` после живой проверки (шаг финальный)

## Проверка

1. `pnpm infra:up` → `http://127.0.0.1:8025` открывается, Mailpit пуст.
2. Тестовое письмо из `module-notification-email` приходит в Mailpit с text и html частями.
3. ADR-04 присутствует в карте `ref/README.md`, ссылки живые.
