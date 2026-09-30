import { isInside, moveTarget } from './paths.js';

/**
 * Причина, по которой перемещение `keys` в `destination` невозможно, или `null`.
 * `inside` — папка перемещается в себя/своего потомка (сервер ответит 400); `noop` — ни один
 * ключ не сменит место (сервер ответит 409 коллизией), такой дроп бессмысленно даже показывать.
 */
export function moveBlockReason(keys: string[], destination: string): 'inside' | 'noop' | null {
  // Папка в себя/потомка — единственный случай, который сервер гарантированно отвергнет (400),
  // поэтому проверяется первым: он важнее, чем «ничего не изменится» у остальных ключей.
  if (keys.some(key => key.endsWith('/') && isInside(key, destination))) return 'inside';
  if (keys.length > 0 && keys.every(key => moveTarget(key, destination) === key)) return 'noop';
  return null;
}
