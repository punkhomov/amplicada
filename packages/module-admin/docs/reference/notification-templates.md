---
title: "Шаблоны уведомлений"
type: reference
updated: 2026-09-17
verified_commit: 463862e6
order: 30
---

# Шаблоны уведомлений

Админский конструктор писем и ручная рассылка выбранным пользователям. Шаблон — документ типа
`notification-template`, которым владеет `module-admin`; контент хранится в таблице
`admin.notification_template`, доставка идёт через core-сервис `notification`.

## Документ и схема

| Что | Значение | Где в коде |
|---|---|---|
| Тип документа | `notification-template`, раздел «Документы» на дашборде | `src/backend/documents/notification-template.ts` |
| Список | `/admin/notification-template` (generic CRUD админки) | `src/backend/routes/documents.ts` |
| Таблица | `admin.notification_template` | `migrations/0000_init.sql` |
| Ссылка на дашборде | `/admin/notification-template` | `src/backend/index.ts` |

Поля документа:

| Поле | Тип | Обязательное | Комментарий |
|---|---|---|---|
| `name` | text | да | название шаблона в списке |
| `subject` | text | да | тема письма |
| `locale` | select (`ru`, `en`) | нет | `locale` в `NotificationMessage` |
| `body` | text (plain text) | да | обязательная текстовая часть |
| `html` | text | нет | если пусто — уходит только `body` |

`body` и `html` редактируются компонентом `notification-template-editor` (вкладки «Текст»,
«HTML», «Просмотр»); `subject`, `name`, `locale` — обычные поля карточки. Компонент заменяет бакет
extension'а целиком, поэтому остальные поля он сохраняет сам.

## HTTP API

Все роуты — под общим guard'ом `/api/admin` (`src/backend/index.ts`).

| Метод | Путь | Тело / query | Ответ |
|---|---|---|---|
| `POST` | `/api/admin/notifications/send-template` | `{ templateId: string, userIds: string[] }` | `{ total, queued, skipped, failed }` |

Правила отправки (`src/backend/routes/notifications.ts`):

- отправляется **сохранённая** версия шаблона: UI блокирует кнопку на несохранённой карточке;
- `userIds` нормализуются: только непустые uuid, без дублей, не больше `ADMIN_BROADCAST_MAX_RECIPIENTS` (200) — `src/backend/lib/normalize-recipients.ts`;
- каждому получателю уходит отдельный `notification.send({ userId, kind: 'admin.broadcast', … })`; адрес и канал резолвит канальный модуль, ядро о получателе ничего не знает;
- `queued` — созданные строки outbox, `skipped` — получатели без канала или подтверждённого адреса (`send()` вернул `null`), `failed` — неожиданные ошибки (пишутся в лог сервера);
- `kind` рассылки — `admin.broadcast`; в логе доставок её видно фильтром по kind.

## Выбор получателей

Поиск — через общий список документов `user`: `GET /api/admin/documents/user` с фильтром
`contains` по колонке `core:base:login` (минимум 2 символа, лимит 20). Своего endpoint'а у фичи
нет; выбранные пользователи живут в состоянии диалога
(`src/frontend/widgets/user-picker/`).

## Ошибки

| Код | Когда |
|---|---|
| `400` | пустой или не-uuid `templateId`; не выбран ни один получатель |
| `401` | нет сессии (общий guard админки) |
| `404` | шаблон с таким id не найден |

## Ограничения

- Вложений, отложенной отправки, расписаний и rich-text редактора нет: `body` — plain text,
  `html` — произвольная разметка, предпросмотр рендерится в `iframe` с `sandbox=""` (скрипты
  не исполняются).
- Получатель — только пользователь платформы (`userIds` — id документов `user`); отправить на
  произвольный адрес нельзя.
- Потолок одного запуска — 200 получателей.
- Рассылка не транзакционна: часть получателей может быть пропущена, результат приходит
  счётчиками, повтор — новым запуском.
- Без `SMTP_HOST` (см. `module-notification-email`) канал не зарегистрирован, и все получатели
  попадут в `skipped`.
