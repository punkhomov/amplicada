# @amplicada/learning-parser

Разбор пакетов учебных курсов: SCORM 1.2, SCORM 2004, cmi5, xAPI (Tin Can), AICC.

Библиотека читает описатель пакета и отдаёт разобранные метаданные вместе с отчётом о том, что с
пакетом не так. **Рантайма у неё нет и не будет** — она ничего не проигрывает, не общается с LRS и
не хранит попытки. Формат разбирается целиком, независимо от того, что ваш LMS умеет запускать:
решать, принимать пакет или отказать, — дело потребителя.

Две зависимости: `fast-xml-parser` и `yauzl`.

## Установка

```sh
pnpm add @amplicada/learning-parser
```

## Быстрый старт

Три способа подать пакет.

```ts
import { ZipArchive, fileSource, zipSource, directorySource, parsePackage } from '@amplicada/learning-parser';

// Архив на диске
const source = await fileSource('course.zip');
const archive = await ZipArchive.open(source);
try {
  const { metadata, report } = await parsePackage(zipSource(archive));
  console.log(metadata.format, metadata.title, metadata.entryPoint);
  if (!report.ok) console.error(report.errors);
} finally {
  await archive.close(); // закрывает и источник
}

// Распакованный пакет
const { metadata } = await parsePackage(await directorySource('./course'));
```

Свой источник — если пакет лежит в S3 или где-то ещё:

```ts
const { metadata } = await parsePackage({
  paths: ['imsmanifest.xml', 'index.html'],  // нормализованные, с отрезанным корнем
  async readBytes(path) { /* … */ },
  totalBytes: 42_000,                        // необязательно
});
```

Байты, а не текст: кодировку описателя (BOM, XML-декларация, windows-1251) определяет библиотека.

## Что получается

`PackageMetadata` — размеченное по `format` объединение, поэтому `metadata.format === 'scorm2004'`
сужает `metadata.details` до `Scorm2004Details` без приведения типов.

| Поле | Что внутри |
|---|---|
| `format`, `schemaVersion`, `descriptorPath` | что это за пакет и по какому файлу опознан |
| `title`, `description`, `identifier` | из описателя, с фолбэком на LOM |
| `entryPoint` / `entryUrl`, `entryParameters` | откуда запускать: путь внутри пакета либо внешний адрес |
| `activities` | дерево оглавления: вложенность, запуск, порог, видимость, sequencing, условия открытия |
| `masteryScore` | проходной балл долей 0..1 |
| `lom`, `externalMetadata` | метаданные учебного объекта, включая вынесенные в отдельный файл |
| `typicalLearningTimeSeconds` | ожидаемое время прохождения — «курс на 40 минут» |
| `subManifests` | вложенные пакеты: `<manifest>` внутри `<manifest>`, только SCORM |
| `declaredFiles` | что описатель объявляет своим |
| `fileCount`, `totalBytes` | объём пакета — по источнику, а не по описателю |
| `alsoDetected` | другие форматы, чьи описатели лежат рядом (Articulate публикует сразу в двух) |
| `details` | специфика формата: sequencing SCORM 2004, цели cmi5, секции `.crs` AICC |

У пункта оглавления `title` — подпись для показа, а `titles` и `descriptions` хранят **все**
объявленные языки (`{ ru: '…', en: '…' }`; ключ `""` — язык не объявлен). Выбрать нужный —
`langText(titles, 'ru')`.

Модель — простые данные: ни классов, ни `Map`, ни `Date`. `JSON.stringify` над ней тотален, и это
закреплено тестом.

## Отчёт и политика отказа

Разбор не бросает на первом изъяне: находки собираются в отчёт, а решение принимает потребитель.

```ts
const { report } = await parsePackage(source, {
  strictness: 'strict',                       // 'default' | 'strict' | 'lenient'
  disableRules: ['common.file-missing'],      // не заводить эти находки вовсе
});
```

- `default` — уровни такие, какие предложило правило: ошибка только если пакет нечем запустить;
- `strict` — любая находка становится ошибкой;
- `lenient` — ошибок не бывает вовсе, разбор ради инвентаризации.

Исключение бросается только когда непонятно, **что это за пакет**: описателя нет вовсе.

Опечатка в `disableRules` — тоже исключение: молча проигнорированный код выглядел бы как «правило не
сработало». Полный перечень — в `ISSUE_CODES`.

## Коды находок

Контракт — коды, а не тексты. Уровень в таблице тот, что предлагает правило; `strictness` его
меняет.

