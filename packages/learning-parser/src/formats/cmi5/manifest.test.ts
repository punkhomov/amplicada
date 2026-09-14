import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PackageParseError } from '../../errors.js';
import type { ValidationIssue } from '../../issue.js';
import { launchableActivities } from '../../model/activity.js';
import type { Cmi5Details } from '../../model/details.js';
import type { PackageMetadata } from '../../model/metadata.js';
import { parseCmi5 } from './manifest.js';

/** Сужение по формату без приведения типов — ровно то, ради чего `details` размечено `format`. */
function detailsOf(metadata: PackageMetadata): Cmi5Details {
  if (metadata.format !== 'cmi5') throw new Error(`ожидался cmi5, а не ${metadata.format}`);
  return metadata.details;
}

/** Форма из спецификации cmi5: курс, вложенные блоки, у каждой AU свой url. */
const COURSE = `<?xml version="1.0" encoding="UTF-8"?>
<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd" version="1.0">
  <course id="http://example.com/course/security">
    <title><langstring lang="ru">Информационная безопасность</langstring></title>
    <description><langstring lang="ru">Вводный курс</langstring></description>
  </course>
  <au id="http://example.com/au/intro" moveOn="CompletedAndPassed" masteryScore="0.8" launchMethod="AnyWindow">
    <title><langstring lang="ru">Введение</langstring></title>
    <url>content/intro.html?pages=1</url>
  </au>
  <block id="http://example.com/block/1">
    <title><langstring lang="ru">Практика</langstring></title>
    <au id="http://example.com/au/practice">
      <title><langstring lang="ru">Задание</langstring></title>
      <url>content/practice.html</url>
    </au>
  </block>
</courseStructure>`;

test('cmi5.xml разбирается: курс, первая AU, счёт единиц', () => {
  const metadata = parseCmi5(COURSE);
  assert.equal(metadata.format, 'cmi5');
  assert.equal(metadata.identifier, 'http://example.com/course/security');
  assert.equal(metadata.title, 'Информационная безопасность');
  assert.equal(metadata.description, 'Вводный курс');
  assert.equal(metadata.schemaVersion, '1.0');
  assert.equal(metadata.entryPoint, 'content/intro.html');
  assert.equal(metadata.entryParameters, '?pages=1');
  assert.equal(launchableActivities(metadata.activities).length, 2, 'AU внутри блока тоже считается');
});

test('id курса остаётся IRI, а не превращается в число', () => {
  // Ровно поэтому в парсере выключено приведение значений: часть id выглядит как версия.
  const xml = `<courseStructure><course id="12.5"><title>Курс</title></course>
    <au id="au"><url>a.html</url></au></courseStructure>`;
  assert.equal(parseCmi5(xml).identifier, '12.5');
  assert.equal(typeof parseCmi5(xml).identifier, 'string');
});

test('masteryScore в cmi5 — уже доля, делить на 100 нельзя', () => {
  assert.equal(parseCmi5(COURSE).masteryScore, 0.8);
});

test('внешний url отдаётся как URL, а не как путь в пакете', () => {
  // У cmi5 контент на чужом сервере — норма. Искать такой адрес в инвентаре бессмысленно.
  const xml = `<courseStructure><course id="c"><title>Курс</title></course>
    <au id="au"><url>https://vendor.example/launch?course=1</url></au></courseStructure>`;
  const metadata = parseCmi5(xml);
  assert.equal(metadata.entryPoint, null);
  assert.equal(metadata.entryUrl, 'https://vendor.example/launch?course=1');
  assert.equal(metadata.entryParameters, '');
});

test('название берётся у AU, если у курса его нет', () => {
  const xml = `<courseStructure><course id="c"/>
    <au id="au"><title>Название единицы</title><url>a.html</url></au></courseStructure>`;
  assert.equal(parseCmi5(xml).title, 'Название единицы');
});

test('простой текст вместо langstring тоже читается', () => {
  const xml = `<courseStructure><course id="c"><title>Без langstring</title></course>
    <au id="au"><url>a.html</url></au></courseStructure>`;
  assert.equal(parseCmi5(xml).title, 'Без langstring');
});

test('порядок обхода — как в оглавлении: корневые AU раньше вложенных', () => {
  const xml = `<courseStructure><course id="c"/>
    <au id="first"><url>first.html</url></au>
    <block id="b"><au id="second"><url>second.html</url></au></block>
  </courseStructure>`;
  assert.equal(parseCmi5(xml).entryPoint, 'first.html');
});

