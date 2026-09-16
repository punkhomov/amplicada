# ref/ — Документация проекта amplicada

## Иерархия приоритетов (tier)

При разрешении противоречий между документами применяется **tier** (1 = высший приоритет).
Если документ противоречит коду — код побеждает всегда.

| Tier | Категория | Правило |
|------|-----------|---------|
| 1 | `adr/` | Architecture Decision Records — фундаментальные решения. Менять только новым ADR. |
| 2 | `notes/` | Заметки разработчиков по пакетам: почему сделано так, что отвергли и отложили. Отражают принятое состояние. |
| 3 | `plans/` | Целевое состояние. План — это направление. Не должен подстраиваться под текущее состояние. |
| 4 | `guides/` | Паттерны и конвенции. Рекомендации, не обязательные к исполнению. |

## Карта файлов

### ADR (tier 1)

| Файл | Статус | Описание |
|------|--------|----------|
| `adr/00-evolution.md` | `implemented` | Эволюция решений: что сохранили, изменили, отбросили |
| `adr/01-architecture.md` | `implemented` | Архитектура: философия, модули, core decisions |
| `adr/02-dependency-injection.md` | `Accepted` | Без DI-контейнера: service locator для обязательных зависимостей, extension points для опциональных связей между модулями |
| `adr/03-frontend-fsd.md` | `accepted` | Feature-Sliced Design v2.1 для frontend модулей |
| `adr/04-notifications.md` | `implemented` | Уведомления: маршрутизация и надёжность (outbox, ретраи) — core-сервис `notification`; транспорт и адресные книги — канальные модули |
| `adr/05-application-composition.md` | `implemented` | Единый состав приложения, генерация статических подключений и проверяемые зависимости обеих сторон; заменяет декларативный-only порядок из ADR-02 |
| `adr/06-module-conventions.md` | `implemented` | amplicada: true, экспорт module, стороны/CSS из exports, порядок обязательных и выбранных optional peers; дополняет ADR-02/05 |

| `context.md` | `implemented` | Актуальный контекст проекта |

### Notes (tier 2)

| Файл | Статус | Описание |
|------|--------|----------|
| `notes/README.md` | `implemented` | Формат и правила заметок: статусы, шаблон записи, стоп-лист |
| `notes/application-tools.md` | `implemented` | D-004: подробно «было → стало», причины, компромиссы и отвергнутые варианты; discovery и optional peers |
| `notes/module-admin.md`, `notes/module-auth-password.md`, `notes/module-hr-poll.md` | `implemented` | Optional-интеграция и сервис admin:toolbar |
| `notes/module-notification-email.md` | `implemented` | D-001…D-004: nodemailer `^8` под политикой возраста, backend-only модуль, подтверждение адреса, режим без SMTP |
| `notes/<package>.md` | — | Заметки по пакету; создаются по мере применения скилла `.agents/skills/module-docs/` |

Перед изменением пакета: `notes/<package>.md` (решения, отвергнутое, пробелы) +
`packages/<package>/docs/index.md` (границы и ограничения для потребителя).

### Модульная документация (рядом с кодом)

Потребительская документация — не здесь, а рядом с кодом: `packages/<pkg>/docs/`
(Diátaxis, многостранично; индекс — `docs/index.md`, структура и VitePress-требования — скилл
`.agents/skills/module-docs/`). Рационал для разработчиков — в `notes/`.

| Пакет | Docs (потребителям) |
|-------|---------------------|
| `application-tools` | [`packages/application-tools/docs/`](../packages/application-tools/docs/index.md) — справочник, модель композиции и инструкция optional-интеграции |
| `module-admin` | [`packages/module-admin/docs/`](../packages/module-admin/docs/index.md) — сервис действий |
| `module-auth-password` | [`packages/module-auth-password/docs/`](../packages/module-auth-password/docs/index.md) — optional-интеграция admin |
| `module-hr` | [`packages/module-hr/docs/`](../packages/module-hr/docs/) — пока 4 плоских файла, не разнесены |
| `module-notification-email` | [`packages/module-notification-email/docs/`](../packages/module-notification-email/docs/index.md) — справочник канала и 2 how-to |
| `module-workflow` | [`packages/module-workflow/docs/`](../packages/module-workflow/docs/) — пока 4 плоских файла |

### Guides (tier 4)

