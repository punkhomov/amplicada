---
title: learning-parser — LOM и глубина cmi5 / xAPI / AICC
type: plan
tier: 4
status: implemented
date: 2026-08-09
parent: ./00-overview.md
---

# 06 — LOM и глубина остальных форматов

> Сделано 2026-08-09. Что вышло иначе — в
> `metadata-depth`: `moveOn`, `launchMethod` и
> `entitlementKey` уехали на пункт дерева, а не в `Cmi5Details` (в спецификации они объявлены на
> `<au>`); `XapiDetails` не появился вовсе — пакетной специфики у xAPI нет; `.cmp` вычеркнут, а не
> отложен. Разбор LOM ищет элементы без учёта регистра: профиль IMS 1.2 пишет `typicallearningtime`
> там, где LOM 1.0 пишет `typicalLearningTime`.

Последняя фаза, и она же самая разнородная: добрать то, что каждый формат объявляет сверх «как
называется и откуда запускать».

## LOM

`<metadata><lom>` есть и у SCORM 1.2, и у 2004. Сейчас из него берётся одно поле — название, и то
как запасной вариант к названию организации.

В образце модель LOM занимает 11 508 строк на девяти верхнеуровневых категориях: `general`,
`lifeCycle`, `metaMetadata`, `technical`, `educational`, `rights`, `relation`, `annotation`,
`classification`. Столько строк там не от богатства содержания, а от того, что Java требует класс на
элемент; структурные типы TypeScript опишут то же самое в разы короче.

Что из этого имеет применение, а не просто есть в спецификации:

| Категория | Поля | Кому нужно |
|---|---|---|
| `general` | title, description, keyword, language, identifier, coverage | Каталог курсов: описание и поиск по ключевым словам |
| `lifeCycle` | version, status, contribute (автор, дата) | «Кто автор, когда сделан» на карточке |
| `technical` | format, size, location, requirement, installationRemarks, duration | `duration` — ожидаемая длительность, это в каталоге видно сразу |
| `educational` | interactivityType, learningResourceType, difficulty, typicalLearningTime, intendedEndUserRole, context | `typicalLearningTime` — «курс на 40 минут», самое частое ожидание учащегося |
| `rights` | cost, copyrightAndOtherRestrictions, description | Юридическое, но дешёвое |
| `metaMetadata`, `relation`, `annotation`, `classification` | — | Разбираем ради полноты; применения у нас нет |

Всё многоязычное (`<langstring>`), и здесь наконец стоит **хранить все языки**, а не первый:
`labelOf` берёт первый, потому что до сих пор язык учащегося был неизвестен и хранить было негде.
В LOM это не так — там перевод названия и есть содержание поля.

Тип: `LangString = Record<string, string>` (язык → текст), плюс хелпер «взять по языку с
фолбэком». Форма `Record` удобнее массива пар: обращение по языку — главный сценарий.

### Внешние метаданные — и почему это ломает сигнатуру

LOM бывает не внутри манифеста, а в отдельном файле:
`<metadata><adlcp:location>metadata.xml</adlcp:location></metadata>`. У образца под это заведён
интерфейс `LoadableMetadata`.

Прочитать такой файл `parseManifest(xml, path, issues)` не может: у него на входе строка, а не
пакет. Значит:

- либо `parseManifest` становится **асинхронным** и принимает `PackageSource` — то есть меняется
  публичная сигнатура всех разборщиков;
- либо внешние метаданные грузит `detect.ts` вторым проходом: разобрал манифест, увидел
  `externalMetadata: string[]`, прочитал, дополнил.

**Второе.** Разборщик формата остаётся чистой функцией от текста — это то, на чём держатся все
тесты пакета (без БД, без S3, без асинхронности). Менять это ради необязательного поля
несоразмерно.

Ссылка на внешний файл бывает и на `<resource>`, и на `<item>` — грузить надо все, отсюда список.

## cmi5

Разбирается запуск; остальное, чем cmi5 отличается от «xAPI с оглавлением», — нет:

