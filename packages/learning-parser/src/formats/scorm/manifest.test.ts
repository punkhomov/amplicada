import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packageRootOf } from '../../archive/layout.js';
import type { ValidationIssue } from '../../issue.js';
import { launchableActivities, walkActivities } from '../../model/activity.js';
import { findManifestPath, parseManifest } from './manifest.js';

/** Пакет от Rustici — форма, которую выдают почти все промышленные сборщики курсов. */
const GOLF_SINGLE_SCO = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="com.scorm.golfsamples.singlesco.12" version="1"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="golf_sample_default_org">
    <organization identifier="golf_sample_default_org">
      <title>Golf Explained - CP Single SCO</title>
      <item identifier="item_1" identifierref="resource_1"><title>Golf Explained</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="resource_1" type="webcontent" adlcp:scormtype="sco" href="shared/launchpage.html">
      <file href="shared/launchpage.html"/>
    </resource>
  </resources>
</manifest>`;

test('типовой пакет разбирается целиком', () => {
  const manifest = parseManifest(GOLF_SINGLE_SCO);
  assert.equal(manifest.identifier, 'com.scorm.golfsamples.singlesco.12');
  assert.equal(manifest.format, 'scorm12');
  assert.equal(manifest.schemaVersion, '1.2');
  assert.equal(manifest.title, 'Golf Explained - CP Single SCO');
  assert.equal(manifest.entryPoint, 'shared/launchpage.html');
  assert.equal(manifest.entryParameters, '');
  assert.equal(launchableActivities(manifest.activities).length, 1);
});

test('версия схемы остаётся строкой, а не превращается в число', () => {
  // `1.2` как число сравнивалось бы уже не со строкой «1.2», а `2004 3rd Edition` вообще не число.
  assert.equal(typeof parseManifest(GOLF_SINGLE_SCO).schemaVersion, 'string');
});

test('неймспейсы на тегах не мешают — их пишут все по-разному', () => {
  const xml = `<?xml version="1.0"?>
<imscp:manifest identifier="ns" xmlns:imscp="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <imscp:organizations default="org">
    <imscp:organization identifier="org">
      <imscp:title>Курс с префиксами</imscp:title>
      <imscp:item identifier="i1" identifierref="r1"/>
    </imscp:organization>
  </imscp:organizations>
  <imscp:resources>
    <imscp:resource identifier="r1" href="start.html"/>
  </imscp:resources>
</imscp:manifest>`;
  const manifest = parseManifest(xml);
  assert.equal(manifest.title, 'Курс с префиксами');
  assert.equal(manifest.entryPoint, 'start.html');
});

test('точка входа берётся из первого вложенного item с identifierref, а не из первого верхнего', () => {
  const xml = `<manifest identifier="nested">
  <organizations default="org">
    <organization identifier="org">
      <title>Nested</title>
      <item identifier="module_1">
        <item identifier="chapter_1">
          <item identifier="topic_1" identifierref="r1"/>
        </item>
      </item>
      <item identifier="module_2" identifierref="r2"/>
    </organization>
  </organizations>
  <resources>
    <resource identifier="r1" href="deep.html"/>
    <resource identifier="r2" href="shallow.html"/>
  </resources>
</manifest>`;
  const manifest = parseManifest(xml);
  assert.equal(manifest.entryPoint, 'deep.html', 'обход в глубину: пункт оглавления идёт раньше следующего модуля');
  assert.equal(launchableActivities(manifest.activities).length, 2);
});

test('организация по умолчанию выбирается по атрибуту default, а не по порядку', () => {
  const xml = `<manifest identifier="two-orgs">
  <organizations default="second">
    <organization identifier="first"><title>Первая</title><item identifier="a" identifierref="r1"/></organization>
    <organization identifier="second"><title>Вторая</title><item identifier="b" identifierref="r2"/></organization>
  </organizations>
  <resources>
    <resource identifier="r1" href="first.html"/>
    <resource identifier="r2" href="second.html"/>
  </resources>
</manifest>`;
  const manifest = parseManifest(xml);
  assert.equal(manifest.title, 'Вторая');
  assert.equal(manifest.entryPoint, 'second.html');
});

test('битая ссылка на ресурс пропускается, берётся следующая рабочая', () => {
  const xml = `<manifest identifier="broken-ref">
  <organizations default="org">
    <organization identifier="org">
      <item identifier="a" identifierref="нет-такого"/>
      <item identifier="b" identifierref="r2"/>
    </organization>
  </organizations>
  <resources><resource identifier="r2" href="ok.html"/></resources>