| Файл | Статус | Описание |
|------|--------|----------|
| `guides/module-system.md` | `implemented` | Модульная система: структура, паттерны, регистрация |
| `guides/application-composition.md` | `implemented` | Автоподключение из dependencies, метаданные package.json, генерация и необязательный --config |
| `guides/module-structure.md` | `implemented` | Конкретная структура модуля: файлы, package.json, конвенции |
| `guides/formats.md` | `implemented` | Скелеты всех типов документов — справочник для агента |
| `guides/docker-dev.md` | `superseded` | Старый Docker dev setup; актуальный запуск описан в корневом README |
| `guides/plan-lifecycle.md` | `draft` | Пайплайн: план → ADR и guides |

### Plans (tier 3)

| Файл | Статус | Описание |
|------|--------|----------|
| `plans/2026-09-14-module-lifecycle-review.md` | `draft` | Первый архитектурный разбор: зависимости и порядок загрузки, дефект shutdown, владение ресурсами и удаление модулей; предложения и следующие итерации, без изменения runtime |
| `plans/2026-09-15-auth-node-method.md` | `implemented` | Метод аутентификации — свойство узла: `auth-node` + `GET /api/auth/context`, платформа редиректит на `loginUrl` метода и не содержит страницы логина; парольный логин — `/auth/password/login`, `/me` и `/logout` переехали в core |
| `plans/2026-09-15-notifications/` | `implemented` | Уведомления: core-сервис `notification` + outbox с ретраями, канальный модуль `module-notification-email` (SMTP + адресная книга), админ-лог доставок `/admin/notifications`, Mailpit в dev, ADR-04. Подпланы `01`–`04` сделаны; разблокирует регистрацию/сброс пароля/2FA в auth |
| `plans/2026-07-13-poc-cookie-auth.md` | `implemented` | PoC cookie auth (выполнен) |
| `plans/2026-07-13-frontend-core-reorg.md` | `implemented` | Реорганизация core/sdk (выполнен) |
| `plans/2026-07-13-server-sessions.md` | `implemented` | Безопасные серверные сессии (Redis + @fastify/session + bcrypt) |
| `plans/2026-07-13-enterprise-integration.md` | `draft` | Интеграция с корпоративной инфраструктурой |
| `plans/2026-07-13-layout-aware-routes.md` | `implemented` | Layout-aware routes для ModuleRoutes |
| `plans/2026-07-13-document-system.md` | `in-progress` | Document system: типы, страницы, группы, расширения |
| `plans/2026-07-14-task-scheduler/` | `in-progress` | Task Scheduler — повторяемые задачи в core (overview + 6 фазовых подпланов). Подпланы `01`–`05` реализованы, `06` (тесты и валидация) не начат |
| `plans/2026-07-15-platform-logger.md` | `implemented` | Единая система логирования: ALS-перехват для фоновых задач, ленивый singleton поверх pino. Открыт только опциональный `configureLogger(...)` под кастомный transport |
| `plans/2026-07-14-workflow/` | `in-progress` | `module-workflow` — движок бизнес-процессов (BPM-Light), domain-agnostic, `module-hr` как первый потребитель (overview `2026-07-16-workflow.md` + 7 фазовых подпланов + исходное ТЗ `out-00-overview.md`). Фазы `01`–`06` реализованы, у `07` написан код, но сквозной сценарий 1–8 руками не прогнан |
| `plans/2026-07-18-hr-requests.md` | `implemented` | `module-hr-request` — портальные заявки поверх module-workflow: черновики, свой API, UX статусов через label'ы нод |
| `plans/2026-07-19-workflow-fields-actor-automation.md` | `implemented` | workflow: политика редактируемых полей per-шаг + дифф в аудит (фазы A+B), модель актора — реализовано; дизайн async-автоматики (ИИ-шаг, фаза C), принципы i18n и обобщения под оценку (D/E) — только направление, без кода |
| `plans/2026-07-20-workflow-node-code-delegate-tx.md` | `implemented` | workflow: стабильный `node.code` (+ денормализованный `process_instances.current_state_code`) для отчётности извне движка; транзакционный `db` в `DelegateContext` для синхронных делегатов |
| `plans/2026-07-20-workflow-node-hooks.md` | `implemented` | workflow: хуки ноды (post-enter side effects) — четвёртый вид делегата (`hook`) в отдельном реестре, `workflow_automation_jobs.kind` дискриминирует route/hook-джобы, JSON-параметры + своя политика ретраев на хук, индикатор на канвасе |
| `plans/2026-07-21-workflow-async-task.md` | `implemented` | workflow: узел `asyncTask` (реализация фазы C) — джоб-таблица с `SKIP LOCKED`, eager-диспатч + task-scheduler-воркер как фолбэк, `completeAutomationJob`, отказ от объединения с `serviceTask`, видимость сбоя на таймлайне. Чек-лист в самом плане не проставлен, но код есть в 14 файлах модуля; сценарии проверки 1–6 не прогнаны |
| `plans/2026-07-22-document-save-pick.md` | `implemented` | `DocumentExtension.schema`/`idColumn`/`mode` — авто load/save по Drizzle-таблице, ручной `load`/`save` только для нестандартной логики (JOIN, спецкейсы) |
| `plans/2026-07-22-workflow-gateway-determinism-and-parallelism.md` | `implemented` | workflow: (1) порядок вычисления условий Gateway — реализован минимальный фикс, номер приоритета виден на канвасе (`withGatewayEdgeOrder`), реордер/детекция пересечений сознательно не сделаны; (2) параллельные ветки — решение принято, дизайн вынесен в `2026-07-22-workflow-parallel-gateway.md` |
| `plans/2026-07-22-workflow-parallel-gateway.md` | `implemented` | workflow: parallel/inclusive gateway — модель токенов (`process_instance_tokens`/`process_instance_forks`), fork/join с защитой от гонки (`FOR UPDATE`), структурная валидация парности split/join, `executeAction(taskId, ...)`, мигр. 0005 + бэкфилл, mode-переключатель в редакторе. typecheck/build чисты по всей монорепе — **вживую не прогнано** (нет доступной БД в среде реализации) |
| `plans/2026-07-23-document-data-architecture.md` | `draft` | Document data architecture: index (lookup), soft-delete, typed keys для extension'ов, hooks/events, свобода вне документов |
| `plans/2026-08-05-list-filters-and-or.md` | `implemented` | Фильтры списков: AND/OR + группировка (рекурсивный контракт, UI на один уровень), `in`/`notIn`, невалидный фильтр → 400 вместо тихого дропа, удаление `listFetch` с миграцией 5 HR-типов на generic-путь. Живой прогон на БД — за пользователем |
| `plans/2026-08-05-testing-strategy.md` | `draft` | Стратегия тестирования: 4 тира от unit до Playwright. Ключевой рычаг — drizzle рендерит SQL офлайн (`.toSQL()` без соединения); `bootstrap()` уже применяет миграции, а `createApp()` отделён от `listen()`, поэтому `app.inject()` подключается почти без плумбинга |
| `plans/2026-07-27-document-extension-multikey.md` | `done` | `DocumentExtension.key` с дефолтом `base`: несколько `extend()` одного модуля на одном документе, `data[module][key][field]` и `module:key:field` в списках |
| `plans/2026-08-08-module-learning/` | `in-progress` | `module-hr-learning` — курсы и SCORM-плеер: `00-overview` + подпланы `02`–`07` + `99-ai-chat-qwen` (исходный обзор индустрии). Раздача контента только через бекенд-прокси, presigned отключён; изоляция чужого JS — `CSP: sandbox` заголовком, токен в префиксе пути. **`01` (блокеры в core) закрыт 2026-08-08**: `getObjectStream` с `Range` → `206` и пагинация `listObjects`; третий «блокер» (multipart-лимит) оказался не блокером. **`02` (приём пакета) написан 2026-08-09**: формат вынесен в библиотеку `packages/learning-parser` (yauzl + fast-xml-parser, 88 тестов) — опознаются все пять ходовых форматов (SCORM 1.2/2004, cmi5, xAPI, AICC), проигрываем пока только SCORM 1.2, остальное отклоняется на приёме; в модуле — конвейер, роуты и задача; в core добавились `putObjectStream` и `deletePrefix`. Живьём не прогонялось. Подплан `07` не делается без модели прав |
| `plans/2026-08-09-learning-parser/` | `implemented` | `@amplicada/learning-parser` — доведение разбора пакетов до полноты по образцу [`jcputney/elearning-module-parser`](https://github.com/jcputney/elearning-module-parser). **Рамка (2026-08-09): библиотека для внешних потребителей, формат разбирается целиком независимо от того, что платформа умеет проигрывать** — SCORM 2004 с sequencing разбираем, хотя не играем. Границу это не убирает: библиотека сообщает, что нашла, а решает, что принимать и проигрывать, модуль обучения. Рантайма у библиотеки нет и не будет. `00-overview` (шесть фаз, порядок обоснован; что из образца не берём — **машинерию, а не покрытие формата**) + подпланы `01`–`06` целиком: `03` кодировка (windows-1251; `TextDecoder` в Node умеет её сам, `iconv-lite` не нужен — проверено), `04` SCORM 2004 в глубину (самая большая: sequencing, редакции, `adlnav`; здесь же `PackageMetadata` перестаёт быть плоским), `05` пререквизиты (свой язык выражений, разбор в дерево + вычислитель, применение — не наше), `06` LOM и глубина остальных форматов. **`01` (дерево оглавления) и `02` (валидация как отчёт) сделаны 2026-08-09**: `launchableCount` заменён на `activities: Activity[]`, поля `<item>` (`datafromlms`, `maxtimeallowed`, `timelimitaction`, `masteryscore` на пункт) доезжают до модели, `.cst` AICC разбирается. Попутно вскрылись два дефекта: `../` из манифеста отвергался как zip-slip (развели `normalizePackagePath` и `resolveRelativePath`) и мёртвая ветка `adlcp_v1p2` в определении версии. `02`: `parsePackage` возвращает `ParsedPackage { metadata, report }`, разбор перестал бросать на первом изъяне; попутно выяснилось, что сломанный XML у нас не ловился вообще. **`03` (кодировка) сделана 2026-08-09**: BOM всех видов (UTF-32 декодируется руками — `TextDecoder` его не знает), `encoding=` из декларации, строгая проверка UTF-8, догадка windows-1251 с находкой `common.encoding-guessed`; `PackageSource` отдаёт байты вместо текста, чтобы кодировку определяла библиотека, а не потребитель. Имена записей ZIP в CP866 остались нечинеными — развилка (`decodeStrings: false` выключает защиту yauzl от `../`) не выбрана. **`04` (SCORM 2004 в глубину) сделана 2026-08-09**: sequencing целиком (controlMode, правила перехода, rollup, цели с `mapInfo`, лимиты, рандомизация, оба блока 4-й редакции), редакция из `schemaversion`, `adlcp:completionThreshold`/`adlnav:hideLMSUI`/`adlcp:data` на пункте, ссылки `IDRef` на `sequencingCollection` разрешаются при разборе. `PackageMetadata` стал размеченным по `format` объединением с `details` (у не-SCORM-2004 пока `null`), `Activity` прибавил четыре поля. Пять правил валидации, из них `sequencing-value-unknown` сверх плана. **`05` (пререквизиты) сделана 2026-08-09**: язык выражений SCORM 1.2 и AICC разбирается в дерево (`model/prerequisite.ts`) плюс вычислитель, который библиотека отдаёт, но не зовёт; условие достаётся из четырёх мест (`adlcp:prerequisites`, `.pre`, колонки в `.au` и `.cst`) с приоритетом у `.pre`. Непонятое условие оставляет пункт **открытым** и заводит находку — запертая без объяснения глава хуже; законная конструкция полного AICC-скрипта отделена от мусора отдельным кодом. Запись `.pre` рёбрами (`source`/`target`) намеренно не читается: направление из имён колонок не следует. **`06` (LOM и глубина остальных форматов) сделана 2026-08-09, план закрыт целиком**: девять категорий LOM с хранением всех языков (`langText` выбирает язык с фолбэками), обе разметки одним разборщиком через поиск элементов без учёта регистра, внешний `adlcp:location` дочитывается вторым проходом в `parsePackage` — разборщики формата остались чистыми функциями от текста; cmi5 получил `moveOn`/`launchMethod`/`entitlementKey`/цели, xAPI — тип активности и расширения, AICC — `.ort` и секции `.crs`. `moveOn` и прочее уехало на пункт дерева, а не в `details`: в спецификации они объявлены на `<au>`. `.cmp` AICC не читается намеренно — раскладка колонок ничем не закреплена |
| `plans/2026-08-10-learning-parser-parity/` | `in-progress` | `@amplicada/learning-parser` — паритет с образцом **по пригодности к употреблению**, а не по глубине разбора. Предыдущий план мерил не тем: формат разобран глубже образца (36 кодов находок против его 25 классов правил), а библиотекой пользоваться нельзя — `parsePackage` принимает `PackageSource`, реализаций которого библиотека не поставляет ни одной, и открытие zip живёт у потребителя (`sourceOf` в `module-hr-learning`). Зеркальная ошибка: `intake/` — политика приёма «нашего LMS» — лежит внутри библиотеки без платформы. `00-overview` (таблица расхождений по функциям) + **`01` (входные двери) сделан 2026-08-10**: `fileSource`/`zipSource`/`directorySource`, контракты `PackageSource`/`RandomAccessSource` не менялись, путь через S3 прежний, `sourceOf` уехал из модуля в библиотеку; отрезание корня пакета переехало из политики приёма в общий `packagePathsOf`; три механизма кэширования образца не переносим — они лечат решение, которого мы не принимали. Вскрылось при прогоне: **дескриптор нельзя держать общим** — поток закрывает fd при `destroy()` вопреки `autoClose: false` (одинаково у `FileHandle` и у числового fd), а yauzl рвёт потоки, отсюда fd на диапазон. **`02` часть A (корпус) сделана 2026-08-10**: 209 пакетов в `packages/learning-parser/fixtures/` (включая ADL CTS целиком — 189, а не подобранные 15), 2,2 МБ вместо 16 по правилу **описатели дословно, ассеты только путями**; происхождение по каждому источнику в `fixtures/PROVENANCE.md` (оказалось пестрее плана: большая часть — Rustici, а не ADL). Ноль исключений на 209 пакетах, **корпус CTS проходит без ошибок**. Нашлось четыре вещи, ни одна не исправлена: `scorm.objective-map-dangling` — наше ложное срабатывание (глобальные цели общие между курсами, а не внутри пакета), рёберная форма `.pre` теперь подтверждена данными (`type="requires"` плюс эвристика образца — первая колонка зависимый), `scorm.rollup-without-children` вероятно шум, остальное — подтверждения. Часть B (сверка покрытия по ~70 тестам образца) не начата, `03` валидация по XSD в статусе `needs-decision` (в Node нет валидатора без нативной зависимости или запуска Java), **`04` (опции разбора) сделан 2026-08-10**: `ParseOptions` с `strictness` (`default`/`strict`/`lenient`) и `disableRules`; правку 36 мест делать не пришлось — уровень правила уже был предложением, политика применяется один раз к собранному списку. Сверх плана — реестр `ISSUE_CODES` и тип `IssueCode` (опечатка в коде находки стала ошибкой компиляции), полнота реестра проверяется сканом исходников, `05` хвост функций плюс пригодность к публикации (нет `README`, нет `LICENSE`, нет `license`/`repository`/`files` в `package.json`) |
| `plans/2026-08-08-tech-debt-audit.md` | `draft` | Технический долг по итогам аудита со сверкой по коду. Шесть пунктов без своего плана: живой прогон накопленного за месяц (гейт), нереализованный `widget: 'reference'`, `exportData` без `id`, отсутствие `drizzle-kit` и дрейф схемы, CI, мелкие хвосты. Плюс перечень того, что уже живёт в других планах, — чтобы не дублировалось |
| `plans/2026-08-05-document-model/` | `in-progress` | Зонтичная папка по документной модели: `00-overview` (карта реализации от простого к зависимому) + 8 подпланов, нумерация = порядок работ. **`01`–`06` реализованы 2026-08-06**: ошибки БД → 409, скоуп stale, гварды `update()`, запись расширений; hr-карточка корректирует запись, а не двигает valid time (`05`, вариант A); `document_index` первичен и стал единственной таблицей типа документа (`06`, три этапа). Живьём не прогонялось. Остались `07` холостые прогоны расширений, `08` валидация/блокировка/программный API |

## Статусы документов

| Статус | Значение |
|--------|----------|
| `implemented` | Реализовано в коде |
| `in-progress` | В процессе реализации |
| `draft` | Черновик, не реализовано |
| `superseded` | Заменено более новым документом |

**`implemented` ≠ «проверено вживую».** Статус говорит только о том, что код написан и собирается.
Живой прогон против БД — отдельная ось, она нигде в статусе не отражена. Раньше планы держали в
`draft` именно из-за непрогнанной проверки — так делать не надо, статус от этого перестаёт отвечать на
свой вопрос.

## Правила работы с ref/

1. **ADR > всё** — если notes или plan противоречат ADR, их нужно пересмотреть или создать новый ADR
3. **Код > документы** — если реализация отошла от документа, документ нужно обновить (а не код)
4. **Не удаляй устаревшее** — помечай `status: superseded` и указывай `superseded_by`
5. **Пиши дату** — каждый документ должен иметь `date` в front matter