| Что | Зачем |
|---|---|
| `moveOn` | `Passed` / `Completed` / `CompletedAndPassed` / `CompletedOrPassed` / `NotApplicable` — **условие зачёта единицы**. Без него непонятно, что считать прохождением |
| `launchMethod` | `OwnWindow` / `AnyWindow` — открывать в окне или в рамке |
| `launchParameters` | уже читается как `launchData` |
| `entitlementKey` | ключ доступа, который LMS передаёт при запуске |
| `objectives` + `<objectives>` на курсе | цели, на которые ссылаются AU |
| `activityType` | IRI типа активности |

`moveOn` — самое важное здесь: это прямой аналог `masteryScore` по смыслу «когда засчитано», и без
него порог сам по себе ничего не решает.

## xAPI

Формат бедный по устройству, добирать почти нечего:

- `type` активности (IRI) — по нему LRS понимает, что за объект;
- `extensions` — произвольные пары, автор кладёт туда что хочет;
- несколько активностей: сейчас в оглавление попадают все, но описание берётся только у первой.

## AICC

Осталось три файла и хвост колонок:

| Файл | Что внутри |
|---|---|
| `.cmp` | требования завершения: какие цели закрывают курс |
| `.ort` | связи целей с единицами (objectives relationships) |
| `.pre` | пререквизиты — **читается в фазе `05`**, здесь не дублируется |

> `.cmp` по итогу не читается. Раскладка его колонок не закреплена ничем проверяемым — образец его
> тоже не разбирает, — а придумать её значило бы положить в модель правила зачёта курса, которых
> автор не писал. Это худший сорт ошибки: она выглядит как данные.

Плюс секции `.crs`, которые сейчас пропускаются: `[Course_Behavior]` (`Max_Normal` — число попыток),
`[Course]` целиком (`Level`, `Total_AUs`, `Total_Blocks`, `Course_System`).

## Что появляется в модели

`details` из фазы `04` дополняется тремя вариантами:

```ts
interface Cmi5Details { moveOn: MoveOn | null; launchMethod: string | null; entitlementKey: string | null; objectives: Objective[] }
interface XapiDetails { activityType: string | null; extensions: Record<string, string> }
interface AiccDetails { maxAttempts: number | null; level: string | null; objectives: AiccObjective[] }
```

> По факту `Cmi5Details` свёлся к одному полю `objectives`: `moveOn`, `launchMethod`,
> `entitlementKey` и `activityType` объявлены в спецификации на `<au>`, а не на курсе, и потому
> лежат на пункте дерева. `XapiDetails` не появился — всё, что есть в `tincan.xml`, объявлено на
> активности, и на уровне пакета там нет ничего. `AiccDetails` прибавил `courseSystem`,
> `declaredUnits` и `declaredBlocks`.

Плюс общее `lom: Lom | null` — не в `details`, потому что LOM бывает у обоих SCORM и по смыслу это
метаданные пакета, а не особенность формата.

## Правила валидации

| Код | Severity | Что ловит |
|---|---|---|
| `common.external-metadata-missing` | warning | `adlcp:location` указывает на файл, которого нет в архиве |
| `cmi5.moveon-unknown` | warning | Значение `moveOn` вне перечня спецификации |
| `aicc.objective-dangling` | warning | `.ort` ссылается на несуществующую единицу |
| `aicc.objectives-unreadable` | warning | Сверх плана: в `.ort` не распознаны колонки — как у `.pre` в фазе `05` |

## Чем проверяем

- LOM с тремя языками в `<title>` — хранятся все три, а не первый;
- LOM во внешнем файле подхватывается и даёт тот же результат, что встроенный;
- ссылка на отсутствующий внешний файл — находка, а не исключение;
- `typicalLearningTime` в ISO 8601 приводится к секундам тем же `parseDurationSeconds` (фаза `01`);
- `moveOn` каждого из пяти значений; неизвестное — находка;
- `.ort` и `.cmp` разбираются; пакет **без** них разбирается как раньше.

## Оценка

400–500 строк, из них больше половины — LOM. Дробится естественно: LOM, потом по формату.

## Чего не делаем

- **`metaMetadata`, `relation`, `annotation`, `classification` в глубину.** Разбираем структуру, но
  без вложенных словарей источников (`source`/`value` из LOMv1.0) — они там ради каталогизации в
  репозиториях учебных объектов, которой у нас нет.
- **Применение `moveOn`** — это рантайм cmi5, которого нет.
- **`.cmp`** — см. выше: раскладка не закреплена, а догадка выглядела бы как данные.