test('пакет без AU и AU без url становятся находками, а не исключениями', () => {
  const noUnits: ValidationIssue[] = [];
  parseCmi5('<courseStructure><course id="c"/></courseStructure>', 'cmi5.xml', noUnits);
  assert.equal(
    noUnits.some(issue => issue.code === 'cmi5.au-missing' && issue.severity === 'error'),
    true,
  );

  const noUrl: ValidationIssue[] = [];
  const metadata = parseCmi5('<courseStructure><au id="a"><title>Без url</title></au></courseStructure>', 'cmi5.xml', noUrl);
  assert.equal(metadata.entryPoint, null);
  assert.deepEqual(
    noUrl.map(issue => issue.code),
    ['cmi5.course-missing', 'cmi5.launch-url-missing'],
    'единица без url и курс без <course> — разные беды с разными причинами',
  );
});

test('посторонний XML не выдаёт себя за cmi5', () => {
  assert.throws(() => parseCmi5('<manifest identifier="scorm"/>'), PackageParseError);
});

test('блоки cmi5 остаются узлами дерева, а не уплощаются', () => {
  const activities = parseCmi5(COURSE).activities;
  assert.deepEqual(
    activities.map(activity => activity.identifier),
    ['http://example.com/au/intro', 'http://example.com/block/1'],
  );

  const block = activities[1];
  assert.equal(block.launch, null, 'блок — глава, а не единица прохождения');
  assert.equal(block.title, 'Практика', 'название блока раньше терялось вместе с ним');
  assert.deepEqual(
    block.children.map(child => child.identifier),
    ['http://example.com/au/practice'],
  );
});

test('вложенность блоков любой глубины сохраняется', () => {
  const xml = `<courseStructure><course id="c"/>
    <block id="b1"><title>Первый</title>
      <block id="b2"><title>Второй</title><au id="deep"><url>deep.html</url></au></block>
    </block>
  </courseStructure>`;
  const activities = parseCmi5(xml).activities;
  assert.equal(activities[0].children[0].children[0].identifier, 'deep');
  assert.equal(parseCmi5(xml).entryPoint, 'deep.html');
});

test('moveOn, launchMethod и тип активности доезжают до единицы', () => {
  const intro = parseCmi5(COURSE).activities[0];
  assert.equal(intro.moveOn, 'CompletedAndPassed');
  assert.equal(intro.launchMethod, 'AnyWindow');
  assert.equal(intro.masteryScore, 0.8, 'порог сам по себе не решает — его дополняет moveOn');
});

test('каждое значение moveOn из спецификации читается, чужое становится находкой', () => {
  for (const value of ['Passed', 'Completed', 'CompletedAndPassed', 'CompletedOrPassed', 'NotApplicable']) {
    const xml = `<courseStructure><course id="c"/><au id="a" moveOn="${value}"><url>a.html</url></au></courseStructure>`;
    assert.equal(parseCmi5(xml).activities[0].moveOn, value);
  }

  const issues: ValidationIssue[] = [];
  const xml = '<courseStructure><course id="c"/><au id="a" moveOn="Whenever"><url>a.html</url></au></courseStructure>';
  // Подставить умолчание нельзя: «зачесть сразу» и «зачесть после двух условий» видны учащемуся.
  assert.equal(parseCmi5(xml, 'cmi5.xml', issues).activities[0].moveOn, null);
  assert.equal(issues.filter(issue => issue.code === 'cmi5.moveon-unknown').length, 1);
});

test('цели курса собираются в details, а на единице остаются ссылки', () => {
  const xml = `<courseStructure><course id="c"/>
    <objectives>
      <objective id="obj1"><title><langstring lang="ru">Знать правила</langstring></title>
        <description><langstring lang="ru">По итогам курса</langstring></description></objective>
      <objective id="obj2"><title>Уметь применять</title></objective>
    </objectives>
    <au id="a" activityType="http://adlnet.gov/expapi/activities/lesson">
      <url>a.html</url>
      <objectives><objective idref="obj1"/><objective idref="obj2"/></objectives>
      <entitlementKey>KEY-1</entitlementKey>
    </au>
  </courseStructure>`;
  const metadata = parseCmi5(xml);
  assert.equal(metadata.format, 'cmi5');
  assert.deepEqual(detailsOf(metadata).objectives, [
    { id: 'obj1', title: 'Знать правила', description: 'По итогам курса' },
    { id: 'obj2', title: 'Уметь применять', description: null },
  ]);

  const unit = metadata.activities[0];
  assert.deepEqual(unit.objectiveRefs, ['obj1', 'obj2']);
  assert.equal(unit.activityType, 'http://adlnet.gov/expapi/activities/lesson');
  assert.equal(unit.entitlementKey, 'KEY-1');
});

