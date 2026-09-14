import { useEffect, useRef } from 'react';

const SWIPE_ITEM_SELECTOR = '[data-swipe-item]';
const MOVE_THRESHOLD = 3;

interface UseSwipeSelectOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  onToggle: (id: string, checked: boolean) => void;
  enabled?: boolean;
}

export function useSwipeSelect({ containerRef, onToggle, enabled = true }: UseSwipeSelectOptions): void {
  const swipingRef = useRef(false);
  const startRef = useRef<{ x: number; y: number; index: number } | null>(null);
  const originalsRef = useRef<Map<string, boolean>>(new Map());
  const targetRef = useRef(false);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  useEffect(() => {
    if (!enabled) return;

    function getSwipeItems(): HTMLElement[] {
      const container = containerRef.current;
      if (!container) return [];
      return Array.from(container.querySelectorAll<HTMLElement>(SWIPE_ITEM_SELECTOR));
    }

    function applyRange(hoveredIndex: number) {
      const items = getSwipeItems();
      const start = startRef.current!;
      const lo = Math.min(start.index, hoveredIndex);
      const hi = Math.max(start.index, hoveredIndex);

      for (let i = 0; i < items.length; i++) {
        const el = items[i];
        const id = el.dataset.swipeItem!;
        const newChecked = i >= lo && i <= hi ? targetRef.current : originalsRef.current.get(id)!;

        // Сравниваем с реальным boolean, а не сырым атрибутом — React не рендерит
        // data-swipe-checked, когда его значение undefined, так что el.dataset.swipeChecked
        // может быть undefined у ещё ни разу не тронутых элементов вместо строки 'false'.
        const currentChecked = el.dataset.swipeChecked === 'true';
        if (currentChecked === newChecked) continue;
        el.dataset.swipeChecked = String(newChecked);
        onToggleRef.current(id, newChecked);
      }
    }

    function handleMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      const container = containerRef.current;
      if (!container || !container.contains(e.target as Node)) return;

      const item = (e.target as HTMLElement).closest<HTMLElement>(SWIPE_ITEM_SELECTOR);
      if (!item) return;

      const checkbox = (e.target as HTMLElement).closest<HTMLElement>('[data-slot="checkbox"]');
      if (!checkbox) return;

      const items = getSwipeItems();
      const index = items.indexOf(item);

      originalsRef.current.clear();
      for (const el of items) {
        originalsRef.current.set(el.dataset.swipeItem!, el.dataset.swipeChecked === 'true');
      }

      targetRef.current = !originalsRef.current.get(item.dataset.swipeItem!);
      startRef.current = { x: e.clientX, y: e.clientY, index };
    }

    function handleMouseMove(e: MouseEvent) {
      if (!startRef.current) return;

      if (!swipingRef.current) {
        const dx = e.clientX - startRef.current.x;
        const dy = e.clientY - startRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) < MOVE_THRESHOLD) return;
        swipingRef.current = true;
        document.body.style.userSelect = 'none';
      }

      const items = getSwipeItems();
      const hoveredEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(SWIPE_ITEM_SELECTOR);

      if (hoveredEl) {
        applyRange(items.indexOf(hoveredEl));
      } else {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        // sticky-заголовок таблицы физически внутри контейнера (визуально прилипает
        // к его верху), поэтому e.clientY < rect.top никогда не срабатывает при наведении
        // на него — граница "выше списка" должна идти по низу thead, а не по верху контейнера.
        const headerBottom = container.querySelector('thead')?.getBoundingClientRect().bottom ?? rect.top;
        applyRange(e.clientY < headerBottom ? 0 : items.length - 1);
      }
    }

    function handleMouseUp() {
      startRef.current = null;
      originalsRef.current.clear();
      if (!swipingRef.current) return;
      swipingRef.current = false;
      document.body.style.userSelect = '';
    }

    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [containerRef, enabled]);
}
