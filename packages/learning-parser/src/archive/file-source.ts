import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import type { RandomAccessSource } from './zip.js';

/**
 * Источник произвольного доступа поверх файла на диске.
 *
 * Нижняя ступень лестницы «байты → архив → пакет». Без неё zip с диска читался бы только целиком в
 * память, а пакет курса весит сотни мегабайт — ровно та ситуация, ради которой
 * {@link RandomAccessSource} и заведён.
 */

/** Источник, который обязан быть закрыт: за ним стоит дескриптор. */
export interface ClosableSource extends RandomAccessSource {
  close(): Promise<void>;
}

/**
 * Открывает файл на чтение и отдаёт источник поверх него.
 *
 * Закрывать обязан вызывающий. Если источник ушёл в `ZipArchive.open`, это делает `archive.close()`
 * — он зовёт `source.close()`; во всех остальных случаях `close()` руками. Дескриптор, который
 * некому закрыть, это утечка, и прятать её за удобством не надо.
 */
export async function fileSource(path: string): Promise<ClosableSource> {
  const handle = await open(path, 'r');

  let size: number;
  try {
    size = (await handle.stat()).size;
  } catch (error) {
    await handle.close();
    throw error;
  }

  let closed = false;

  return {
    size,
    read(start: number, end: number): Readable {
      if (closed) throw new Error(`Источник "${path}" уже закрыт`);

      // На каждый диапазон — свой дескриптор, и это не расточительность, а единственный рабочий
      // вариант. Поток, построенный поверх общего fd, закрывает его при `destroy()` — вопреки
      // `autoClose: false` и независимо от того, `FileHandle` это или число. yauzl читает диапазон
      // и рвёт поток, поэтому на общем дескрипторе второе чтение падает с `EBADF`.
      //
      // Открытый `handle` при этом остаётся: он держит файл на время разбора и даёт `close()` смысл.
      //
      // `end` у fs-потока включительный, у нас — `[start, end)`.
      return createReadStream(path, { start, end: end - 1 });
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await handle.close();
    },
  };
}
