/**
 * Длина префикса `bytes`, оканчивающегося на целой кодовой точке UTF-8.
 *
 * Хвост из 1–3 байт незавершённой последовательности отбрасывается: его дочитает
 * следующее окно (вызывающий начнёт с этой же позиции). Невалидный байт останавливает
 * префикс перед собой: декодировать его нельзя, а «перешагнуть» — значит потерять
 * выравнивание, по которому следующее окно найдёт начало символа.
 */
export function utf8CompletePrefix(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];
    if (byte < 0x80) {
      i += 1;
      continue;
    }
    let sequenceLength: number;
    if (byte >= 0xc0 && byte <= 0xdf) sequenceLength = 2;
    else if (byte >= 0xe0 && byte <= 0xef) sequenceLength = 3;
    else if (byte >= 0xf0 && byte <= 0xf7) sequenceLength = 4;
    // Continuation без лида (0x80–0xBF) или недопустимый лид (0xF8–0xFF).
    else return i;
    if (i + sequenceLength > bytes.length) return i;
    for (let k = 1; k < sequenceLength; k += 1) {
      const next = bytes[i + k];
      if (next < 0x80 || next > 0xbf) return i;
    }
    i += sequenceLength;
  }
  return i;
}
