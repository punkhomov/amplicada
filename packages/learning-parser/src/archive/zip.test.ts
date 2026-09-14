import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { makeZip } from '../testing/zip-fixture.js';
import { bufferSource, type RandomAccessSource, ZipArchive, ZipError } from './zip.js';

const SIMPLE = makeZip([
  { path: 'imsmanifest.xml', content: '<manifest/>' },
  { path: 'shared/', content: '' },
  { path: 'shared/launchpage.html', content: '<html>Курс</html>' },
]);

test('инвентарь читается из central directory при открытии', async () => {
  const archive = await ZipArchive.open(bufferSource(SIMPLE));
  try {
    const paths = archive.entries().map(entry => entry.path);
    assert.deepEqual(paths, ['imsmanifest.xml', 'shared/', 'shared/launchpage.html']);
    assert.equal(archive.entries().find(entry => entry.path === 'shared/')?.isDirectory, true);
    assert.equal(archive.entries().find(entry => entry.path === 'imsmanifest.xml')?.isDirectory, false);
  } finally {
    await archive.close();
  }
});

test('содержимое распаковывается, включая юникод', async () => {
  const archive = await ZipArchive.open(bufferSource(SIMPLE));
  try {
    const entry = archive.entries().find(item => item.path === 'shared/launchpage.html');
    assert.ok(entry);
    const content = await archive.readFile(entry, 1024);
    assert.equal(content.toString('utf8'), '<html>Курс</html>');
  } finally {
    await archive.close();
  }
});

test('поток записи читается чанками, а не побайтово', async () => {
  // `Readable.from(buffer)` отдал бы поток чисел — тогда собранный Buffer оказался бы мусором.
  const archive = await ZipArchive.open(bufferSource(SIMPLE));
  try {
    const entry = archive.entries().find(item => item.path === 'shared/launchpage.html');
    assert.ok(entry);
    const stream = await archive.openStream(entry);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    assert.ok(chunks.every(Buffer.isBuffer));
    assert.equal(Buffer.concat(chunks).toString('utf8'), '<html>Курс</html>');
  } finally {
    await archive.close();
  }
});

test('архив читается диапазонами, а не целиком', async () => {
  // Смысл всей затеи: пакет с видео не должен оказываться в памяти процесса.
  const zip = makeZip([{ path: 'big.txt', content: 'x'.repeat(200_000), method: 'store' }]);
  let bytesRead = 0;
  const counting: RandomAccessSource = {
    size: zip.length,
    read(start, end) {
      bytesRead += end - start;
      return Readable.from([zip.subarray(start, end)]);
    },
  };

  const archive = await ZipArchive.open(counting);
  try {
    assert.ok(bytesRead < zip.length / 2, `на открытие ушло ${bytesRead} из ${zip.length} байт`);
  } finally {
    await archive.close();
  }
});

test('соврать про размер не выйдет — расхождение обрывает чтение ошибкой', async () => {
  const zip = makeZip([{ path: 'lie.txt', content: 'x'.repeat(10_000), declaredSize: 10 }]);
  const archive = await ZipArchive.open(bufferSource(zip));
  try {
    const entry = archive.entries()[0];
    await assert.rejects(async () => {
      const stream = await archive.openStream(entry);
      for await (const _chunk of stream) {
        // дочитываем до конца — расхождение видно только там
      }
    });
  } finally {
    await archive.close();
  }
});

test('readFile не даёт вычитать больше разрешённого', async () => {
  const archive = await ZipArchive.open(bufferSource(SIMPLE));
  try {
    const entry = archive.entries().find(item => item.path === 'shared/launchpage.html');
    assert.ok(entry);
    await assert.rejects(() => archive.readFile(entry, 4), ZipError);
  } finally {
    await archive.close();
  }
});

test('запись с выходом за корень не проходит уже на чтении оглавления', async () => {
  // yauzl проверяет имена записей сам, до нашей нормализации. Проверка здесь — чтобы знать, что
  // этот слой действительно работает, а `planExtraction` остаётся вторым рубежом, а не единственным.
  const zip = makeZip([{ path: '../evil.html', content: '<html/>' }]);
  await assert.rejects(() => ZipArchive.open(bufferSource(zip)), ZipError);
});

test('не-ZIP и пустой файл отвергаются с понятной ошибкой', async () => {
  await assert.rejects(() => ZipArchive.open(bufferSource(Buffer.from('это не архив'))), ZipError);
  await assert.rejects(() => ZipArchive.open(bufferSource(Buffer.alloc(0))), ZipError);
});
