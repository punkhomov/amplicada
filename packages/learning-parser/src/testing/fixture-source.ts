import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PackageSource } from '../formats/detect.js';
import { packagePathsOf } from '../formats/source.js';

/**
 * Загрузчик корпуса настоящих пакетов — только для тестов.
 *
 * Пакеты корпуса урезаны по правилу «описатели дословно, ассеты только путями»: разбор читает
 * лишь описатели, а картинки и вёрстка нужны исключительно как имена — для правила
 * `common.file-missing` и для разрешения точки запуска. Поэтому рядом с каждым пакетом лежит
 * `files.txt` с **полным** перечнем файлов исходного пакета, а на диске — только описатели.
 *
 * Это соглашение корпуса, а не часть формата, поэтому оно живёт здесь, а не в `directorySource`:
 * ни у одного настоящего пакета никакого `files.txt` рядом не лежит.
 */

const INVENTORY = 'files.txt';

/**
 * Перечень файлов пакета — как он записан в архиве, до нормализации и отрезания корня.
 *
 * Отдельно от `fixtureSource`, потому что политике приёма нужен именно сырой список: она сама
 * нормализует пути, режет корень и решает, что в пакет не поедет.
 */
export async function fixturePaths(root: string): Promise<string[]> {
  const declared = await readFile(join(root, INVENTORY), 'utf8');
  return declared
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && line !== INVENTORY);
}

export async function fixtureSource(root: string): Promise<PackageSource> {
  const byPath = packagePathsOf(await fixturePaths(root));

  return {
    paths: [...byPath.keys()],
    async readBytes(path: string): Promise<Uint8Array> {
      const relative = byPath.get(path);
      if (relative === undefined) throw new Error(`Файла "${path}" нет в перечне пакета`);

      try {
        return await readFile(join(root, ...relative.split('/')));
      } catch (error) {
        // Ассеты в корпусе не хранятся. Если разбор полез в картинку — это ошибка разбора, а не
        // корпуса: читаться должны только описатели.
        throw new Error(`Файл "${path}" в корпусе хранится только путём, но у него запросили содержимое`, { cause: error });
      }
    },
  };
}
