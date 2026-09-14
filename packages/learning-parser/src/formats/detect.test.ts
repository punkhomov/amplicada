import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PackageParseError } from '../errors.js';
import { encodeWindows1251 as windows1251 } from '../testing/encodings.js';
import { isDescriptorName } from './descriptors.js';
import { type PackageSource, parsePackage } from './detect.js';

const SCORM = `<manifest identifier="scorm-course">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org"><organization identifier="org"><title>SCORM</title>
    <item identifier="i" identifierref="r"/></organization></organizations>
  <resources><resource identifier="r" href="index.html"/></resources>
</manifest>`;

const TINCAN = `<tincan><activities><activity id="xapi-course">
  <name>xAPI</name><launch>story.html</launch></activity></activities></tincan>`;

const CMI5 = `<courseStructure><course id="cmi5-course"><title>cmi5</title></course>
  <au id="au"><url>au.html</url></au></courseStructure>`;

const CRS = '[Course]\nCourse_ID=AICC-1\nCourse_Title=AICC\n';
const AU = '"System_ID","File_Name"\n"A1","start.html"\n';

function source(files: Record<string, string | Uint8Array>): PackageSource {
  return {
    paths: Object.keys(files),
    async readBytes(path) {
      const content = files[path];
      if (content === undefined) throw new Error(`нет файла ${path}`);
      return typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    },
  };
}

test('каждый формат опознаётся по своему описателю', async () => {
  assert.equal((await parsePackage(source({ 'imsmanifest.xml': SCORM }))).metadata.format, 'scorm12');
  assert.equal((await parsePackage(source({ 'cmi5.xml': CMI5 }))).metadata.format, 'cmi5');
  assert.equal((await parsePackage(source({ 'tincan.xml': TINCAN }))).metadata.format, 'xapi');
  assert.equal((await parsePackage(source({ 'course.crs': CRS, 'course.au': AU }))).metadata.format, 'aicc');
});

test('когда описателей несколько, выигрывает то, что мы умеем проигрывать', async () => {
  // Articulate и подобные сборщики публикуют курс сразу в двух форматах, кладя файлы рядом.
  const dual = source({ 'imsmanifest.xml': SCORM, 'tincan.xml': TINCAN });
  const { metadata } = await parsePackage(dual);
  assert.equal(metadata.format, 'scorm12');
  assert.equal(metadata.identifier, 'scorm-course');
});

test('описатель находится в подпапке — курс, зазипованный вместе с внешней папкой', async () => {
  const { metadata } = await parsePackage(source({ 'Мой курс/imsmanifest.xml': SCORM, 'Мой курс/index.html': '' }));
  assert.equal(metadata.descriptorPath, 'Мой курс/imsmanifest.xml');
  assert.equal(metadata.format, 'scorm12');
});

test('регистр имени описателя не важен', async () => {
  assert.equal((await parsePackage(source({ 'IMSManifest.xml': SCORM }))).metadata.format, 'scorm12');
  assert.equal((await parsePackage(source({ 'TinCan.xml': TINCAN }))).metadata.format, 'xapi');
});

test('.crs без секции [Course] не делает пакет AICC', async () => {
  // Расширение занимают и посторонние файлы; без содержимого это была бы ложная тревога.
  await assert.rejects(() => parsePackage(source({ 'notes.crs': 'просто заметки' })), /Формат пакета не распознан/);
});

test('AICC собирается из файлов-спутников по общему имени', async () => {
  const { metadata } = await parsePackage(source({ 'SEC.CRS': CRS, 'SEC.AU': AU, 'SEC.DES': '"System_ID","Title"\n"A1","Блок"\n' }));
  assert.equal(metadata.format, 'aicc');
  assert.equal(metadata.entryPoint, 'start.html');
});

