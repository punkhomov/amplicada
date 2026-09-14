import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ValidationIssue } from '../../issue.js';
import { langText } from '../../model/lom.js';
import { checkPackage } from '../../validation/package-rules.js';
import { parseLomDocument } from './lom.js';
import { parseManifest } from './manifest.js';

/** SCORM 2004: LOM 1.0 — `<string language="ru">`, словарные значения простым текстом. */
const LOM_2004 = `<?xml version="1.0"?>
<manifest identifier="course" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:lom="http://ltsc.ieee.org/xsd/LOM">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
    <lom:lom>
      <lom:general>
        <lom:identifier><lom:catalog>ISBN</lom:catalog><lom:entry>978-5-00</lom:entry></lom:identifier>
        <lom:title>
          <lom:string language="ru">Охрана труда</lom:string>
          <lom:string language="en">Occupational safety</lom:string>
        </lom:title>
        <lom:language>ru</lom:language>
        <lom:description><lom:string language="ru">Вводный курс</lom:string></lom:description>
        <lom:keyword><lom:string language="ru">охрана</lom:string></lom:keyword>
        <lom:keyword><lom:string language="ru">инструктаж</lom:string></lom:keyword>
        <lom:structure><lom:source>LOMv1.0</lom:source><lom:value>hierarchical</lom:value></lom:structure>
      </lom:general>
      <lom:lifeCycle>
        <lom:version><lom:string language="ru">2.0</lom:string></lom:version>
        <lom:status><lom:source>LOMv1.0</lom:source><lom:value>final</lom:value></lom:status>
        <lom:contribute>
          <lom:role><lom:source>LOMv1.0</lom:source><lom:value>author</lom:value></lom:role>
          <lom:entity>BEGIN:VCARD FN:Иванов END:VCARD</lom:entity>
          <lom:date><lom:dateTime>2026-08-09</lom:dateTime></lom:date>
        </lom:contribute>
      </lom:lifeCycle>
      <lom:technical>
        <lom:format>text/html</lom:format>
        <lom:size>1048576</lom:size>
        <lom:location>index.html</lom:location>
        <lom:requirement>
          <lom:orComposite>
            <lom:type><lom:value>browser</lom:value></lom:type>
            <lom:name><lom:value>any</lom:value></lom:name>
            <lom:minimumVersion>5.0</lom:minimumVersion>
          </lom:orComposite>
        </lom:requirement>
        <lom:duration><lom:duration>PT30M</lom:duration></lom:duration>
      </lom:technical>
      <lom:educational>
        <lom:interactivityType><lom:value>active</lom:value></lom:interactivityType>
        <lom:learningResourceType><lom:value>exercise</lom:value></lom:learningResourceType>
        <lom:learningResourceType><lom:value>simulation</lom:value></lom:learningResourceType>
        <lom:difficulty><lom:value>easy</lom:value></lom:difficulty>
        <lom:typicalLearningTime><lom:duration>PT40M</lom:duration></lom:typicalLearningTime>
      </lom:educational>
      <lom:rights>
        <lom:cost><lom:value>no</lom:value></lom:cost>
        <lom:copyrightAndOtherRestrictions><lom:value>yes</lom:value></lom:copyrightAndOtherRestrictions>
      </lom:rights>
      <lom:classification>
        <lom:purpose><lom:value>discipline</lom:value></lom:purpose>
        <lom:taxonPath>
          <lom:source><lom:string language="ru">ОКСО</lom:string></lom:source>
          <lom:taxon><lom:id>20.03.01</lom:id><lom:entry><lom:string language="ru">Техносферная безопасность</lom:string></lom:entry></lom:taxon>
        </lom:taxonPath>
      </lom:classification>
    </lom:lom>
  </metadata>
  <organizations/>
  <resources><resource identifier="r1" adlcp:scormType="sco" href="index.html"/></resources>
</manifest>`;

/** SCORM 1.2: профиль IMS Metadata 1.2 — `<langstring xml:lang="ru">`, словари в langstring. */
const LOM_12 = `<?xml version="1.0"?>
<manifest identifier="course" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_rootv1p2p1">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
    <imsmd:lom>
      <imsmd:general>
        <imsmd:identifier>COURSE-1</imsmd:identifier>
        <imsmd:title><imsmd:langstring xml:lang="ru">Охрана труда</imsmd:langstring></imsmd:title>
        <imsmd:description><imsmd:langstring xml:lang="ru">Вводный курс</imsmd:langstring></imsmd:description>
        <imsmd:keyword><imsmd:langstring xml:lang="ru">охрана</imsmd:langstring></imsmd:keyword>
      </imsmd:general>
      <imsmd:educational>
        <imsmd:difficulty>
          <imsmd:source><imsmd:langstring>LOMv1.0</imsmd:langstring></imsmd:source>
          <imsmd:value><imsmd:langstring>easy</imsmd:langstring></imsmd:value>
        </imsmd:difficulty>
        <imsmd:typicallearningtime><imsmd:datetime>PT40M</imsmd:datetime></imsmd:typicallearningtime>
      </imsmd:educational>
    </imsmd:lom>
  </metadata>
  <organizations/>
  <resources><resource identifier="r1" adlcp:scormtype="sco" href="index.html"/></resources>
</manifest>`;

