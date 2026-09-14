/**
 * Превращение байтов пакета в текст.
 *
 * Кодировка определяется здесь, рядом со чтением, а не внутри разбора конкретного формата:
 * в windows-1251 бывает и `imsmanifest.xml`, и `.crs`, и решать это дважды незачем.
 *
 * Зависимость под это не нужна: `TextDecoder` в Node с полным ICU знает весь легаси-набор WHATWG,
 * включая `windows-1251`, `koi8-r` и `ibm866`. Решение «поставить iconv-lite» выглядит очевидным
 * ровно до момента, когда кто-то проверит.
 */

/**
 * Чем оказался файл и насколько мы в этом уверены. Порядок перечисления — по убыванию надёжности:
 * `bom` однозначен, `fallback` — догадка.
 */
export type EncodingSource = 'bom' | 'declaration' | 'utf8' | 'fallback';

export interface DetectedEncoding {
  /** Каноническое имя по WHATWG Encoding — то, что понимает `TextDecoder`. */
  encoding: string;
  source: EncodingSource;
}

/**
 * Кодировка, на которую списывается всё, что не UTF-8 и себя не объявило.
 *
 * Выбор по проекту: русскоязычный LMS, отечественные сборщики курсов пишут windows-1251 до сих пор.
 * В образце на этом месте windows-1252 — та же логика, другая страна. И это именно догадка: текст в
 * koi8-r тоже невалиден как UTF-8 и будет прочитан отсюда, дав бессмыслицу. Поэтому `source` у него
 * `fallback`, а не `utf8`, — чтобы потребитель мог об этом сказать.
 */
const FALLBACK_ENCODING = 'windows-1251';

/**
 * BOM — не данные, а метка кодировки, и метка однозначная.
 *
 * UTF-32 проверяется **раньше** UTF-16: `FF FE 00 00` начинается с `FF FE`, и при обратном порядке
 * файл в UTF-32LE молча прочитался бы как UTF-16LE.
 */
const BOMS: readonly { readonly bytes: readonly number[]; readonly encoding: string }[] = [
  { bytes: [0x00, 0x00, 0xfe, 0xff], encoding: 'utf-32be' },
  { bytes: [0xff, 0xfe, 0x00, 0x00], encoding: 'utf-32le' },
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
  { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
];

/** `<?xml version="1.0" encoding="windows-1251"?>` — дальше первой строки декларации не бывает. */
const DECLARATION = /^<\?xml\s[^>]*?encoding\s*=\s*["']([^"']+)["']/i;
const DECLARATION_LOOKAHEAD_BYTES = 200;

/**
 * Декодирование прочитанного из архива файла-описателя.
 *
 * Кодировку можно передать готовой — если вызывающий уже спрашивал `detectEncoding`, чтобы
 * сообщить о догадке.
 */
export function decodeText(bytes: Uint8Array, detected: DetectedEncoding = detectEncoding(bytes)): string {
  return stripBom(decodeWith(bytes, detected.encoding));
}

/**
 * Каждый следующий признак менее надёжен предыдущего.
 *
 * Существенен здесь третий шаг: строгая проверка UTF-8 — это проверка, а не догадка. Русский текст
 * в windows-1251 почти наверняка невалиден как UTF-8, потому что кириллица там одиночными байтами
 * `0xC0–0xFF`, а UTF-8 требует за ними продолжения `0x80–0xBF`.
 */
export function detectEncoding(bytes: Uint8Array): DetectedEncoding {
  const bom = BOMS.find(candidate => startsWith(bytes, candidate.bytes));
  if (bom) return { encoding: bom.encoding, source: 'bom' };

  // Объявлению верим, пока оно не спорит с байтами: `encoding="UTF-8"` в шаблоне редактора живёт
  // дольше, чем настройка сохранения, и тогда байты честнее декларации.
  const declared = knownEncoding(declaredEncoding(bytes));
  if (declared && (declared !== 'utf-8' || isUtf8(bytes))) return { encoding: declared, source: 'declaration' };

  if (isUtf8(bytes)) return { encoding: 'utf-8', source: 'utf8' };
  return { encoding: FALLBACK_ENCODING, source: 'fallback' };
}

/**
 * BOM в начале файла, оставленный на месте, ломает и XML-разбор (символ перед `<?xml`), и сравнение
 * первого ключа в INI/CSV. `TextDecoder` снимает его сам для UTF-8 и UTF-16, но не для UTF-32,
 * который мы декодируем руками, — и не тогда, когда текст пришёл уже строкой.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function decodeWith(bytes: Uint8Array, encoding: string): string {
  if (encoding === 'utf-32le' || encoding === 'utf-32be') return decodeUtf32(bytes, encoding === 'utf-32le');
  return new TextDecoder(encoding).decode(bytes);
}

/**
 * `TextDecoder` UTF-32 не знает: WHATWG выкинул его из спецификации. Строк на это уходит немного,
 * а без него порядок проверки BOM выше был бы бессмысленным — опознали и не смогли прочитать.
 */
function decodeUtf32(bytes: Uint8Array, littleEndian: boolean): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let text = '';
  for (let offset = 0; offset + 4 <= view.byteLength; offset += 4) {
    const code = view.getUint32(offset, littleEndian);
    const valid = code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    text += String.fromCodePoint(valid ? code : 0xfffd);
  }
  return text;
}

/**
 * Декларация по стандарту записывается ASCII-совместимо — именно затем, чтобы её можно было
 * прочитать до того, как кодировка известна. `latin1` здесь не догадка о кодировке, а способ
 * посмотреть на байты как на символы.
 */
function declaredEncoding(bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.subarray(0, DECLARATION_LOOKAHEAD_BYTES)).toString('latin1');
  return DECLARATION.exec(head)?.[1] ?? null;
}

/**
 * Метка кодировки из декларации — то, что написал автор, а не то, что мы умеем читать. Заодно
 * отсеивается `replacement`: так `TextDecoder` называет кодировки, которые спецификация велит не
 * поддерживать, и декодирует их целиком в `U+FFFD`. Лучше догадаться, чем выдать строку из ромбов.
 */
function knownEncoding(label: string | null): string | null {
  if (!label) return null;
  try {
    const { encoding } = new TextDecoder(label);
    return encoding === 'replacement' ? null : encoding;
  } catch {
    return null;
  }
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}