test('изъяны копятся в отчёт, а не обрывают разбор на первом', async () => {
  // Ровно ради этого фаза и делалась: раньше админ узнавал про них по одному за перезаливку.
  const broken = `<manifest>
    <organizations default="нет такой"><organization identifier="org">
      <item identifier="a" identifierref="в-никуда"/>
      <item identifier="b" identifierref="r"/>
    </organization></organizations>
    <resources>
      <resource identifier="r" href="start.html"><file href="missing.js"/></resource>
      <resource identifier="orphan" href="unused.html"/>
    </resources>
  </manifest>`;
  const { metadata, report } = await parsePackage(source({ 'imsmanifest.xml': broken, 'start.html': '' }));

  assert.equal(metadata.entryPoint, 'start.html', 'разбор довёл дело до конца');
  assert.deepEqual(report.issues.map(issue => issue.code).sort(), [
    'common.file-missing',
    'common.title-missing',
    'scorm.default-organization-invalid',
    'scorm.manifest-identifier-missing',
    'scorm.orphaned-resource',
    'scorm.resource-ref-dangling',
  ]);
  assert.equal(report.ok, false, 'отсутствующий файл — ошибка');
  assert.deepEqual(
    report.errors.map(issue => issue.code),
    ['common.file-missing'],
  );
});

test('исправный пакет не собирает ни одной находки', async () => {
  // Важнее предыдущего: правило, ругающееся на всё подряд, выключат целиком.
  const clean = `<manifest identifier="ok">
    <organizations default="org"><organization identifier="org"><title>Курс</title>
      <item identifier="i" identifierref="r"/></organization></organizations>
    <resources><resource identifier="r" href="index.html"><file href="index.html"/></resource></resources>
  </manifest>`;
  const { report } = await parsePackage(source({ 'imsmanifest.xml': clean, 'index.html': '' }));
  assert.deepEqual(report.issues, []);
  assert.equal(report.ok, true);
});

test('пакет только с предупреждениями остаётся пригодным', async () => {
  const noIdentifier = `<manifest>
    <organizations default="org"><organization identifier="org"><title>Курс</title>
      <item identifier="i" identifierref="r"/></organization></organizations>
    <resources><resource identifier="r" href="index.html"/></resources>
  </manifest>`;
  const { report } = await parsePackage(source({ 'imsmanifest.xml': noIdentifier, 'index.html': '' }));

  assert.deepEqual(
    report.warnings.map(issue => issue.code),
    ['scorm.manifest-identifier-missing'],
    'манифест без identifier — повод сказать, но не повод отказать',
  );
  assert.equal(report.ok, true, 'предупреждения не делают пакет непригодным');
});

test('нечего запускать — это находка, а не исключение', async () => {
  // Раньше здесь был throw, и потребитель не мог решить сам: метаданных не было вовсе.
  const empty = '<manifest identifier="x"><organizations/><resources/></manifest>';
  const { metadata, report } = await parsePackage(source({ 'imsmanifest.xml': empty }));

  assert.equal(metadata.format, 'scorm12', 'формат опознан, метаданные есть');
  assert.equal(metadata.entryPoint, null);
  assert.equal(report.ok, false);
  assert.equal(
    report.errors.some(issue => issue.code === 'common.no-launchable'),
    true,
  );
});

test('описатель в windows-1251 читается, и о догадке сказано вслух', async () => {
  // Отечественные сборщики курсов пишут 1251 до сих пор. Раньше название приезжало чередой U+FFFD
  // и выглядело ошибкой автора пакета, а не ошибкой разбора.
  const manifest = `<manifest identifier="ohrana">
    <organizations default="org"><organization identifier="org"><title>Охрана труда</title>
      <item identifier="i" identifierref="r"/></organization></organizations>
    <resources><resource identifier="r" href="index.html"/></resources>
  </manifest>`;
  const { metadata, report } = await parsePackage(source({ 'imsmanifest.xml': windows1251(manifest), 'index.html': '' }));

  assert.equal(metadata.title, 'Охрана труда');
  assert.deepEqual(
    report.warnings.map(issue => issue.code),
    ['common.encoding-guessed'],
  );
  assert.equal(report.ok, true, 'догадка о кодировке — не повод отказать');
});

