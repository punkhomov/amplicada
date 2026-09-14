import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Сборка ZIP-архива в памяти — только для тестов.
 *
 * Готовой библиотеки записи ZIP в зависимостях нет и заводить её ради тестов не хочется, а формат
 * достаточно простой, чтобы собрать его руками. Заодно это даёт то, чего не даст ни один готовый
 * фикстур: архив с намеренно неправильными полями (соврать про размер, положить `../` в имя).
 */

export interface ZipFixtureEntry {
  path: string;
  content?: string | Buffer;
  /** По умолчанию `deflate` — как в настоящих пакетах. */
  method?: 'store' | 'deflate';
  /** Подмена заявленного распакованного размера — для проверки защиты от zip-бомбы. */
  declaredSize?: number;
}

const DOS_TIME = 24576; // 12:00:00
const DOS_DATE = 23585; // 2026-01-01

function toBuffer(content: string | Buffer | undefined): Buffer {
  if (content === undefined) return Buffer.alloc(0);
  return Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
}

export function makeZip(entries: readonly ZipFixtureEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const isDirectory = entry.path.endsWith('/');
    const raw = isDirectory ? Buffer.alloc(0) : toBuffer(entry.content);
    const method = isDirectory || entry.method === 'store' ? 0 : 8;
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const declared = entry.declaredSize ?? raw.length;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // версия, необходимая для распаковки
    header.writeUInt16LE(0, 6); // флаги
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc32(raw), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(declared, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28); // extra

    local.push(header, name, data);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4); // версия создателя
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(DOS_TIME, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(crc32(raw), 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(declared, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt16LE(0, 30); // extra
    record.writeUInt16LE(0, 32); // комментарий
    record.writeUInt16LE(0, 34); // номер диска
    record.writeUInt16LE(0, 36); // внутренние атрибуты
    record.writeUInt32LE(isDirectory ? 0x10 : 0, 38); // внешние атрибуты
    record.writeUInt32LE(offset, 42);

    central.push(record, name);
    offset += header.length + name.length + data.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // комментарий архива

  return Buffer.concat([...local, directory, end]);
}
