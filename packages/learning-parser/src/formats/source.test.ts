import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileSource } from '../archive/file-source.js';
import { bufferSource, ZipArchive } from '../archive/zip.js';
import { makeZip } from '../testing/zip-fixture.js';
import { parsePackage } from './detect.js';
import { directorySource, zipSource } from './source.js';

const MANIFEST = `<manifest identifier="course">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org"><organization identifier="org"><title>Курс</title>
    <item identifier="i" identifierref="r"/></organization></organizations>
  <resources><resource identifier="r" href="index.html"/></resources>
</manifest>`;

/** Пакет, зазипованный вместе с внешней папкой, — так делает половина заливок. */
const FILES: Record<string, string> = {
  'wrapper/imsmanifest.xml': MANIFEST,
  'wrapper/index.html': '<html>Курс</html>',
  'wrapper/shared/player.js': 'console.log(1)',
};

function zipOf(files: Record<string, string> = FILES): Buffer {
  return makeZip(Object.entries(files).map(([path, content]) => ({ path, content })));
}

async function withArchive<T>(buffer: Buffer, body: (archive: ZipArchive) => Promise<T>): Promise<T> {
  const archive = await ZipArchive.open(bufferSource(buffer));
  try {
    return await body(archive);
  } finally {
    await archive.close();
  }
}

async function withDirectory<T>(files: Record<string, string>, body: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'learning-parser-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      const segments = path.split('/');
      if (segments.length > 1) await mkdir(join(root, ...segments.slice(0, -1)), { recursive: true });
      await writeFile(join(root, ...segments), content, 'utf8');
    }
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('zipSource отдаёт пути пакета: нормализованные и без внешней папки', async () => {
  await withArchive(zipOf(), async archive => {
    const source = zipSource(archive);
    assert.deepEqual([...source.paths].sort(), ['imsmanifest.xml', 'index.html', 'shared/player.js']);
  });
});

test('zipSource читает байты по пути из paths', async () => {
  await withArchive(zipOf(), async archive => {
    const source = zipSource(archive);
    const bytes = await source.readBytes('index.html');
    assert.equal(Buffer.from(bytes).toString('utf8'), '<html>Курс</html>');
  });
});

test('zipSource на файл вне пакета отвечает отказом, а не пустотой', async () => {
  await withArchive(zipOf(), async archive => {
    const source = zipSource(archive);
    await assert.rejects(() => source.readBytes('wrapper/index.html'), /нет в архиве/);
  });
});

test('include сужает набор путей', async () => {
  await withArchive(zipOf(), async archive => {
    const source = zipSource(archive, { include: ['imsmanifest.xml', 'index.html'] });
    assert.deepEqual([...source.paths].sort(), ['imsmanifest.xml', 'index.html']);
    // Отсечённый файл не просто не виден в списке — его нельзя и прочитать.
    await assert.rejects(() => source.readBytes('shared/player.js'), /нет в архиве/);
  });
});

test('maxBytes ограничивает чтение', async () => {
  await withArchive(zipOf(), async archive => {
    const source = zipSource(archive, { maxBytes: 4 });
    await assert.rejects(() => source.readBytes('imsmanifest.xml'), /байт/);
  });
});

test('каталоги в paths не попадают', async () => {
  const buffer = makeZip([
    { path: 'imsmanifest.xml', content: MANIFEST },
    { path: 'shared/', content: '' },
    { path: 'shared/player.js', content: 'x' },
  ]);
  await withArchive(buffer, async archive => {
    assert.deepEqual([...zipSource(archive).paths].sort(), ['imsmanifest.xml', 'shared/player.js']);
  });
});

test('пакет разбирается через zipSource целиком', async () => {
  await withArchive(zipOf(), async archive => {
    const { metadata, report } = await parsePackage(zipSource(archive));
    assert.equal(metadata.format, 'scorm12');
    assert.equal(metadata.title, 'Курс');
    assert.equal(metadata.entryPoint, 'index.html');
    assert.equal(report.ok, true);
  });
});

test('directorySource даёт те же пути, что zipSource на том же пакете', async () => {
  const fromZip = await withArchive(zipOf(), async archive => [...zipSource(archive).paths].sort());
  const fromDisk = await withDirectory(FILES, async root => [...(await directorySource(root)).paths].sort());
  assert.deepEqual(fromDisk, fromZip);
});

test('пакет с диска разбирается так же, как из архива', async () => {
  await withDirectory(FILES, async root => {
    const { metadata, report } = await parsePackage(await directorySource(root));
    assert.equal(metadata.format, 'scorm12');
    assert.equal(metadata.title, 'Курс');
    assert.equal(metadata.entryPoint, 'index.html');
    assert.equal(report.ok, true);
  });
});

test('симлинк не попадает в пакет', async () => {
  // Ссылка наружу каталога — тот же выход за корень, что `../` в имени записи ZIP.
  await withDirectory({ 'imsmanifest.xml': MANIFEST, 'index.html': 'x' }, async root => {
    try {
      await symlink(tmpdir(), join(root, 'escape'), 'dir');
    } catch {
      return; // на Windows без прав на симлинки проверять нечего
    }
    const source = await directorySource(root);
    assert.deepEqual([...source.paths].sort(), ['imsmanifest.xml', 'index.html']);
  });
});

test('fileSource читает диапазоны и переживает повторный close', async () => {
  await withDirectory({ 'course.bin': 'abcdefghij' }, async root => {
    const source = await fileSource(join(root, 'course.bin'));
    try {
      assert.equal(source.size, 10);
      assert.equal(await collect(source.read(0, 3)), 'abc');
      // Второе чтение после того, как первый поток закончился: диапазоны независимы друг от друга.
      assert.equal(await collect(source.read(4, 10)), 'efghij');
    } finally {
      await source.close();
      await source.close();
    }
  });
});

test('порванный поток не ломает следующие чтения', async () => {
  // Ровно то, обо что спотыкается общий дескриптор: yauzl читает диапазон и рвёт поток, а Node
  // закрывает fd при `destroy()` вопреки `autoClose: false`. Отсюда fd на диапазон.
  await withDirectory({ 'course.bin': 'abcdefghij' }, async root => {
    const source = await fileSource(join(root, 'course.bin'));
    try {
      source.read(0, 3).destroy();
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(await collect(source.read(4, 10)), 'efghij');
    } finally {
      await source.close();
    }
  });
});

test('закрытый источник отвечает внятно, а не EBADF', async () => {
  await withDirectory({ 'course.bin': 'abc' }, async root => {
    const source = await fileSource(join(root, 'course.bin'));
    await source.close();
    assert.throws(() => source.read(0, 3), /уже закрыт/);
  });
});

test('архив читается с диска через fileSource без загрузки в память', async () => {
  await withDirectory({ 'course.zip': '' }, async root => {
    const path = join(root, 'course.zip');
    await writeFile(path, zipOf());

    const source = await fileSource(path);
    const archive = await ZipArchive.open(source);
    try {
      const { metadata } = await parsePackage(zipSource(archive));
      assert.equal(metadata.title, 'Курс');
    } finally {
      // close() архива закрывает и источник — дескриптору больше не за кем следить.
      await archive.close();
    }
  });
});

async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
