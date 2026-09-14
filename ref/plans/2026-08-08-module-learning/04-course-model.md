---
title: module-hr-learning — модель данных курсов
type: plan
tier: 4
status: draft
date: 2026-08-08
parent: ./00-overview.md
---

# 04 — модель данных

Скелет модуля: PG-схема `hr_learning`, пять таблиц, два документа. На эту работу ссылаются `02`
(куда писать пакет), `05` (где лежит `cmi`) и `06` (что показывать). Зависимостей нет — делается
параллельно с `02`.

## Что решено до начала

| Вопрос | Решение | Почему |
|---|---|---|
| Версии пакета | **История**: несколько `packages` на курс, на курсе `current_package_id` | Попытка читается тем пакетом, на котором началась; перезалив не вырывает файлы у того, кто сейчас проходит |
| Виды контента в v1 | `kind` = `scorm12` \| `file` | `file` (PDF регламента, видео + «ознакомлен») почти бесплатен поверх той же инфраструктуры и полезен до появления первого SCORM-пакета |
| Доступ к курсу | Назначение админом **и** самозапись из каталога | `enrollments.source` = `assigned` \| `self`, на курсе `self_enrollable` |
| Что документ | Курс и попытка | Остальное — обычные таблицы: пишутся часто, карточки не имеют |

## Почему назначение — не документ

