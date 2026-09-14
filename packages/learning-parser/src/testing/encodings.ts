/**
 * Кодировщик в windows-1251 для тестов.
 *
 * `Buffer` умеет только в обратную сторону: прочитать 1251 можно, записать — нет. А для проверки
 * определения кодировки нужны байты ровно такими, какими их пишет отечественный сборщик курсов.
 * Таблица короткая — кириллица в 1251 лежит подряд, всё остальное совпадает с ASCII.
 */
export function encodeWindows1251(text: string): Buffer {
  return Buffer.from(
    [...text].map(char => {
      const code = char.codePointAt(0) ?? 0;
      if (code < 0x80) return code;
      if (char === 'Ё') return 0xa8;
      if (char === 'ё') return 0xb8;
      if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
      throw new Error(`нет в windows-1251: ${char}`);
    }),
  );
}
