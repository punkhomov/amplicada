# Шаблоны страниц `packages/<package>/docs/`

Копируй скелет и заполняй. Плейсхолдеры не оставляй. Front matter обязателен: VitePress берёт из него `title` для заголовка и сайдбара.

## Front matter

Пакетный индекс `docs/index.md`:

```yaml
---
title: "<package> — обзор"
type: index
package: <package>
updated: YYYY-MM-DD
verified_commit: <short-sha>
---
```

Контентная страница:

```yaml
---
title: "Схема БД и миграции"
type: reference
updated: YYYY-MM-DD
verified_commit: <short-sha>
order: 20
---
```

- `updated` — дата, когда содержимое сверялось с кодом.
- `verified_commit` — `git rev-parse --short HEAD` на момент сверки. Если дерево грязное, отметь это в блоке Freshness.
- `order` — опциональная подсказка для будущего VitePress-сайдбара (шаг 10).

## `docs/index.md` — карточка пакета

~~~~markdown
# <package>

> Потребительская документация. Рационал решений, отвергнутые альтернативы и известные
> пробелы — в `ref/notes/<package>.md`.

<1–2 абзаца: назначение пакета и что входит. Отдельно — что осознанно не входит.>

## Публичная поверхность

| Что | Как | Где в коде |
|---|---|---|
| Сервис | `TOKEN_NAME` → `context.services.resolve(...)` | `src/contracts/...` |
| HTTP | `/api/...` | `src/backend/routes/...` |
| Документы | `doc-id` в разделе `<section>` | `src/backend/documents/...` |
| Frontend | роуты / слоты / extension points | `src/frontend/...` |

## Зависимости и порядок загрузки

- Требует: ... Должен грузиться после/до ... (`moduleManifest.dependencies`).

## Карта документации

| Раздел | Файл |
|---|---|
| Первый контакт | [tutorial.md](./tutorial.md) |
| Задачи | [how-to/](./how-to/index.md) — нет |
| Справочник | [reference/](./reference/index.md) |
| Концепции | [explanation/](./explanation/index.md) — нет |

Ссылайся только на существующие файлы; отсутствующий раздел помечай «— нет» (иначе VitePress
упадёт на битой внутренней ссылке).

## Карта покрытия

| Подсистема | Где описана |
|---|---|
| Точки расширения (токены, сервисы) | [reference/services.md](./reference/services.md) |
| HTTP API | [reference/api.md](./reference/api.md) — нет |
| Схема БД и миграции | [reference/schema.md](./reference/schema.md) |
| Документы, списки, дашборд | [reference/documents.md](./reference/documents.md) — нет |
| Задачи и фоновые процессы | — нет |
| Frontend (FSD, роуты, слоты) | [reference/frontend.md](./reference/frontend.md) |
| Конфиг: env, зависимости, порядок | [reference/config.md](./reference/config.md) |
| Интеграции и потребители | <раздел ниже> |
| Ограничения для потребителя | [explanation/limitations.md](./explanation/limitations.md) |

## Freshness

- Сверено с кодом: `YYYY-MM-DD`, коммит `<sha>`.
- Не проверено вживую: <список или «нет»>.
~~~~

Ссылку на `ref/notes/` в docs не делай — упоминай путь в backticks: docs должны собираться
VitePress'ом отдельно от `ref/`.

## `reference/<subsystem>.md` — справочник

~~~~markdown
# <Подсистема>

Один абзац: что охватывает страница и где лежит код (`src/backend/...`).

## <Сущности / таблицы / эндпоинты>

| Имя | Назначение | Ключевые поля / параметры |
|---|---|---|
| `...` | ... | ... |

## Поведение и инварианты

- ... (`src/...:NN`).

## Ошибки

| Класс / код | HTTP | Когда |
|---|---|---|
| `...` | `409` | ... |

## Ограничения

- ... → рационал: `ref/notes/<package>.md`.
~~~~

## `explanation/<concept>.md` — концепция

~~~~markdown
# Почему <концепция> устроена так

Контекст: какую задачу решает и где проходит граница. Затем — устройство и следствия
для потребителя. Альтернативы и внутренние компромиссы — в `ref/notes/<package>.md`,
здесь — только то, что нужно, чтобы правильно пользоваться.

## <Основная мысль>

## Следствия для потребителя

- ...

## Что осознанно не поддерживается

- ...
~~~~

## `how-to/<task>.md` — задача

~~~~markdown
# Как <сделать X>

Для кого: <разработчик другого модуля / администратор>. Предполагается: <базовое знание>.

## Предусловия

- ...

## Шаги

```typescript
// минимальный рабочий пример
```

## Проверка

- <что должно получиться / чем проверить>

## Связанное

- [reference/...](./../reference/<file>.md)
~~~~

## `tutorial.md` — первый контакт

~~~~markdown
# <Глагол: постройте / соберите ...>

Что получится к концу и что понадобится. Дальше — шаги, каждый с наблюдаемым результатом.

## Предварительные условия

## Шаг 1 — <действие>

**Проверка**: <видимый результат>.

## Что дальше

- Задачи — [how-to/](./how-to/index.md).
- Факты — [reference/](./reference/index.md).
- Устройство — [explanation/](./explanation/index.md).
~~~~

## `*/index.md` — индекс раздела

~~~~markdown
# How-to

| Задача | Для кого |
|---|---|
| [Как ...](./task.md) | ... |
~~~~

Тип раздела подставляй в `title` и `type`: `how-to`, `reference`, `explanation`.

## Notes

Журнал решений ведётся только по формату `ref/notes/README.md` — не дублируй его шаблон здесь.
