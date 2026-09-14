import { stripBom } from '../../archive/text.js';

/**
 * CSV из `.au` и `.des`: первая строка — имена колонок, дальше данные. Каждая строка отдаётся
 * картой «колонка в нижнем регистре → значение».
 *
 * Разбор свой, а не через `split(',')`: значения бывают в кавычках и содержат запятые (пути,
 * названия), а удвоенная кавычка внутри означает саму кавычку.
 */
export function parseCsv(text: string): Map<string, string>[] {
  const rows = readCsvRows(stripBom(text));
  if (rows.length < 2) return [];

  const header = rows[0].map(name => name.trim().toLowerCase());
  return rows.slice(1).map(cells => {
    const row = new Map<string, string>();
    header.forEach((name, index) => {
      const cell = cells[index]?.trim();
      if (name && cell) row.set(name, cell);
    });
    return row;
  });
}

function readCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (text[i + 1] === '"') {
        // Удвоенная кавычка внутри значения — это одна кавычка, а не конец поля.
        cell += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      // Пустые строки между записями и хвост файла в данные не идут.
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}