test('.crs в windows-1251 читается так же — там декларации нет вовсе', async () => {
  const crs = windows1251('[Course]\nCourse_ID=AICC-1\nCourse_Title=Охрана труда\n');
  const { metadata, report } = await parsePackage(source({ 'course.crs': crs, 'course.au': AU, 'start.html': '' }));

  assert.equal(metadata.title, 'Охрана труда');
  assert.equal(
    report.warnings.some(issue => issue.code === 'common.encoding-guessed'),
    true,
  );
});

test('описатель, объявивший кодировку, обходится без предупреждения', async () => {
  const declared = windows1251(`<?xml version="1.0" encoding="windows-1251"?>
  <manifest identifier="ok">
    <organizations default="org"><organization identifier="org"><title>Охрана труда</title>
      <item identifier="i" identifierref="r"/></organization></organizations>
    <resources><resource identifier="r" href="index.html"/></resources>
  </manifest>`);
  const { metadata, report } = await parsePackage(source({ 'imsmanifest.xml': declared, 'index.html': '' }));

  assert.equal(metadata.title, 'Охрана труда');
  assert.deepEqual(report.issues, [], 'кодировка объявлена — догадываться не о чем');
});

test('архив без единого описателя — понятный отказ, а не молчаливый успех', async () => {
  await assert.rejects(() => parsePackage(source({ 'index.html': '<html/>', 'style.css': '' })), PackageParseError);
});

test('isDescriptorName знает все четыре описателя и не знает лишнего', () => {
  for (const name of ['imsmanifest.xml', 'IMSManifest.xml', 'cmi5.xml', 'tincan.xml', 'course.crs', 'SEC.CRS']) {
    assert.equal(isDescriptorName(name), true, name);
  }
  for (const name of ['index.html', 'manifest.json', 'imsmanifest.xml.bak', 'course.crs.txt']) {
    assert.equal(isDescriptorName(name), false, name);
  }
});

test('метаданные из отдельного файла подхватываются вторым проходом', async () => {
  const manifest = `<manifest identifier="c">
  <metadata><schemaversion>2004 4th Edition</schemaversion><location>meta/course.xml</location></metadata>
  <organizations default="o"><organization identifier="o"><item identifier="i" identifierref="r"/></organization></organizations>
  <resources><resource identifier="r" href="index.html"/></resources>
</manifest>`;
  const lom = `<lom><general><title><string language="ru">Из внешнего файла</string></title></general></lom>`;

  const { metadata, report } = await parsePackage(source({ 'imsmanifest.xml': manifest, 'index.html': '', 'meta/course.xml': lom }));
  assert.equal(metadata.lom?.general?.title?.ru, 'Из внешнего файла');
  assert.equal(metadata.title, 'Из внешнего файла', 'название курса берётся оттуда же');
  assert.deepEqual(
    report.issues.filter(issue => issue.code === 'common.external-metadata-missing'),
    [],
  );
});

test('ссылка на отсутствующий файл метаданных — находка, а не исключение', async () => {
  const manifest = `<manifest identifier="c">
  <metadata><schemaversion>1.2</schemaversion><location>meta/course.xml</location></metadata>
  <organizations default="o"><organization identifier="o"><title>Курс</title><item identifier="i" identifierref="r"/></organization></organizations>
  <resources><resource identifier="r" href="index.html"/></resources>
</manifest>`;

  const { metadata, report } = await parsePackage(source({ 'imsmanifest.xml': manifest, 'index.html': '' }));
  assert.equal(metadata.lom, null);
  assert.equal(report.ok, true, 'метаданные необязательны — курс проигрывается и без них');
  assert.equal(report.warnings.filter(issue => issue.code === 'common.external-metadata-missing').length, 1);
});