</manifest>`;
  assert.equal(parseManifest(xml).entryPoint, 'ok.html');
});

test('xml:base складывается по всей цепочке', () => {
  // Без учёта base точка входа указала бы на index.html в корне — и пакет открывался бы 404.
  const xml = `<manifest identifier="based" xml:base="course/">
  <organizations default="org">
    <organization identifier="org"><item identifier="a" identifierref="r1"/></organization>
  </organizations>
  <resources xml:base="content/">
    <resource identifier="r1" xml:base="sco1/" href="index.html"/>
  </resources>
</manifest>`;
  assert.equal(parseManifest(xml).entryPoint, 'course/content/sco1/index.html');
});

test('query и фрагмент отрезаются от пути, но не теряются', () => {
  const xml = `<manifest identifier="params">
  <organizations default="org">
    <organization identifier="org"><item identifier="a" identifierref="r1" parameters="?mode=review"/></organization>
  </organizations>
  <resources><resource identifier="r1" href="index.html?lang=ru"/></resources>
</manifest>`;
  const manifest = parseManifest(xml);
  assert.equal(manifest.entryPoint, 'index.html', 'в инвентаре лежит путь, а не URL');
  assert.equal(manifest.entryParameters, '?lang=ru&mode=review', 'второй знак вопроса сломал бы URL');
});

test('без организаций точка входа ищется среди ресурсов, приоритет у sco', () => {
  const xml = `<manifest identifier="no-orgs">
  <organizations/>
  <resources>
    <resource identifier="asset" type="webcontent" href="styles.css"/>
    <resource identifier="sco" type="webcontent" adlcp:scormtype="sco" href="launch.html"/>
  </resources>
</manifest>`;
  assert.equal(parseManifest(xml).entryPoint, 'launch.html');
});

test('название берётся из LOM, если у организации его нет', () => {
  const xml = `<manifest identifier="lom">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
    <lom><general><title><langstring xml:lang="ru">Название из метаданных</langstring></title></general></lom>
  </metadata>
  <organizations default="org">
    <organization identifier="org"><item identifier="a" identifierref="r1"/></organization>
  </organizations>
  <resources><resource identifier="r1" href="index.html"/></resources>
</manifest>`;
  assert.equal(parseManifest(xml).title, 'Название из метаданных');
});

test('SCORM 2004 распознаётся, хотя рантайма для него пока нет', () => {
  const xml = `<manifest identifier="s2004" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
  <organizations default="org">
    <organization identifier="org"><item identifier="a" identifierref="r1"/></organization>
  </organizations>
  <resources><resource identifier="r1" adlcp:scormType="sco" href="index.html"/></resources>
</manifest>`;
  const manifest = parseManifest(xml);
  assert.equal(manifest.format, 'scorm2004');
  assert.equal(manifest.schemaVersion, '2004 4th Edition');
});

test('версия определяется по неймспейсу, когда schemaversion не указан', () => {
  const xml = `<manifest identifier="ns-only" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
  <organizations default="org">
    <organization identifier="org"><item identifier="a" identifierref="r1"/></organization>
  </organizations>
  <resources><resource identifier="r1" href="index.html"/></resources>
</manifest>`;
  assert.equal(parseManifest(xml).format, 'scorm2004');
});

test('манифест без единого href — отказ с внятной причиной', () => {
  const xml = `<manifest identifier="empty">
  <organizations default="org"><organization identifier="org"><item identifier="a"/></organization></organizations>
  <resources><resource identifier="r1"/></resources>
</manifest>`;
  const manifest = parseManifest(xml);
  assert.equal(manifest.entryPoint, null, 'решение «принимать или нет» принимает потребитель');
  assert.equal(manifest.activities.length, 1, 'оглавление разобрано, хоть и незапускаемое');
});

test('href, ведущий за пределы пакета, — отказ, а не «не нашли»', () => {
  const xml = `<manifest identifier="slip">
  <organizations default="org"><organization identifier="org"><item identifier="a" identifierref="r1"/></organization></organizations>
  <resources><resource identifier="r1" href="../../etc/passwd"/></resources>
