import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ZipEntry } from '../archive/zip.js';
import { ArchiveRejected, DEFAULT_ARCHIVE_LIMITS, planExtraction } from './inspect.js';

function entry(path: string, overrides: Partial<ZipEntry> = {}): ZipEntry {
  const uncompressedSize = overrides.uncompressedSize ?? 1024;
  return {
    path,
    uncompressedSize,
    compressedSize: overrides.compressedSize ?? uncompressedSize,
    isDirectory: overrides.isDirectory ?? path.endsWith('/'),
    isEncrypted: overrides.isEncrypted ?? false,
    lastModified: new Date(0),
  };
}

test('план распаковки собирается из файлов, каталоги в инвентарь не идут', () => {
  const plan = planExtraction([entry('imsmanifest.xml'), entry('shared/'), entry('shared/index.html')]);
  assert.deepEqual(
    plan.files.map(file => file.path),
    ['imsmanifest.xml', 'shared/index.html'],
  );
  assert.equal(plan.root, '');
  assert.equal(plan.descriptorPath, 'imsmanifest.xml');
  assert.equal(plan.totalBytes, 2048);
});

test('внешняя папка вокруг курса отрезается', () => {
  // Самая частая ошибка при заливке: зазиповали папку, а не её содержимое.
  const plan = planExtraction([entry('Мой курс/imsmanifest.xml'), entry('Мой курс/shared/index.html')]);
  assert.equal(plan.root, 'Мой курс/');
  assert.equal(plan.descriptorPath, 'imsmanifest.xml');
  assert.deepEqual(
    plan.files.map(file => file.path),
    ['imsmanifest.xml', 'shared/index.html'],
  );
});

test('файлы вне корня пакета не распаковываются', () => {
  const plan = planExtraction([entry('__MACOSX/._imsmanifest.xml'), entry('course/imsmanifest.xml'), entry('course/index.html')]);
  assert.deepEqual(
    plan.files.map(file => file.path),
    ['imsmanifest.xml', 'index.html'],
  );
});

test('zip-slip отвергает архив целиком, а не пропускает запись', () => {
  assert.throws(() => planExtraction([entry('imsmanifest.xml'), entry('../../etc/passwd')]), /Небезопасный путь/);
  assert.throws(() => planExtraction([entry('imsmanifest.xml'), entry('/etc/passwd')]), ArchiveRejected);
});

test('архив без описания курса не принимается', () => {
  assert.throws(() => planExtraction([entry('index.html')]), /нет описания курса/);
  // Для одиночного файла (kind: 'file') описатель не нужен.
  assert.equal(planExtraction([entry('brochure.pdf')], DEFAULT_ARCHIVE_LIMITS, false).files.length, 1);
});

test('корень пакета определяется по любому описателю, не только по манифесту SCORM', () => {
  // Иначе cmi5- и AICC-пакеты во внешней папке распаковывались бы вместе с ней.
  assert.equal(planExtraction([entry('course/cmi5.xml'), entry('course/au.html')]).root, 'course/');
  assert.equal(planExtraction([entry('pack/SEC.CRS'), entry('pack/start.html')]).root, 'pack/');
});

test('исполняемое и неизвестное в бакет не попадает, но архив не отвергает', () => {
  // Отказ здесь ничего не защищал: файл не попадает в бакет ни так, ни этак, а разница только в
  // том, теряет ли админ загрузку целиком из-за одного `Thumbs.db` от сборщика.
  const plan = planExtraction([entry('imsmanifest.xml'), entry('index.html'), entry('setup.exe'), entry('src/course.psd')]);

  assert.deepEqual(
    plan.files.map(file => file.path),
    ['imsmanifest.xml', 'index.html'],
  );
  assert.deepEqual(plan.skipped, ['setup.exe', 'src/course.psd']);
  // Пропущенное не входит и в объём: платить за то, чего мы не храним, никто не должен.
  assert.equal(plan.totalBytes, 2048);
});

test('схемы рядом с манифестом пакет не ломают', () => {
  // `.dtd` ездит вместе с `.xsd` у шести пакетов корпуса; раньше все шесть отвергались целиком.
  const plan = planExtraction([entry('imsmanifest.xml'), entry('imscp_rootv1p1p2.xsd'), entry('datatypes.dtd')]);

  assert.equal(plan.files.length, 3);
  assert.deepEqual(plan.skipped, []);
});

test('архив из одного мусора всё-таки отвергается, и с перечнем причин', () => {
  assert.throws(
    () => planExtraction([entry('setup.exe'), entry('course.psd')], DEFAULT_ARCHIVE_LIMITS, false),
    /Ни один файл архива не пригоден/,
  );
});

test('зашифрованные записи отвергаются', () => {
  assert.throws(() => planExtraction([entry('imsmanifest.xml'), entry('secret.html', { isEncrypted: true })]), /зашифрована/);
});

test('дубль пути отвергается — путь это ключ инвентаря', () => {
  assert.throws(() => planExtraction([entry('imsmanifest.xml'), entry('a/index.html'), entry('a\\index.html')]), /дважды/);
});

test('лимиты пакета соблюдаются', () => {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, maxFiles: 2, maxTotalBytes: 4096, maxFileBytes: 2048 };
  assert.throws(() => planExtraction([entry('imsmanifest.xml'), entry('a.html'), entry('b.html')], limits), /больше 2 файлов/);
  assert.throws(
    () => planExtraction([entry('imsmanifest.xml'), entry('big.html', { uncompressedSize: 9000 })], limits),
    /больше допустимых 2048/,
  );

  // Каждый файл по отдельности в лимит проходит — не пропускает именно сумма.
  const many = [entry('imsmanifest.xml'), entry('a.html', { uncompressedSize: 2000 }), entry('b.html', { uncompressedSize: 2000 })];
  assert.throws(() => planExtraction(many, { ...limits, maxFiles: 10 }), /Распакованный пакет больше/);
});

test('zip-бомба ловится по коэффициенту сжатия', () => {
  const bomb = entry('bomb.html', { uncompressedSize: 500 * 1024 * 1024, compressedSize: 40 * 1024 });
  assert.throws(() => planExtraction([entry('imsmanifest.xml'), bomb]), /zip-бомбу/);
});

test('мелкие файлы под проверку сжатия не попадают', () => {
  // У файла в сотню байт отношение скачет из-за служебных заголовков, а вреда от него нет.
  const tiny = entry('tiny.html', { uncompressedSize: 100, compressedSize: 1 });
  assert.equal(planExtraction([entry('imsmanifest.xml'), tiny]).files.length, 2);
});

test('пустой архив и архив из одних каталогов отвергаются', () => {
  assert.throws(() => planExtraction([]), ArchiveRejected);
  assert.throws(() => planExtraction([entry('empty/')], DEFAULT_ARCHIVE_LIMITS, false), /ни одного пригодного файла/);
});
