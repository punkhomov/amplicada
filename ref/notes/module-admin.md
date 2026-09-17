---
title: module-admin — заметки разработчиков
type: notes
tier: 2
status: implemented
date: 2026-09-16
---

# module-admin — заметки разработчиков

> Стоп-лист (D-001…D-002):
> - Не возвращать прямую регистрацию toolbar через глобальный импорт — D-001 (accepted).
> - Не тащить rich-text редактор шаблонов — D-002 (accepted: textarea + iframe-preview, без зависимостей).
> - Не менять контракт ядра ради рассылок — D-002 (accepted: цикл `notification.send()` в админке).

## D-001. Сервис toolbar и optional-интеграция — accepted (2026-09-16)

**Контекст.** Auth должен работать без установки admin.
**Решение.** Типы toolbar вынесены в contracts, реестр стал frontend-сервисом admin:toolbar.
**Почему именно так.** Нет runtime-импортов из optional peer; экземпляры приложений не делят действия.
**Отвергнуто.** Обязательная админка ради одного действия; молчаливый services.has при
выбранном admin, скрывающий ошибку регистрации сервиса.
**Что изменит решение.** Потребность в интеграции после start или взаимных вызовах setup.
**Грабли.** Другие registry admin остаются глобальными; перенос вне этой задачи. registerToolbarAction удалён.
**Код.** `src/frontend/index.tsx:28, src/frontend/lib/toolbar-action-registry.ts:3`.
**Связано.** [ADR-06](../adr/06-module-conventions.md).

**Подробности D-001.** Сравнение прямого импорта и сервиса через контекст, причина
удаления публичного ChangePasswordAction, гарантии порядка и краткие альтернативы
собраны в [application-tools, D-004](application-tools.md). Это пояснение принятого
решения, не новая смена контракта.

## D-002. Шаблоны уведомлений: документ админки + рассылка циклом `send()` — accepted (2026-09-17)

**Контекст.** Нужен админский конструктор писем: создавать шаблоны, редактировать контент,
сразу отправлять выбранным пользователям. Core-контракт уведомлений умеет только
`send({ userId, kind, … })`; расширять его под рассылки в этой задаче не планировалось.
**Решение.** Шаблон — документ типа `notification-template`, которым владеет module-admin: своя
таблица `admin.notification_template` (миграция `0000_init`), auto load/save по `schema`. Редактор —
зарегистрированный компонент `notification-template-editor`: две textarea (body/html) и
предпросмотр в `iframe sandbox=""`. Отправка — toolbar-действие `notification-template-send` →
`POST /api/admin/notifications/send-template`: читает сохранённый шаблон и делает по одному
`notification.send()` на получателя (`kind: 'admin.broadcast'`, потолок 200).
**Почему именно так.** Document System даёт CRUD, список с фильтрами, аудит и карточку без
страничного кода; админка — владелец management-сущности, core остаётся маршрутизатором
(граница ADR-04 не двигается). Новых зависимостей нет: политика `minimumReleaseAge: 43200` и
отсутствие `allowBuilds` для редактора исключают TipTap/Lexical, а textarea + iframe закрывают задачу.
**Отвергнуто.** Отдельная таблица + своя страница списка/формы — больше кода без аудита и
generic-фильтров; `customFields: true` (jsonb) — путь в репозитории не используется, а NOT NULL-поля
и колонки списка удобнее в таблице; rich-text редактор — новая зависимость под строгой
install-политикой; отправка несохранённого черновика — серверу пришлось бы принимать контент вместо
`templateId` и терять аудит; явные адреса получателей — изменение контракта ядра (см. ADR-04).
**Что изменит решение.** Улучшение контракта уведомлений (bulk/шаблоны/`from`) — рассылку можно
перевести на него, а шаблоны — на core-уровень; появление второго канала (sms) — в шаблон добавится
поле `channel`.
**Грабли.** Auto-save пишет только переданные ключи: обязательные `name/subject/body` должны приехать
в первом сохранении (карточка шлёт весь бакет, но частичное сохранение снаружи упадёт на NOT NULL).
`updatedAt` обновляется `$onUpdate` в схеме. `userIds` — id документов `user` (совпадают с
`identity_user.id`). Пропущенный получатель — не ошибка: нет канала или подтверждённого адреса.
**Код.** `src/backend/documents/notification-template.ts`, `src/backend/routes/notifications.ts`,
`src/frontend/widgets/send-notification-template/`, `migrations/0000_init.sql`
**Связано.** [ADR-04](../adr/04-notifications.md), `packages/module-admin/docs/reference/notification-templates.md`
