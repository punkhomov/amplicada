import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { type ArchivePlan, planExtraction } from '../intake/inspect.js';
import { langText } from '../model/lom.js';
import type { ParseOptions } from '../options.js';
import { fixturePaths, fixtureSource } from '../testing/fixture-source.js';
import { parsePackage } from './detect.js';

/**
 * Прогон по корпусу настоящих пакетов — `fixtures/`, происхождение в `fixtures/PROVENANCE.md`.
 *
 * Все остальные тесты библиотеки работают на XML, написанном нами же: они подтверждают наши
 * представления о формате по построению и опровергнуть их не могут. Здесь наоборот — пакеты
 * выгружены настоящими инструментами, а корпус ADL CTS вообще является каноническим контрактом
 * SCORM 2004.
 */

// Тесты гоняются по `dist`, фикстуры лежат в корне пакета.
const ROOT = join(import.meta.dirname, '..', '..', 'fixtures');

/**
 * Ассеты в корпусе хранятся только путями, а пакеты CTS и в исходнике не самодостаточны — их SCO
 * собираются из общего депо при развёртывании. Поэтому находки о существовании файлов здесь ничего
 * не значат.
 *
 * Это первый настоящий потребитель `ParseOptions`: у образца проверка существования файлов ровно по
 * той же причине выключена по умолчанию.
 */
const CORPUS: ParseOptions = {
  disableRules: ['common.file-missing', 'common.entry-missing', 'scorm.orphaned-resource'],
};