</manifest>`;
  const issues: ValidationIssue[] = [];
  const manifest = parseManifest(xml, 'imsmanifest.xml', issues);

  assert.equal(manifest.entryPoint, null, 'запускать такое мы не станем');
  const slip = issues.find(issue => issue.code === 'common.launch-unresolvable');
  assert.match(slip?.message ?? '', /выходит за пределы пакета/);
  assert.equal(slip?.location, 'imsmanifest.xml#a', 'место названо — иначе в манифесте на сотню пунктов его не найти');
});

test('посторонний корень — исключение: непонятно, что это за файл', () => {
  assert.throws(() => parseManifest('<tincan><activities/></tincan>'), /нет корневого элемента/);
});

test('нарушенная разметка не роняет разбор, но и не замалчивается', () => {
  // fast-xml-parser незакрытый тег глотает вместе с содержимым: пропавший <resources> выглядит как
  // курс без ресурсов, а не как сломанный файл, и автор пакета искал бы причину не там.
  const issues: ValidationIssue[] = [];
  parseManifest('<manifest identifier="x"><organizations>', 'imsmanifest.xml', issues);
  assert.equal(
    issues.some(issue => issue.code === 'common.xml-malformed'),
    true,
  );
});

test('проходной балл SCORM 1.2 — проценты, приводится к доле', () => {
  const xml = `<manifest identifier="mastery">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org"><organization identifier="org">
    <item identifier="a" identifierref="r1"><adlcp:masteryscore>80</adlcp:masteryscore></item>
  </organization></organizations>
  <resources><resource identifier="r1" href="index.html"/></resources>
</manifest>`;
  assert.equal(parseManifest(xml).masteryScore, 0.8);
});

test('проходной балл SCORM 2004 — уже доля, делить не надо', () => {
  const xml = `<manifest identifier="mastery2004">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
  <organizations default="org"><organization identifier="org">
    <item identifier="a" identifierref="r1"><imsss:sequencing><imsss:objectives>
      <imsss:primaryObjective><imsss:minNormalizedMeasure>0.7</imsss:minNormalizedMeasure></imsss:primaryObjective>
    </imsss:objectives></imsss:sequencing></item>
  </organization></organizations>
  <resources><resource identifier="r1" href="index.html"/></resources>
</manifest>`;
  assert.equal(parseManifest(xml).masteryScore, 0.7);
});

test('href на чужой сервер — это URL, а не путь в пакете', () => {
  // Раньше такой href превращался в бессмысленный путь `http:/vendor.example/...` и искался
  // в инвентаре. Теперь он честно отдаётся как внешний адрес, а решает уже вызывающий.
  const xml = `<manifest identifier="external">
  <organizations default="org"><organization identifier="org"><item identifier="a" identifierref="r1"/></organization></organizations>
  <resources><resource identifier="r1" href="https://vendor.example/player/index.html"/></resources>
</manifest>`;
  const metadata = parseManifest(xml);
  assert.equal(metadata.entryPoint, null);
  assert.equal(metadata.entryUrl, 'https://vendor.example/player/index.html');
});

test('манифест ищется без учёта регистра и на любой глубине', () => {
  assert.equal(findManifestPath(['index.html', 'imsmanifest.xml']), 'imsmanifest.xml');
  assert.equal(findManifestPath(['IMSManifest.xml']), 'IMSManifest.xml');
  // Курс, зазипованный вместе с внешней папкой, — самая частая ошибка при заливке.
  assert.equal(findManifestPath(['course/index.html', 'course/imsmanifest.xml']), 'course/imsmanifest.xml');
  assert.equal(findManifestPath(['a/b/imsmanifest.xml', 'a/imsmanifest.xml']), 'a/imsmanifest.xml', 'самый мелкий выигрывает');
  assert.equal(findManifestPath(['readme.txt', 'nested/imsmanifest.xml.bak']), null);
});

test('корнем пакета становится каталог манифеста', () => {
  assert.equal(packageRootOf('imsmanifest.xml'), '');
  assert.equal(packageRootOf('course/imsmanifest.xml'), 'course/');
  assert.equal(packageRootOf('a/b/imsmanifest.xml'), 'a/b/');
});

/** Пункт оглавления несёт то, что дальше становится моделью данных рантайма. */
const RICH_TREE = `<manifest identifier="tree">
  <metadata><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org">
    <organization identifier="org">
      <title>Курс</title>
      <item identifier="module" isvisible="true">
        <title>Модуль</title>
        <item identifier="hidden" identifierref="r_hidden" isvisible="false"><title>Служебный</title></item>
        <item identifier="lesson" identifierref="r_lesson">
          <title>Урок</title>
          <adlcp:masteryscore>80</adlcp:masteryscore>
          <adlcp:maxtimeallowed>01:30:00</adlcp:maxtimeallowed>
          <adlcp:timelimitaction>exit,message</adlcp:timelimitaction>
          <adlcp:datafromlms>mode=strict</adlcp:datafromlms>
        </item>
      </item>
      <item identifier="broken" identifierref="nowhere"><title>Ссылка в никуда</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="r_hidden" href="service.html"/>
    <resource identifier="r_lesson" href="lesson.html"/>
  </resources>
