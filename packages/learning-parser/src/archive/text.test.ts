import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeWindows1251 as windows1251 } from '../testing/encodings.js';
import { decodeText, detectEncoding, stripBom } from './text.js';

/** Кодом намеренно: символ невидимый, и в исходнике его не разглядеть — ни глазом, ни в diff'е. */
const BOM = String.fromCharCode(0xfeff);

function utf32(text: string, littleEndian: boolean): Buffer {
  const points = [...`${BOM}${text}`];
  const bytes = Buffer.alloc(points.length * 4);
  points.forEach((char, index) => {
    bytes.writeUInt32BE(char.codePointAt(0) ?? 0, index * 4);
    if (littleEndian) bytes.subarray(index * 4, index * 4 + 4).reverse();
  });
  return bytes;
}

test('BOM определяет кодировку однозначно', () => {
  const cases: [string, Buffer][] = [
    ['utf-8', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Охрана труда', 'utf8')])],
    ['utf-16le', Buffer.from(`${BOM}Охрана труда`, 'utf16le')],
    ['utf-16be', Buffer.from(Buffer.from(`${BOM}Охрана труда`, 'utf16le')).swap16()],
    ['utf-32le', utf32('Охрана труда', true)],
    ['utf-32be', utf32('Охрана труда', false)],
  ];

  for (const [encoding, bytes] of cases) {
    assert.deepEqual(detectEncoding(bytes), { encoding, source: 'bom' }, encoding);
    assert.equal(decodeText(bytes), 'Охрана труда', encoding);
  }
});

test('UTF-32LE опознаётся раньше UTF-16LE, а не как он', () => {
  // `FF FE 00 00` начинается с `FF FE`: при обратном порядке проверки файл прочитался бы как
  // UTF-16LE — молча и в мусор.
  assert.equal(detectEncoding(utf32('Курс', true)).encoding, 'utf-32le');
});

test('XML-декларация читается до того, как кодировка известна', () => {
  const xml = windows1251('<?xml version="1.0" encoding="windows-1251"?><manifest><title>Охрана труда</title></manifest>');

  assert.deepEqual(detectEncoding(xml), { encoding: 'windows-1251', source: 'declaration' });
  assert.match(decodeText(xml), /<title>Охрана труда<\/title>/);
});

test('те же байты без декларации дают тот же текст, но это уже догадка', () => {
  const bytes = windows1251('<manifest><title>Охрана труда</title></manifest>');

  assert.deepEqual(detectEncoding(bytes), { encoding: 'windows-1251', source: 'fallback' });
  assert.match(decodeText(bytes), /Охрана труда/);
});

test('валидный UTF-8 с кириллицей не уезжает в windows-1251', () => {
  // Обратная ошибка не менее вероятна и так же незаметна: строгая проверка UTF-8 существует ровно
  // затем, чтобы отличить настоящий UTF-8 от однобайтовой кодировки.
  const bytes = Buffer.from('<title>Охрана труда</title>', 'utf8');

  assert.deepEqual(detectEncoding(bytes), { encoding: 'utf-8', source: 'utf8' });
  assert.equal(decodeText(bytes), '<title>Охрана труда</title>');
});

test('ASCII-описатель — не догадка', () => {
  // Иначе предупреждение о кодировке прилетало бы на каждый второй исправный пакет.
  assert.equal(detectEncoding(Buffer.from('[Course]\nCourse_ID=A1\n', 'utf8')).source, 'utf8');
});

test('декларация проигрывает байтам, когда спорит с ними', () => {
  // `encoding="UTF-8"` в шаблоне редактора живёт дольше, чем настройка сохранения файла.
  const bytes = windows1251('<?xml version="1.0" encoding="UTF-8"?><title>Охрана труда</title>');

  assert.deepEqual(detectEncoding(bytes), { encoding: 'windows-1251', source: 'fallback' });
  assert.match(decodeText(bytes), /Охрана труда/);
});

test('кодировка, которую мы не умеем читать, не роняет разбор', () => {
  const bytes = Buffer.from('<?xml version="1.0" encoding="x-выдумка"?><title>course</title>', 'utf8');
  assert.equal(detectEncoding(bytes).source, 'utf8', 'непонятная метка — повод продолжить, а не бросить');
});

test('cp1251 и windows-1251 — одна и та же кодировка', () => {
  // Метки по WHATWG щедрые, и полагаться стоит на них, а не на свой список синонимов.
  const bytes = windows1251('<?xml version="1.0" encoding="cp1251"?><title>Курс</title>');
  assert.equal(detectEncoding(bytes).encoding, 'windows-1251');
});

test('BOM снимается и не попадает в первый ключ INI или первую колонку CSV', () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('[Course]', 'utf8')]);

  assert.equal(decodeText(withBom), '[Course]');
  assert.equal(stripBom(`${BOM}[Course]`), '[Course]');
  assert.equal(stripBom('[Course]'), '[Course]', 'без BOM строка не трогается');
});

test('пустой файл не считается ничем экзотическим', () => {
  assert.deepEqual(detectEncoding(new Uint8Array()), { encoding: 'utf-8', source: 'utf8' });
  assert.equal(decodeText(new Uint8Array()), '');
});