Соблазн сделать `enrollments` документом (админ назначает курс, создавая запись через generic-карточку)
разбивается о то, что **`widget: 'reference'` в проекте не реализован**: он объявлен в
[`FieldMetadata`](../../../packages/platform-core/src/contracts/documents.ts#L132), но
[`FieldWidget`](../../../packages/module-admin/src/frontend/widgets/field-widget/ui/field-widget.tsx#L40)
не имеет для него ветки и рендерит обычный текстовый инпут. Назначение через карточку означало бы
вписывать UUID пользователя и UUID курса руками.

Поэтому `enrollments` — обычная таблица со своим API и своим диалогом назначения (поиск по людям)
в `06`. Если `reference` когда-нибудь реализуют, вариант «назначение как документ» можно пересмотреть.

## Схема `hr_learning`

```
courses                          ← документ «Курс»
  id                 uuid pk → core.document_index(id)
  code               varchar(100) unique
  title              varchar(255)
  description        text
  active             boolean  default true         -- показывать в каталоге
  self_enrollable    boolean  default true         -- можно записаться самому
  created_at         timestamptz

packages                         -- версия контента курса
  id            uuid pk
  course_id     uuid → courses(id)
  version       int                                -- порядковый номер в рамках курса
  is_current    boolean default false              -- этот пакет открывается при старте курса
  kind          varchar(20)   'scorm12' | 'file'
  status        varchar(20)   'pending' | 'ready' | 'failed'   default 'pending'
  error         text null                          -- текст сбоя распаковки, виден админу
  entry_point   text null                          -- scorm: из манифеста; file: сам файл
  title         varchar(255) null                  -- из imsmanifest.xml
  scorm_version varchar(20) null
  source_key    text                               -- исходный ZIP/файл в S3
  total_files   int    default 0
  total_size    bigint default 0
  uploaded_by   uuid null → core.identity_user(id)
  created_at    timestamptz
  unique (course_id, version)

package_files                    -- инвентарь распакованного: он же whitelist для раздачи (03)
  package_id   uuid → packages(id) on delete cascade
  path         text                                -- относительный путь внутри пакета
  content_type varchar(255)                        -- посчитан при распаковке, не сниффится при отдаче
  size         bigint
  primary key (package_id, path)

enrollments                      -- назначение / самозапись
  id          uuid pk
  course_id   uuid → courses(id)
  user_id     uuid → core.identity_user(id)
  source      varchar(20)  'assigned' | 'self'
  assigned_by uuid null → core.identity_user(id)
  due_at      timestamptz null
  created_at  timestamptz
  unique (course_id, user_id)

attempts                         ← документ «Попытка» (read-only)
  id                 uuid pk → core.document_index(id)
  course_id          uuid → courses(id)
  package_id         uuid → packages(id)           -- чем интерпретировать cmi
  user_id            uuid → core.identity_user(id)
  cmi                jsonb   default '{}'          -- сырое состояние SCORM
  completion         varchar(20) 'not_started' | 'in_progress' | 'completed'
  success            varchar(20) null 'passed' | 'failed'
  score              numeric(6,2) null
  total_time_seconds int     default 0
  session_id         uuid null                     -- lease «одна активная сессия», работает в 05
  manual_override    boolean default false         -- админ проставил «пройден» руками
  started_at         timestamptz
  updated_at         timestamptz null
  completed_at       timestamptz null
```

### Решения по схеме, которые неочевидны

**Попытка не ссылается на `enrollments`.** Денормализованы `course_id` + `user_id`. Иначе снятие
назначения (человек перевёлся, курс отозвали) утащило бы историю прохождения — а она и есть то, ради
чего попытка сделана документом.

**Партиальный уникальный индекс** `(user_id, course_id) where completion <> 'completed'` — на уровне
БД держит решение «одна незавершённая попытка на курс». Пройденных попыток может быть сколько
угодно: «пройти заново» создаёт новую.

**Никакого `deleted_at` в своих таблицах.** Soft-delete живёт в `core.document_index` (этап 2
[06-index-primary](../2026-08-05-document-model/06-index-primary.md)). В `hr-poll/0000_init.sql`
колонка есть, но её удалила миграция `0002` — копировать оттуда baseline по инерции нельзя.

**Признак «текущий пакет» — флаг на пакете, а не указатель на курсе.** Указатель
`courses.current_package_id` дал бы цикл FK с `packages.course_id`, и цена этого не в миграции
(`ALTER` после обеих таблиц — мелочь), а в **удалении**: чтобы снести пакет, надо сначала обнулить
указатель на курсе, чтобы снести курс — обнулить указатель, удалить пакеты, удалить курс. Нелинейно,
и каждый забытый шаг это ошибка FK в рантайме.

Вместо этого `packages.is_current` + партиальный уникальный индекс
`(course_id) WHERE is_current` — ровно тот же приём, что для «одной незавершённой попытки». FK идут
только в одну сторону, удаление линейное, а откат на прошлую версию — одно переключение флага в
транзакции (снять со старого, поставить новому).

Рассматривался и вариант вовсе без флага: текущим считать последний `ready`. Проще, но теряется
откат — залитую кривую версию пришлось бы удалять, чтобы вернуться на предыдущую.

Кто ставит флаг: пакет, дошедший до `ready`, становится текущим автоматически (`02`); ручное
переключение между версиями — на карточке курса (`06`).

**FK на `document_index` — сразу в baseline.** Модуль новый, легаси-строк нет, отдельная миграция
вроде `hr-poll/0001_document_index_fk.sql` не нужна.

**`score numeric(6,2)`**, а не int: SCORM 1.2 не обязывает шкалу быть 0–100, а `cmi.core.score.raw`
приходит строкой произвольного вида — нормализация в `05`.

## Документы

### «Курс» — `learning-course`

`creatable: true`, `deletable: true`, `softDelete: true`. Поля: `code`, `title`, `description`,
`active`, `self_enrollable`. Плюс read-only вывод текущего пакета (вид, версия, статус, текст ошибки)
и component-ячейка `learning-package-upload` — сам компонент в `06`, здесь только объявление
раскладки, как `poll-questions-editor` в `module-hr-poll`.

Список: `code`, `title`, `active`, статус текущего пакета.

### «Попытка» — `learning-attempt`

По образцу [`poll-response`](../../../packages/module-hr-poll/src/backend/documents/poll-response.ts):

- `creatable: false` — попытки заводит плеер, не админ;
- object-extension **без `schema`**: `saveExtensionData` тогда пропускает сохранение целиком, и
  попытку не отредактировать прямым `PUT` мимо readonly в UI;
- `deletable: true` с явным `remove` — своей таблицы у типа документа нет, без `remove` строка
  пережила бы удаление документа, а `document_index` не удалился бы вовсе (на него FK);
- **создание строки только через `documentRuntime.allocateDocumentId('learning-attempt', tx)`** в
  той же транзакции. Ровно на этом уже споткнулся `module-hr-poll`
  (entry);
- **коммиты `cmi` — прямым `UPDATE`**, не через `DocumentRuntime.update()`: SCORM автокоммитит часто,
  а `update()` прогоняет все расширения в транзакции.

**Известное ограничение v1:** на карточке `load` резолвит `user_id`/`course_id` в логин и название
(readonly-текст), но **в списке останутся UUID** — колонки списка читаются прямо из таблицы, а
`reference` не реализован. Лечится либо реализацией `reference`, либо view под список; в v1 живём
с UUID.

## Изменения по файлам

| Файл | Действие |
|---|---|
| `packages/module-hr-learning/package.json`, `tsconfig.json` | создать по образцу `module-hr-poll` |
| `src/contracts/manifest.ts` | `id: 'hr-learning'`, `dependencies: []` |
| `src/contracts/index.ts` | `LearningDocuments`, `PackageKind`, `PackageStatus`, `AttemptCompletion`, DTO каталога |
| `src/backend/schemas/_schema.ts` | `pgSchema('hr_learning')` |
| `src/backend/schemas/{courses,packages,package-files,enrollments,attempts}.ts` + `index.ts` | пять таблиц + типы |
| `src/backend/documents/{course,attempt}.ts` + `index.ts` | регистрация двух документов |
| `src/backend/locales/{ru,en}.json` + `index.ts` | ключи `hr-learning:*` — заводятся сразу, а не потом |
| `src/backend/setup.ts`, `index.ts` | `migrations.register`, регистрация документов |
| `migrations/0000_init.sql` + `meta/_journal.json` | руками: drizzle-kit не подключён |
| `src/frontend/{setup.tsx,index.ts,tailwind.css}` | пустой каркас модуля, наполняется в `06` |
| `apps/api/src/index.ts`, `apps/web/src/main.tsx`, `apps/web/src/index.css` | подключение модуля |

## Порядок реализации

- [ ] Каркас пакета: `package.json`, `tsconfig.json`, `contracts/`, пустой frontend
- [ ] `schemas/` — пять таблиц, типы, barrel
- [ ] `migrations/0000_init.sql` + запись в `_journal.json`
- [ ] `documents/course.ts` — регистрация, поля, список
- [ ] `documents/attempt.ts` — read-only по образцу `poll-response`, `remove`, `load` с резолвом имён
- [ ] `locales/` — `ru`/`en`
- [ ] `setup.ts` + подключение в `apps/api` и `apps/web`
- [ ] `pnpm typecheck && pnpm build`

## Проверка

1. `docker compose down -v` и подъём с нуля — bootstrap должен применить `0000_init` без ошибок.
2. В админке создать курс — убедиться, что карточка сохраняется и курс появляется в списке.
3. Занятый `code` → `409` с человеческим текстом, а не 500 (проверка маппинга ошибок БД на новом типе).
4. Удалить курс → soft-delete, строка пропадает из списка, `document_index.deleted_at` заполнен.
5. Попытку создать из админки нельзя (`creatable: false`); строку в `attempts`, вставленную вручную
   с `allocateDocumentId`, карточка открывает и не даёт сохранить.

## Открытые вопросы этого подплана

1. **Категории/теги курсов** для каталога — не заводил, чтобы не плодить сущности до первого спроса.
   Добавление колонки позже тривиально.
2. **UUID вместо имён в списке попыток** — см. «Известное ограничение». Решать здесь или отдельно
   реализацией `reference`.
3. **`due_at` на назначении** заведён, но кто и как его выставляет (и что происходит при просрочке) —
   это `07`.
