import { type DragEvent, useEffect, useState } from 'react';
import { moveBlockReason } from '../lib/move.js';

export interface StorageDropHandlers {
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

export interface StorageDropTarget {
  /** Префикс, над которым сейчас висит перетаскивание, — для подсветки цели. */
  overPrefix: string | null;
  /** Цель недопустима: папка в себя/потомка или перенос ничего не изменит. */
  invalidFor: (destination: string) => boolean;
  handlersFor: (destination: string) => StorageDropHandlers;
}

/**
 * Общие обработчики drop-целей хранилища: подсветка наведения, `not-allowed` для невалидных
 * целей и вызов переноса. Один хук на компонент, а не на элемент: в рекурсивном дереве хук
 * на узел менял бы порядок хуков при раскрытии.
 */
export function useStorageDropTarget(
  dragKeys: string[] | null,
  onDropMove: (destination: string, keys: string[]) => void,
): StorageDropTarget {
  const [overPrefix, setOverPrefix] = useState<string | null>(null);

  // Перетаскивание закончилось (drop или отмена) — подсветка не должна пережить его.
  useEffect(() => {
    if (dragKeys === null) setOverPrefix(null);
  }, [dragKeys]);

  const invalidFor = (destination: string) => dragKeys !== null && moveBlockReason(dragKeys, destination) !== null;

  const handlersFor = (destination: string): StorageDropHandlers => ({
    onDragOver: event => {
      if (!dragKeys) return;
      // preventDefault делает элемент drop-целью; `none` рисует курсор «запрещено».
      event.preventDefault();
      event.dataTransfer.dropEffect = invalidFor(destination) ? 'none' : 'move';
    },
    onDragEnter: event => {
      if (!dragKeys) return;
      event.preventDefault();
      setOverPrefix(destination);
    },
    onDragLeave: event => {
      // Вложенные элементы шлют dragleave на каждом переходе: гасим подсветку только на уход наружу.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setOverPrefix(current => (current === destination ? null : current));
    },
    onDrop: event => {
      setOverPrefix(null);
      if (!dragKeys || invalidFor(destination)) return;
      event.preventDefault();
      onDropMove(destination, dragKeys);
    },
  });

  return { overPrefix, invalidFor, handlersFor };
}