async function packagesIn(section: string, prefix = ''): Promise<string[]> {
  const here = join(ROOT, section, prefix);
  const found: string[] = [];

  for (const entry of await readdir(here, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const inner = await readdir(join(ROOT, section, relative));
    if (inner.includes('files.txt')) found.push(relative);
    else found.push(...(await packagesIn(section, relative)));
  }

  return found.sort();
}

async function parseFixture(section: string, name: string) {
  return parsePackage(await fixtureSource(join(ROOT, section, name)), CORPUS);
}

test('корпус ADL CTS разбирается целиком и без ошибок', async () => {
  const packages = await packagesIn('conformance');
  assert.equal(packages.length, 189, 'корпус на месте');

  const broken: string[] = [];
  for (const name of packages) {
    const { metadata, report } = await parseFixture('conformance', name);
    if (metadata.format !== 'scorm2004') broken.push(`${name}: опознан как ${metadata.format}`);
    for (const issue of report.errors) broken.push(`${name}: ${issue.code} @ ${issue.location}`);
  }

  // Пакет из официального Test Suite конформен по определению: ошибка здесь — наша, а не его.
  assert.deepEqual(broken, []);
});

/**
 * Политика приёма на путях настоящих пакетов.
 *
 * Размеры записей здесь выдуманы — в корпусе хранятся только пути, — и это ровно то, что нужно:
 * `planExtraction` про размеры проверяет лимиты, а про состав пакета решает по путям и расширениям.
 * Проверяется вторая половина.
 */
async function planFixture(section: string, name: string): Promise<ArchivePlan> {
  const paths = await fixturePaths(join(ROOT, section, name));
  const entries = paths.map(path => ({
    path,
    uncompressedSize: 1024,
    compressedSize: 1024,
    isDirectory: path.endsWith('/'),
    isEncrypted: false,
    lastModified: new Date(0),
  }));
  return planExtraction(entries);
}

test('политика приёма пропускает весь корпус, а не только разбор', async () => {
  // Разбор и приём — разные решения о пакете, и до 2026-08-11 корпусом проверялся только разбор.
  // На настоящей загрузке это и вылезло: пакет с `datatypes.dtd` отвергался целиком, хотя
  // разбирался прекрасно.
  const sections = ['conformance', 'scorm12', 'scorm2004', 'cmi5', 'xapi', 'aicc'];
  const rejected: string[] = [];
  const skipped: string[] = [];

  for (const section of sections) {
    for (const name of await packagesIn(section)) {
      try {
        const plan = await planFixture(section, name);
        for (const path of plan.skipped) skipped.push(`${section}/${name}: ${path}`);
      } catch (error) {
        rejected.push(`${section}/${name}: ${(error as Error).message}`);
      }
    }
  }

  assert.deepEqual(rejected, [], 'настоящий пакет не должен отвергаться целиком');
  // Единственный пропуск на весь корпус — файл редактора схем от Microsoft, лежащий рядом с `.xsd`.
  // Он ничей и никем не объявлен; курс от его отсутствия не меняется.
  assert.deepEqual(skipped, ['scorm2004/sequencing-post-test-rollup-4ed: adlcp_v1p3.xsx']);
});

test('каждый формат опознаётся на настоящих пакетах', async () => {
  const expected: [string, string][] = [
    ['scorm12', 'scorm12'],
    ['scorm2004', 'scorm2004'],
    ['cmi5', 'cmi5'],
    ['xapi', 'xapi'],
    ['aicc', 'aicc'],
  ];

  for (const [section, format] of expected) {
    for (const name of await packagesIn(section)) {
      const { metadata } = await parseFixture(section, name);
      // Единственное исключение — пакет со сломанной разметкой: он на то и заведён.
      if (name === 'malformed-xml') continue;
      assert.equal(metadata.format, format, `${section}/${name}`);
    }
  }
});

test('курс про гольф: оглавление, точка запуска, порог', async () => {
  const { metadata, report } = await parseFixture('scorm12', 'golf-one-file-per-sco');

  assert.equal(metadata.format, 'scorm12');
  assert.equal(metadata.title, 'Golf Explained - CP One File Per SCO');
  assert.equal(metadata.entryPoint, 'Playing/Playing.html');
  assert.equal(metadata.activities.length, 4);
  assert.deepEqual(
    metadata.activities.map(activity => activity.title),
    ['Playing the Game', 'Etiquette', 'Handicapping', 'Having Fun'],
  );
  assert.deepEqual(report.errors, []);
});

test('SCORM 2004: sequencing настоящего пакета разбирается', async () => {
  const { metadata } = await parseFixture('scorm2004', 'sequencing-post-test-rollup');

  assert.equal(metadata.format, 'scorm2004');
  assert.equal(metadata.schemaVersion, '2004 3rd Edition');
  // Правила перехода и rollup — то, ради чего писалась фаза 04; здесь они на настоящем пакете.
  const withSequencing = [...metadata.activities].filter(activity => activity.sequencing);
  assert.ok(withSequencing.length > 0, 'sequencing прочитан');
});

test('LOM во внешнем файле подхватывается на настоящем пакете', async () => {
  // `<adlcp:location>metadata.xml</adlcp:location>` — второй проход `parsePackage`. Разметка здесь
  // профиля IMS 1.2: `<langstring>` и всё в нижнем регистре (`catalogentry`, `metadatascheme`).
  const { metadata } = await parseFixture('scorm12', 'with-metadata');

  assert.ok(metadata.lom, 'внешний LOM прочитан');
  assert.deepEqual(metadata.lom.general?.languages, ['en']);
  assert.deepEqual(
    metadata.lom.general?.keywords.map(keyword => langText(keyword)),
    ['Training'],
  );
  assert.ok(metadata.lom.technical?.formats.includes('application/x-shockwave-flash'));
  assert.equal(metadata.lom.lifeCycle?.status, 'Final');

  // Описание в файле есть, но пустое — шаблон, который автор не заполнил. Брать нечего, и
  // подставлять сюда что-то другое нельзя: пустое описание это факт о пакете.
  assert.equal(metadata.description, null);
});

test('ожидаемое время прохождения поднимается наверх из внешнего LOM', async () => {
  // `<typicalLearningTime><duration>PT10M</duration>` лежит в `metadata_course.xml`, на который
  // манифест только ссылается: значит, поднять его наверх должен второй проход `parsePackage`, а
  // не разборщик манифеста — у того на входе строка.
  const { metadata } = await parseFixture('scorm2004', 'with-metadata');

  assert.equal(metadata.typicalLearningTimeSeconds, 600);
  assert.equal(metadata.lom?.educational[0].typicalLearningTimeSeconds, 600, 'наверх поднято, а не перенесено');
});

test('форматы без LOM не выдумывают продолжительность', async () => {
  for (const [section, name] of [
    ['cmi5', 'mastery-score'],
    ['aicc', 'basic'],
  ] as const) {
    const { metadata } = await parseFixture(section, name);
    assert.equal(metadata.typicalLearningTimeSeconds, null, `${section}/${name}`);
  }
});

test('cmi5: цели курса и moveOn на единицах', async () => {
  const { metadata } = await parseFixture('cmi5', 'mastery-score');

  assert.equal(metadata.format, 'cmi5');
  assert.ok(metadata.activities.length > 0);
  assert.ok(
    metadata.activities.some(activity => activity.masteryScore !== null),
    'проходной балл прочитан',
  );
});

test('AICC: настоящий описатель с внешним запуском', async () => {
  const { metadata, report } = await parseFixture('aicc', 'multiline-description');

  assert.equal(metadata.format, 'aicc');
  assert.equal(metadata.title, 'Achieving Work-Life Balance');
  // Курс запускается с чужого адреса — для библиотеки это находка, а не отказ.
  assert.equal(metadata.entryPoint, null);
  assert.ok(report.warnings.some(issue => issue.code === 'common.external-launch'));
});

test('AICC с настоящим CRLF разбирается', async () => {
  // `aicc/basic` пришёл из чужого инструмента проверки и весь в CRLF. Файлы корпуса помечены в
  // `.gitattributes` как `-text`, поэтому переводы строк в них те же, что у автора, а не те, что
  // сделал git на клоне. Без этого проверка была бы фиктивной.
  const { metadata } = await parseFixture('aicc', 'basic');

  assert.equal(metadata.format, 'aicc');
  assert.equal(metadata.title, 'UniversitySite AICC Testing Tool');
  assert.ok(metadata.activities.length > 0);
  // Хвостовой `\r` не должен доехать до значений.
  for (const activity of metadata.activities) {
    assert.ok(!activity.identifier.includes('\r'), `\\r в идентификаторе "${activity.identifier}"`);
    assert.ok(!activity.title?.includes('\r'), `\\r в названии "${activity.title}"`);
  }

  // Описание единицы объявлено только в `.des`: в `.au` такой колонки нет вовсе, и раньше мы её
  // содержимое просто выбрасывали.
  assert.deepEqual(metadata.activities[0].descriptions, { '': 'Descriptive Text' });
});

test('политику отказа задаёт потребитель, а не библиотека', async () => {
  // Один и тот же пакет и один и тот же отчёт — три разных ответа на вопрос «принимать?».
  const source = await fixtureSource(join(ROOT, 'scorm12', 'prerequisites'));

  const asis = await parsePackage(source, CORPUS);
  const strict = await parsePackage(source, { ...CORPUS, strictness: 'strict' });
  const lenient = await parsePackage(source, { ...CORPUS, strictness: 'lenient' });

  // Условия открытия написаны словами (`module1 AND module2`) — грамматика AICC такого не знает,
  // и у образца тоже. Курс при этом проигрывается, поэтому по умолчанию это предупреждение.
  assert.ok(asis.report.warnings.some(issue => issue.code === 'common.prerequisite-unparsable'));
  assert.equal(asis.report.ok, true);
  assert.equal(strict.report.ok, false);
  assert.equal(lenient.report.ok, true);
  assert.deepEqual(lenient.report.errors, []);
});

test('сломанная разметка даёт отчёт, а не исключение', async () => {
  const { report } = await parseFixture('scorm12', 'malformed-xml');

  assert.ok(report.warnings.some(issue => issue.code === 'common.xml-malformed'));
  assert.equal(report.ok, false);
});
