import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bufferSource, ZipArchive } from '../archive/zip.js';
import { parsePackage } from '../formats/detect.js';
import { zipSource } from '../formats/source.js';
import { makeZip } from '../testing/zip-fixture.js';

/**
 * Свойства метаданных, которые не принадлежат ни одному формату: объём пакета, вторые формы и
 * пригодность модели к сериализации.
 */

const SCORM = `<manifest identifier="course">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org"><organization identifier="org"><title>Курс</title>
    <item identifier="i" identifierref="r"><title>Урок</title></item></organization></organizations>
  <resources><resource identifier="r" href="index.html"><file href="index.html"/></resource></resources>
</manifest>`;

const TINCAN = `<tincan><activities><activity id="same-course" type="http://adlnet.gov/expapi/activities/course">
  <name>Тот же курс</name><launch>index.html</launch></activity></activities></tincan>`;

const CMI5 = `<courseStructure><course id="same-course"><title><langstring>Курс</langstring></title></course>
  <au id="au"><url>index.html</url></au></courseStructure>`;

const CMI5_WITH_CONTEXT = `<courseStructure><course id="ctx">
  <title><langstring lang="ru">Курс</langstring><langstring lang="en">Course</langstring></title>
  <contextTemplate><extensions><extension id="http://example.com/ext">значение</extension></extensions></contextTemplate>
</course>
  <au id="au"><title><langstring lang="ru">Единица</langstring></title><url>index.html</url></au></courseStructure>`;

async function parseZip(files: Record<string, string>) {
  const archive = await ZipArchive.open(bufferSource(makeZip(Object.entries(files).map(([path, content]) => ({ path, content })))));
  try {
    return await parsePackage(zipSource(archive));
  } finally {
    await archive.close();
  }
}

test('объём пакета считается по источнику, а не по описателю', async () => {
  const { metadata } = await parseZip({ 'imsmanifest.xml': SCORM, 'index.html': '<html>Курс</html>' });

  assert.equal(metadata.fileCount, 2);
  // Описатель объявляет один файл, а в пакете их два — это разные числа, и путать их не надо.
  assert.equal(metadata.declaredFiles.length, 1);
  assert.ok((metadata.totalBytes ?? 0) > 0);
});

test('источник без размеров даёт null, а не ноль', async () => {
  // `parseManifest` вызывают и напрямую, на одной строке. Ноль там означал бы «пакет пуст».
  const { metadata } = await parsePackage({
    paths: ['imsmanifest.xml'],
    async readBytes() {
      return Buffer.from(SCORM, 'utf8');
    },
  });

  assert.equal(metadata.fileCount, 1);
  assert.equal(metadata.totalBytes, null);
});

test('вторые формы пакета видны потребителю', async () => {
  // Articulate публикует курс сразу в двух формах, складывая описатели рядом.
  const { metadata } = await parseZip({
    'imsmanifest.xml': SCORM,
    'tincan.xml': TINCAN,
    'cmi5.xml': CMI5,
    'index.html': '<html>Курс</html>',
  });

  assert.equal(metadata.format, 'scorm12');
  assert.deepEqual(metadata.alsoDetected, ['cmi5', 'xapi']);
});

test('пакет одного формата не сообщает о вторых формах', async () => {
  const { metadata } = await parseZip({ 'imsmanifest.xml': SCORM, 'index.html': '<html>Курс</html>' });
  assert.deepEqual(metadata.alsoDetected, []);
});

test('модель переживает JSON round-trip', async () => {
  // Свойство «модель — простые данные» держится на том, что в ней нет ни `Map`, ни `Set`, ни `Date`,
  // ни классов. Ничем, кроме этого теста, оно не закреплено: заведи кто-нибудь `Map` под словарь —
  // и round-trip сломается молча, отдав `{}` вместо содержимого.
  const { metadata, report } = await parseZip({
    'imsmanifest.xml': SCORM,
    'tincan.xml': TINCAN,
    'index.html': '<html>Курс</html>',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(metadata)), metadata);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);

  // Отдельно — формат со словарями: подписи по языкам, расширения и заготовка контекста. Именно
  // сюда просится `Map`, и именно `Map` сериализовалась бы в `{}` молча.
  const cmi5 = await parseZip({ 'cmi5.xml': CMI5_WITH_CONTEXT, 'index.html': '<html>Курс</html>' });
  assert.deepEqual(JSON.parse(JSON.stringify(cmi5.metadata)), cmi5.metadata);
});
