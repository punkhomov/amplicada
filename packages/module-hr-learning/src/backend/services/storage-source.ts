import type { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';
import type { RandomAccessSource } from '@amplicada/learning-parser';
import type { BackendStorageService } from '@amplicada/platform-core/contracts/backend';

/**
 * Источник произвольного доступа поверх объекта в бакете.
 *
 * Это стык между «читать ZIP по диапазонам» и нашим хранилищем: yauzl просит кусок `[start, end)`,
 * мы превращаем его в один range-запрос к S3. Благодаря этому пакет с видео не оказывается в
 * памяти процесса ни целиком, ни даже одним файлом.
 */
export function storageSource(storage: BackendStorageService, key: string, size: number): RandomAccessSource {
  return {
    size,
    read(start, end) {
      // yauzl синхронно ждёт поток, а getObjectStream асинхронен: отдаём трубу сразу, а тело
      // подключаем, когда S3 ответит. Ошибку запроса переносим на неё же — иначе она осталась бы
      // необработанным rejection, а yauzl завис бы, не дождавшись данных.
      const tunnel = new PassThrough();
      storage
        .getObjectStream(key, { range: `bytes=${start}-${end - 1}` })
        .then((object: { body: Readable }) => {
          object.body.on('error', error => tunnel.destroy(error));
          object.body.pipe(tunnel);
        })
        .catch((error: Error) => tunnel.destroy(error));
      return tunnel;
    },
  };
}