test('курс без целей даёт пустой список, а не null', () => {
  assert.deepEqual(detailsOf(parseCmi5(COURSE)).objectives, []);
});

test('название и описание курса хранятся на всех объявленных языках', () => {
  const xml = `<courseStructure>
  <course id="http://example.com/course">
    <title><langstring lang="ru">Безопасность</langstring><langstring lang="en">Security</langstring></title>
    <description><langstring lang="ru">Вводный курс</langstring><langstring lang="en">Intro course</langstring></description>
  </course>
  <au id="http://example.com/au">
    <title><langstring lang="ru">Введение</langstring><langstring lang="en">Intro</langstring></title>
    <description><langstring lang="en">What you will learn</langstring></description>
    <url>a.html</url>
  </au>
</courseStructure>`;
  const metadata = parseCmi5(xml);

  // Наверху — выбранное для показа, целиком объявленное лежит рядом: терять переводы мы отказались
  // ещё в LOM, и в cmi5 причин поступать иначе нет.
  assert.equal(metadata.title, 'Безопасность');
  assert.deepEqual(detailsOf(metadata).courseTitles, { ru: 'Безопасность', en: 'Security' });
  assert.deepEqual(detailsOf(metadata).courseDescriptions, { ru: 'Вводный курс', en: 'Intro course' });

  const unit = metadata.activities[0];
  assert.deepEqual(unit.titles, { ru: 'Введение', en: 'Intro' });
  assert.deepEqual(unit.descriptions, { en: 'What you will learn' });
});

test('подпись без языка кладётся под пустой ключ, а не теряется', () => {
  const metadata = parseCmi5(
    '<courseStructure><course id="c"><title>Курс</title></course><au id="a"><url>a.html</url></au></courseStructure>',
  );
  assert.deepEqual(detailsOf(metadata).courseTitles, { '': 'Курс' });
});

test('contextTemplate разбирается отдельно на курсе и на единице', () => {
  // Элемента с таким именем в схеме cmi5 нет — это расширение сборщиков. Курсовая заготовка и
  // заготовка единицы по спецификации разные области, и сливать их должен тот, кто собирает
  // `LMS.LaunchData`.
  const xml = `<courseStructure>
  <course id="http://example.com/course">
    <title><langstring>Курс</langstring></title>
    <contextTemplate>
      <contextActivities>
        <grouping><activity id="http://example.com/programme"/></grouping>
      </contextActivities>
      <extensions><extension id="http://example.com/ext/vendor">Наш центр</extension></extensions>
    </contextTemplate>
  </course>
  <au id="http://example.com/au/one">
    <url>one.html</url>
    <contextTemplate>
      <contextActivities>
        <category><activity id="http://example.com/cat/a"/><activity id="http://example.com/cat/b"/></category>
        <parent><activity id="http://example.com/course"/></parent>
      </contextActivities>
    </contextTemplate>
  </au>
  <au id="http://example.com/au/two"><url>two.html</url></au>
</courseStructure>`;
  const metadata = parseCmi5(xml);

  const course = detailsOf(metadata).contextTemplate;
  assert.deepEqual(course?.contextActivities, { grouping: ['http://example.com/programme'] });
  assert.deepEqual(course?.extensions, { 'http://example.com/ext/vendor': 'Наш центр' });

  const [first, second] = metadata.activities;
  assert.deepEqual(first.contextTemplate?.contextActivities, {
    parent: ['http://example.com/course'],
    category: ['http://example.com/cat/a', 'http://example.com/cat/b'],
  });
  assert.deepEqual(first.contextTemplate?.extensions, {});
  // Расширение необязательно: единица без него отдаёт `null`, а не пустую заготовку.
  assert.equal(second.contextTemplate, null);
});