</manifest>`;

test('оглавление собирается деревом, а не списком', () => {
  const roots = parseManifest(RICH_TREE).activities;
  assert.deepEqual(
    roots.map(root => root.identifier),
    ['module', 'broken'],
  );
  assert.deepEqual(
    roots[0].children.map(child => child.identifier),
    ['hidden', 'lesson'],
  );
});

test('контейнер без identifierref остаётся узлом, а не выбрасывается', () => {
  // На него ссылается sequencing и он виден в оглавлении — выкинуть его значит потерять структуру.
  const module = parseManifest(RICH_TREE).activities[0];
  assert.equal(module.launch, null);
  assert.equal(module.title, 'Модуль');
  assert.equal(module.children.length, 2);
});

test('isvisible="false" скрывает пункт из оглавления, но не из дерева', () => {
  const [hidden, lesson] = parseManifest(RICH_TREE).activities[0].children;
  assert.equal(hidden.visible, false);
  assert.equal(lesson.visible, true, 'отсутствие атрибута означает видимый');
  assert.equal(hidden.launch?.entryPoint, 'service.html', 'скрытый пункт запускаем — на него попадают переходом');
});

test('поля пункта доезжают до модели: они станут cmi.* в рантайме', () => {
  const lesson = parseManifest(RICH_TREE).activities[0].children[1];
  assert.equal(lesson.masteryScore, 0.8, 'проценты приводятся к доле');
  assert.equal(lesson.maxTimeSeconds, 5400);
  assert.equal(lesson.timeLimitAction, 'exit,message');
  assert.equal(lesson.launchData, 'mode=strict', 'это cmi.launch_data — без него курс стартует в дефолте');
});

test('порог берётся у пункта запуска, а не у первого попавшегося', () => {
  // Раньше masteryScore читался с точки входа и применялся ко всему курсу.
  const manifest = parseManifest(RICH_TREE);
  assert.equal(manifest.entryPoint, 'service.html', 'первый запускаемый в обходе — скрытый пункт');
  assert.equal(manifest.masteryScore, null, 'у него порога нет, и чужой подставлять нельзя');
});

test('identifierref в никуда не роняет разбор', () => {
  const broken = parseManifest(RICH_TREE).activities[1];
  assert.equal(broken.launch, null);
  assert.equal(broken.resourceId, 'nowhere', 'ссылка сохранена — правилам валидации о ней сообщать');
});

test('у каждого ресурса своя xml:base, а не общая от точки входа', () => {
  const xml = `<manifest identifier="bases" xml:base="package/">
  <organizations default="org">
    <organization identifier="org">
      <item identifier="a" identifierref="r1"/>
      <item identifier="b" identifierref="r2"/>
    </organization>
  </organizations>
  <resources xml:base="content/">
    <resource identifier="r1" xml:base="one/" href="a.html"/>
    <resource identifier="r2" xml:base="two/" href="b.html"/>
  </resources>
</manifest>`;
  const roots = parseManifest(xml).activities;
  assert.equal(roots[0].launch?.entryPoint, 'package/content/one/a.html');
  assert.equal(roots[1].launch?.entryPoint, 'package/content/two/b.html', 'база соседа не протекает');
});

test('`../` относительно xml:base схлопывается, а не отвергается', () => {
  // Курсы с общим проигрывателем на несколько модулей ссылаются вверх штатно. Раньше такой пакет
  // падал с «выходит за пределы пакета» на совершенно исправном href.
  const xml = `<manifest identifier="up">
  <organizations default="org"><organization identifier="org"><item identifier="a" identifierref="r1"/></organization></organizations>
  <resources xml:base="modules/intro/"><resource identifier="r1" href="../../shared/player.html"/></resources>
</manifest>`;
  assert.equal(parseManifest(xml).entryPoint, 'shared/player.html');
});

test('выход за корень пакета по-прежнему не запускается', () => {
  const xml = `<manifest identifier="escape">
  <organizations default="org"><organization identifier="org"><item identifier="a" identifierref="r1"/></organization></organizations>
  <resources><resource identifier="r1" href="../../../etc/passwd"/></resources>