test('LOM 1.0 разбирается целиком', () => {
  const lom = parseManifest(LOM_2004, 'imsmanifest.xml').lom;
  assert.ok(lom);

  assert.deepEqual(lom.general?.identifiers, [{ catalog: 'ISBN', entry: '978-5-00' }]);
  assert.deepEqual(lom.general?.languages, ['ru']);
  assert.deepEqual(lom.general?.keywords, [{ ru: 'охрана' }, { ru: 'инструктаж' }]);
  assert.equal(lom.general?.structure, 'hierarchical');

  assert.equal(lom.lifeCycle?.status, 'final');
  assert.equal(lom.lifeCycle?.contributions[0].role, 'author');
  assert.deepEqual(lom.lifeCycle?.contributions[0].entities, ['BEGIN:VCARD FN:Иванов END:VCARD']);
  assert.equal(lom.lifeCycle?.contributions[0].date, '2026-08-09');

  assert.deepEqual(lom.technical?.formats, ['text/html']);
  assert.equal(lom.technical?.size, 1_048_576);
  assert.equal(lom.technical?.durationSeconds, 1800);
  assert.deepEqual(lom.technical?.requirements, [[{ type: 'browser', name: 'any', minimumVersion: '5.0', maximumVersion: null }]]);

  assert.equal(lom.educational[0].difficulty, 'easy');
  assert.deepEqual(lom.educational[0].learningResourceTypes, ['exercise', 'simulation']);
  assert.equal(lom.rights?.cost, 'no');
  assert.equal(lom.classifications[0].taxonPaths[0].taxons[0].id, '20.03.01');
});

test('все языки названия сохраняются, а не только первый', () => {
  const lom = parseManifest(LOM_2004, 'imsmanifest.xml').lom;
  assert.deepEqual(lom?.general?.title, { ru: 'Охрана труда', en: 'Occupational safety' });
});

test('язык выбирается с фолбэком на региональный вариант и на первый объявленный', () => {
  const title = { ru: 'Курс', 'en-GB': 'Course' };
  assert.equal(langText(title, 'en'), 'Course', 'en подходит к en-GB');
  assert.equal(langText(title, 'ru'), 'Курс');
  assert.equal(langText(title, 'de'), 'Курс', 'ничего не подошло — первый объявленный');
  assert.equal(langText(null, 'ru'), null);
});

test('профиль IMS 1.2 даёт тот же результат, что LOM 1.0', () => {
  const lom = parseManifest(LOM_12, 'imsmanifest.xml').lom;
  assert.ok(lom);
  assert.deepEqual(lom.general?.title, { ru: 'Охрана труда' });
  assert.deepEqual(lom.general?.identifiers, [{ catalog: null, entry: 'COURSE-1' }], 'строковый identifier не теряется');
  assert.equal(lom.educational[0].difficulty, 'easy', 'словарное значение внутри langstring');
  assert.equal(lom.educational[0].typicalLearningTimeSeconds, 2400, 'datetime вместо duration');
});

test('название организации важнее LOM, но при её отсутствии берётся из LOM', () => {
  const metadata = parseManifest(LOM_2004, 'imsmanifest.xml');
  assert.equal(metadata.title, 'Охрана труда', 'организаций нет — название из LOM');
  assert.equal(metadata.description, 'Вводный курс');

  const withOrganization = LOM_2004.replace(
    '<organizations/>',
    '<organizations default="org"><organization identifier="org"><title>Из оглавления</title></organization></organizations>',
  );
  assert.equal(parseManifest(withOrganization, 'imsmanifest.xml').title, 'Из оглавления');
});

test('пакет без LOM разбирается как раньше', () => {
  const bare = LOM_2004.replace(/<lom:lom>[\s\S]*<\/lom:lom>/, '');
  const metadata = parseManifest(bare, 'imsmanifest.xml');
  assert.equal(metadata.lom, null);
  assert.equal(metadata.entryPoint, 'index.html');
});

test('внешние метаданные находятся на манифесте, ресурсе и пункте', () => {
  const xml = `<?xml version="1.0"?>
<manifest identifier="course" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
  <metadata><schemaversion>2004 3rd Edition</schemaversion><adlcp:location>meta/course.xml</adlcp:location></metadata>
  <organizations default="org">
    <organization identifier="org">
      <item identifier="lesson" identifierref="r1">
        <title>Урок</title>
        <metadata><adlcp:location>meta/lesson.xml</adlcp:location></metadata>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="r1" adlcp:scormType="sco" href="index.html">
      <metadata><adlcp:location>meta/resource.xml</adlcp:location></metadata>
    </resource>
  </resources>
</manifest>`;
  const metadata = parseManifest(xml, 'imsmanifest.xml');

  assert.deepEqual(metadata.externalMetadata, [
    { path: 'meta/course.xml', scope: 'package', owner: null },
    { path: 'meta/resource.xml', scope: 'resource', owner: 'r1' },
    { path: 'meta/lesson.xml', scope: 'item', owner: 'lesson' },
  ]);

  const issues = checkPackage(metadata, ['imsmanifest.xml', 'index.html', 'meta/course.xml']);
  const missing = issues.filter(issue => issue.code === 'common.external-metadata-missing');
  assert.equal(missing.length, 2, 'объявленный и лежащий в архиве файл находкой не считается');
  assert.equal(missing[0].location, 'imsmanifest.xml#r1', 'место названо — чьи это метаданные');
});

test('LOM отдельным файлом разбирается тем же кодом', () => {
  const document = `<?xml version="1.0"?>
<lom xmlns="http://ltsc.ieee.org/xsd/LOM">
  <general><title><string language="ru">Из внешнего файла</string></title></general>
</lom>`;
  assert.deepEqual(parseLomDocument(document, 'meta/course.xml')?.general?.title, { ru: 'Из внешнего файла' });
});

test('чужой корень внешнего файла даёт null, а не исключение', () => {
  const issues: ValidationIssue[] = [];
  assert.equal(parseLomDocument('<?xml version="1.0"?><notes><note/></notes>', 'meta/course.xml', issues), null);
});