| Код | Уровень | Что означает |
|---|---|---|
| `common.no-launchable` | error | В пакете нет ни одного запускаемого блока |
| `common.entry-missing` | error | Точка входа объявлена, но такого файла в пакете нет |
| `common.file-missing` | error | Файл, объявленный описателем, отсутствует |
| `aicc.au-missing` | error | Нет `.au` — запускать нечего |
| `cmi5.au-missing` | error | В `cmi5.xml` нет ни одной единицы |
| `xapi.activities-missing` | error | В `tincan.xml` нет активностей |
| `common.xml-malformed` | warning | Разметка описателя нарушена |
| `common.encoding-guessed` | warning | Кодировка не объявлена и выведена догадкой |
| `common.title-missing` | warning | У пакета нет названия |
| `common.duplicate-identifier` | warning | Идентификатор встречается дважды |
| `common.external-launch` | warning | Курс запускается с внешнего адреса |
| `common.launch-unresolvable` | warning | Ссылка запуска не разрешается в путь внутри пакета |
| `common.external-metadata-missing` | warning | Метаданные объявлены в файле, которого нет |
| `common.prerequisite-unparsable` | warning | Условие открытия не разобрано |
| `common.prerequisite-unsupported` | warning | Условие на полном AICC-скрипте (`*`, `{n}`, сравнения) |
| `common.prerequisite-unknown-item` | warning | Условие ссылается на несуществующий пункт |
| `common.prerequisite-cycle` | warning | Условия открытия замкнулись в кольцо |
| `scorm.manifest-identifier-missing` | warning | У манифеста нет `identifier` |
| `scorm.organizations-missing` | warning | Нет ни одной организации |
| `scorm.default-organization-invalid` | warning | `default` указывает на несуществующую организацию |
| `scorm.resource-href-missing` | warning | У ресурса нет `href` |
| `scorm.resource-ref-dangling` | warning | Пункт ссылается на несуществующий ресурс |
| `scorm.orphaned-resource` | warning | Ресурс объявлен, но на него никто не ссылается |
| `scorm.prerequisites-type-unknown` | warning | `type` условия не `aicc_script` |
| `scorm.sequencing-ref-dangling` | warning | Ссылка на несуществующий общий блок sequencing |
| `scorm.sequencing-value-unknown` | warning | Значение sequencing вне перечня спецификации |
| `scorm.choice-exit-without-choice` | warning | `choiceExit` без разрешённого `choice` |
| `cmi5.course-missing` | warning | Нет блока `<course>` |
| `cmi5.launch-url-missing` | warning | У единицы нет `<url>` |
| `cmi5.moveon-unknown` | warning | `moveOn` вне перечня спецификации |
| `aicc.launch-url-missing` | warning | У единицы нет `file_name` |
| `aicc.prerequisites-unreadable` | warning | В `.pre` не распознаны колонки |
| `aicc.prerequisite-relation-unknown` | warning | Связь в `.pre` не `requires` |
| `aicc.objectives-unreadable` | warning | В `.ort` не распознаны колонки |
| `aicc.objective-dangling` | warning | Цель ссылается на несуществующую единицу |

Тексты сообщений русские. Если вы строите на них интерфейс — стройте на кодах, тексты справочные.

## Границы

Чего библиотека не делает **по решению**, а не по недоделке:

- **не проигрывает курсы.** Ни `window.API` для SCORM, ни LRS для cmi5/xAPI, ни HACP для AICC.
  `evaluatePrerequisites` она отдаёт, но сама не зовёт;
- **не решает, принимать ли пакет.** Отчёт — её граница;
- **не проверяет манифест по XSD.** В экосистеме Node нет валидатора схем без нативной сборки,
  запуска Java или внешнего бинаря; вместо этого 35 смысловых правил;
- **не читает `.cmp` AICC** — раскладка его колонок не закреплена ничем проверяемым, а догадка
  выглядела бы как данные;
- **не поддерживает имена записей ZIP в CP866.** Отключение декодирования в yauzl заодно снимает
  его защиту от `../`.

## `intake/` — не часть формата

Модуль `intake/` (лимиты архива, whitelist расширений, план распаковки) — **заготовка политики
приёма**, а не требование спецификаций. Значения `DEFAULT_ARCHIVE_LIMITS` взяты из практики одного
LMS; у вашего они будут другими. Разбору `intake/` не нужен вовсе.

## Тесты

`pnpm test`. Все офлайновые. Часть из них — прогон по корпусу настоящих пакетов из `fixtures/`
(209 штук, включая ADL SCORM 2004 CTS целиком); происхождение и условия — `fixtures/PROVENANCE.md`.

## Лицензия

Код библиотеки распространяется по лицензии MIT; см. [`LICENSE`](LICENSE).
Корпус сторонних тестовых пакетов в `fixtures/` имеет отдельное происхождение и не становится MIT-контентом из-за лицензии кода. Источники и известные условия перечислены в [`fixtures/PROVENANCE.md`](fixtures/PROVENANCE.md), сводка attribution — в [`fixtures/NOTICE.md`](fixtures/NOTICE.md).
