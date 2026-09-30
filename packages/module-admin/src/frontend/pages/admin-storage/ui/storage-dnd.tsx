import { useTranslation } from '@amplicada/platform-core/frontend';
import { PointerSensor, type PointerSensorOptions, useDraggable, useDroppable } from '@dnd-kit/core';
import { Files } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useId, useMemo } from 'react';
import type { StorageEntry } from '../lib/entries.js';

/**
 * Пространства id разведены префиксами: один и тот же ключ (папка) одновременно лежит и в
 * перетаскиваемых, и в drop-целях, а `DndContext` ищет `over` среди droppable-контейнеров по id —
 * без префикса строка-источник могла бы навестись сама на себя.
 */
const DRAG_ID_PREFIX = 'storage-drag:';
const DROP_ID_PREFIX = 'storage-drop:';

export function storageDragId(key: string): string {
  return `${DRAG_ID_PREFIX}${key}`;
}

export function storageKeyFromDragId(id: unknown): string | null {
  return typeof id === 'string' && id.startsWith(DRAG_ID_PREFIX) ? id.slice(DRAG_ID_PREFIX.length) : null;
}

export function storageDropId(prefix: string): string {
  return `${DROP_ID_PREFIX}${prefix}`;
}

export function storagePrefixFromDropId(id: unknown): string | null {
  if (typeof id !== 'string' || !id.startsWith(DROP_ID_PREFIX)) return null;
  const rest = id.slice(DROP_ID_PREFIX.length);
  // У экземплярного суффикса (`useId`) разделитель `|` всегда последний: сам `useId` его не содержит.
  const separator = rest.lastIndexOf('|');
  return separator === -1 ? rest : rest.slice(0, separator);
}

/**
 * Цели, с которых перетаскивание начинаться не должно: контролы внутри строки/карточки
 * (инлайн-инпут, чекбокс, кнопки, ссылки, меню) и зона sentinel'а догрузки.
 */
export const STORAGE_DRAG_BLOCKERS =
  'input, textarea, select, option, [contenteditable]:not([contenteditable="false"]), button, a, [role="checkbox"], [role="menu"], [data-slot="storage-load-more"]';

/** Метка поверхности, которую контролом не считаем: тело кнопки-плитки — и клик, и drag. */
export const STORAGE_DRAG_SURFACE_ATTR = 'data-dnd-drag-surface';

/**
 * Точка старта drag лежит внутри интерактивного элемента или sentinel'а. Исключение — сама
 * помеченная поверхность: тело кнопки-плитки одновременно клик и drag-ручка, блокировать его
 * значило бы запретить перетаскивание плиток; контролы внутри такой поверхности всё равно блокеры.
 */
export function isStorageDragBlocked(target: EventTarget | null): boolean {
  const element = target as Element | null;
  // Duck-typing вместо `instanceof Element`: предикат тестируется в Node, где DOM нет.
  if (!element || typeof element.closest !== 'function') return false;
  const blocker = element.closest(STORAGE_DRAG_BLOCKERS);
  if (!blocker) return false;
  return blocker !== element.closest(`[${STORAGE_DRAG_SURFACE_ATTR}]`);
}

/**
 * PointerSensor с фильтром цели. Штатный сенсор активируется по одному pointerdown + 5px и в
 * `handleStart` сбрасывает выделение текста — из-за этого протяжка внутри инлайн-инпута
 * переименования срывала выделение и двигала строку целиком. Интерактивные цели drag не начинают.
 */
export class StoragePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: ReactPointerEvent, { onActivation }: PointerSensorOptions) => {
        if (!event.isPrimary || event.button !== 0) return false;
        if (isStorageDragBlocked(event.target)) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

/**
 * Хук строки/карточки как источника перетаскивания. Вызывается из компонента на элемент —
 * в `.map` хуки недопустимы, поэтому строки и плитки вынесены в отдельные компоненты.
 */
export function useStorageDraggable(entry: StorageEntry) {
  const {
    attributes,
    listeners: rawListeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: storageDragId(entry.key),
    data: { key: entry.key },
  });
  // KeyboardSensor активируется Space/Enter из любого потомка: проверка `activatorNode` в
  // 6.3.1 пустая, потому что `useDraggable` этот ref не выставляет. Без фильтра Enter на
  // кнопке строки стартовал бы drag вместо нажатия. Активатор — сама строка/карточка.
  const listeners = useMemo(() => {
    if (!rawListeners?.onKeyDown) return rawListeners;
    return {
      ...rawListeners,
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget) return;
        rawListeners.onKeyDown?.(event);
      },
    };
  }, [rawListeners]);
  return { attributes, listeners, setNodeRef, isDragging };
}

/**
 * Хук цели drop: destination — префикс папки или `''` для корня. Один префикс рисуется несколькими
 * узлами сразу (узел дерева, строка/плитка, крошка), а id droppable в dnd-kit обязан быть
 * уникальным: дубли затирают друг друга в реестре, и подсветка/обмер достаются «последнему», а
 * размонтирование одного узла удаляет общий id у остальных. `useId` разводит экземпляры, а
 * `storagePrefixFromDropId` снимает суффикс обратно до префикса. `enabled = false` выключает
 * регистрацию: dnd-kit регистрирует droppable безусловно, поэтому файлам (не целям) его нужно
 * гасить флагом `disabled`, а не отсутствием ref.
 */
export function useStorageDroppable(destination: string, enabled = true) {
  const instanceId = useId();
  const { setNodeRef, isOver } = useDroppable({
    id: `${storageDropId(destination)}|${instanceId}`,
    disabled: !enabled,
  });
  return { setNodeRef, isOver };
}

/** Карточка под курсором во время перетаскивания: сколько элементов несут. */
export function StorageDragPreview({ count }: { count: number }) {
  const { t } = useTranslation('admin');
  return (
    <div
      data-dnd-overlay
      // Обёртка DragOverlay — размер перетаскиваемой строки и левый верхний угол её rect: без
      // центрирования плашка уезжает за край экрана при перетаскивании влево. `w-max` не даёт
      // карточке растянуться в полосу на всю ширину строки таблицы.
      className="absolute left-1/2 top-1/2 flex w-max -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-md border bg-popover px-3 py-2 text-sm shadow-md"
    >
      <Files className="size-4 text-muted-foreground" />
      <span>{t('admin_storage_selected_count', { count })}</span>
    </div>
  );
}
