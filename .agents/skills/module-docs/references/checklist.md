# Чек-листы

## Перед предложением изменений в пакет (anti-reproposal)

- [ ] Прочитан `ref/notes/<package>.md` целиком, включая стоп-лист.
- [ ] Прочитан `packages/<package>/docs/index.md` (границы, ограничения).
- [ ] Ни одно предложение не совпадает с `rejected` / `deferred` / `gap`. Если совпадает — приведены новые факты и запись `supersedes`, либо предложение снято.
- [ ] План `ref/plans/*`, на который опирается предложение, сверен с кодом (планы — история).

## Разведка перед написанием docs

- [ ] Прочитаны: `package.json`, `src/contracts/`, `src/backend/index.ts`, `src/backend/setup.ts`, `src/backend/schemas/`, `src/backend/documents/`, `src/backend/services/`, `src/backend/routes/`, `src/frontend/index.ts`, `src/frontend/setup.tsx`, `migrations/`, manifest.
- [ ] Найдены потребители: `rg "<package-name>" packages apps` — кто резолвит токены, импортирует типы, слушает extension points.
- [ ] Определена публичная поверхность: токены, роуты, документы, фронтенд-точки, env, задачи.
- [ ] Выбран набор страниц; карта покрытия заполнена, у пустых подсистем стоит явное «нет».

## Сверка фактов с кодом

- [ ] Каждый токен, роут, env, id документа, таблица, тип существует: проверено `rg`.
- [ ] Все ссылки `file:line` актуальны.
- [ ] Примеры кода соответствуют реальным сигнатурам (импорт, параметры, опциональность).
- [ ] Даты и статусы в front matter заполнены: `git rev-parse --short HEAD`.
- [ ] В docs нет внутреннего рационала, TODO и истории рефакторингов — они в notes.

## Вёрстка и VitePress

- [ ] Директорные индексы — `index.md` (не `README.md`).
- [ ] Все внутренние ссылки относительные и ведут на существующие `.md`; битых нет.
- [ ] Front matter есть в каждом файле: `title`, `type`, `updated`, `verified_commit`.
- [ ] Один H1 на файл, совпадает с `title`; заголовки не дублируются в пределах страницы.
- [ ] Нет HTML/JSX и платформенных вставок; вложенные примеры — в fenced-блоках.
- [ ] Имена файлов латиницей, kebab-case.

## После работы

- [ ] Обновлён `packages/<package>/docs/index.md`: карта docs, карта покрытия, freshness.
- [ ] Обновлён `packages/<package>/README.md` — таблица документации ведёт на `docs/index.md` и страницы.
- [ ] Обновлён `ref/notes/<package>.md`: запись со статусом и датой, стоп-лист.
- [ ] `ref/README.md` и `ref/context.md` — если появились/переименовались файлы или публичная поверхность.
- [ ] Для кросс-модульного решения создан/обновлён ADR, в notes — ссылка.

## Быстрые команды

```bash
git rev-parse --short HEAD                          # verified_commit
rg -n "<token|route|env>" packages/<package>/src    # сверка факта
rg -n '\]\(\.\.?/' packages/<package>/docs          # внутренние ссылки
rg -n "TODO|FIXME" packages/<package>/docs          # не должно остаться
```
