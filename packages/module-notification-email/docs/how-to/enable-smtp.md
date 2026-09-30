---
title: "Включить почту на узле"
type: how-to
updated: 2026-09-30
verified_commit: 0551349
order: 21
---

# Включить почту на узле

Канал `email` поднимается только при заданном `SMTP_HOST`. Без него узел стартует штатно,
уведомления не доставляются — в логе будет `SMTP не сконфигурирован`.

1. Задайте переменные окружения узла (см. [reference](../reference/index.md)):
   `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, при необходимости
   `SMTP_USER`, `SMTP_PASSWORD` и `SMTP_SENDERS` (именованные отправители).
2. Перезапустите API. В логе должно появиться `Канал email зарегистрирован` с host и port.
3. Проверьте доставку: выдайте пользователю email (см. [выдать email](./set-user-email.md))
   и отправьте письмо — из кода потребителя через `notification.send(...)`/`sendMany(...)`
   или из админки шаблоном (`/admin/notification-template`, кнопка «Отправить»). Строка
   появится в `/admin/notifications`; в dev письмо смотрите в Mailpit: `http://127.0.0.1:8025`.

Для локальной разработки значения уже есть в `.env.host.example`, а Mailpit поднимается
вместе с остальной инфраструктурой (`pnpm infra:up`).