</manifest>`;
  assert.equal(parseManifest(xml).entryPoint, null);
});

test('пункт без identifier получает позиционный, не сталкивающийся с настоящими', () => {
  const xml = `<manifest identifier="anon">
  <organizations default="org"><organization identifier="org">
    <item><title>Без идентификатора</title><item identifierref="r1"/></item>
  </organization></organizations>
  <resources><resource identifier="r1" href="a.html"/></resources>
</manifest>`;
  const ids = [...walkActivities(parseManifest(xml).activities)].map(activity => activity.identifier);
  assert.deepEqual(ids, ['#0', '#0.0'], 'символ # в xs:ID недопустим, поэтому с авторским не столкнётся');
});

/**
 * Агрегат: `<manifest>` внутри `<manifest>`. Так собирают курс из курсов — каждый подманифест
 * несёт своё оглавление и свои ресурсы, а вмещающий пакет ссылается на них по `identifierref`.
 */
const AGGREGATE = `<manifest identifier="aggregate" xml:base="package/">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
  <organizations default="org"><organization identifier="org"><title>Программа обучения</title>
    <item identifier="intro" identifierref="r-intro"><title>Вступление</title></item>
  </organization></organizations>
  <resources><resource identifier="r-intro" href="intro.html"><file href="intro.html"/></resource></resources>
  <manifest identifier="module-safety" xml:base="safety/">
    <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
    <organizations default="s-org"><organization identifier="s-org"><title>Охрана труда</title>
      <item identifier="s-1" identifierref="r-safety"><title>Инструктаж</title></item>
    </organization></organizations>
    <resources><resource identifier="r-safety" href="lesson.html"><file href="lesson.html"/></resource></resources>
    <manifest identifier="module-safety-quiz">
      <organizations default="q-org"><organization identifier="q-org"><title>Проверка</title>
        <item identifier="q-1" identifierref="r-quiz"><title>Тест</title></item>
      </organization></organizations>
      <resources><resource identifier="r-quiz" href="quiz.html"/></resources>
    </manifest>
  </manifest>
</manifest>`;

test('подманифест разбирается со своим оглавлением, ресурсами и составом', () => {
  const metadata = parseManifest(AGGREGATE);

  assert.equal(metadata.subManifests.length, 1);
  const module = metadata.subManifests[0];
  assert.equal(module.identifier, 'module-safety');
  assert.equal(module.title, 'Охрана труда');
  assert.equal(module.schemaVersion, '2004 4th Edition');
  assert.deepEqual(
    module.activities.map(activity => activity.title),
    ['Инструктаж'],
  );
  // `xml:base` наследуется по вложенности документа: корневой `package/` плюс свой `safety/`.
  assert.equal(module.activities[0].launch?.entryPoint, 'package/safety/lesson.html');
  assert.deepEqual(module.declaredFiles, ['package/safety/lesson.html']);
});

test('вложенность подманифестов не ограничена одним уровнем', () => {
  const quiz = parseManifest(AGGREGATE).subManifests[0].subManifests[0];

  assert.equal(quiz.identifier, 'module-safety-quiz');
  assert.equal(quiz.activities[0].launch?.entryPoint, 'package/safety/quiz.html');
  assert.deepEqual(quiz.subManifests, []);
});

test('пункты подманифеста не вливаются в оглавление корня', () => {
  const metadata = parseManifest(AGGREGATE);

  // Вписать чужое оглавление в своё значило бы придумать за автора структуру, которой он не
  // объявлял: подманифест — это материал, а не глава программы.
  assert.deepEqual(
    [...walkActivities(metadata.activities)].map(activity => activity.identifier),
    ['intro'],
  );
  assert.equal(metadata.entryPoint, 'package/intro.html', 'запускается организация корня');
});

test('ресурсы подманифеста не считаются осиротевшими', () => {
  // На них ссылается как раз вмещающий пакет, а не собственное оглавление подманифеста, — и
  // предупреждать здесь значило бы завалить находками любой исправный агрегат.
  const described: ValidationIssue[] = [];
  parseManifest(AGGREGATE, 'imsmanifest.xml', described);

  assert.deepEqual(
    described.filter(issue => issue.code === 'scorm.orphaned-resource'),
    [],
  );
});

test('пакет без подманифестов отдаёт пустой список, а не отсутствие поля', () => {
  assert.deepEqual(parseManifest(GOLF_SINGLE_SCO).subManifests, []);
});
