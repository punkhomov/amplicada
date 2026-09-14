import { stripBom } from '../../archive/text.js';

/**
 * INI-подобный разбор `.crs`: секции `[Course]`, строки `Ключ=Значение`.
 *
 * Ключи и имена секций приводятся к нижнему регистру: регистр в этих файлах пишут как придётся,
 * а спецификация его не фиксирует. Значение может содержать `=` — режем по первому.
 * Текст свободных секций (`[Course_Description]`) складывается в ключ `#text`.
 */
export function parseIni(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current = new Map<string, string>();
  const freeText: string[] = [];
  let currentName = '';

  const flushFreeText = () => {
    if (freeText.length && currentName) current.set('#text', freeText.join('\n').trim());
    freeText.length = 0;
  };

  for (const rawLine of stripBom(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;

    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      flushFreeText();
      currentName = section[1].trim().toLowerCase();
      current = sections.get(currentName) ?? new Map<string, string>();
      sections.set(currentName, current);
      continue;
    }

    const separator = line.indexOf('=');
    if (separator === -1) {
      freeText.push(line);
      continue;
    }
    current.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  flushFreeText();

  return sections;
}
