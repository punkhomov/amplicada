import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const STEP = 1.5;

interface Transform {
  scale: number;
  x: number;
  y: number;
}

export interface ZoomPanApi {
  scale: number;
  isZoomed: boolean;
  containerRef: (node: HTMLDivElement | null) => void;
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onDoubleClick: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  contentStyle: CSSProperties;
}

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

/**
 * Зум и панорамирование картинки без зависимости: колесо/кнопки, drag мышью и пальцем,
 * двойной клик — сброс. Колесо зумит вокруг курсора, кнопки — вокруг центра.
 */
export function useZoomPan(): ZoomPanApi {
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [dragging, setDragging] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    container.current = node;
  }, []);

  const scaleAround = useCallback((nextScale: number, clientX: number, clientY: number) => {
    setTransform(prev => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      const rect = container.current?.getBoundingClientRect();
      if (!rect || scale === MIN_SCALE) return { scale, x: 0, y: 0 };
      const cx = clientX - rect.left - rect.width / 2;
      const cy = clientY - rect.top - rect.height / 2;
      const ratio = scale / prev.scale;
      return { scale, x: (prev.x - cx) * ratio + cx, y: (prev.y - cy) * ratio + cy };
    });
  }, []);

  // Нативный wheel с preventDefault: React-обработчик пассивен, и зум колёсиком прокручивал бы страницу.
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {});
  wheelHandler.current = event => {
    event.preventDefault();
    scaleAround(transformRef.current.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1), event.clientX, event.clientY);
  };

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const listener = (event: WheelEvent) => wheelHandler.current(event);
    node.addEventListener('wheel', listener, { passive: false });
    return () => node.removeEventListener('wheel', listener);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setTransform(prev => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
      return scale === MIN_SCALE ? { scale, x: 0, y: 0 } : { ...prev, scale };
    });
  }, []);

  const reset = useCallback(() => setTransform(IDENTITY), []);
  const zoomIn = useCallback(() => zoomBy(STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / STEP), [zoomBy]);
  const onDoubleClick = useCallback(() => {
    setTransform(prev => (prev.scale > MIN_SCALE ? { scale: 1, x: 0, y: 0 } : { scale: 2, x: 0, y: 0 }));
  }, []);

  const onPointerDown = (event: ReactPointerEvent) => {
    if (transform.scale <= MIN_SCALE) return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    setTransform(prev => ({
      ...prev,
      x: state.originX + (event.clientX - state.startX),
      y: state.originY + (event.clientY - state.startY),
    }));
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  return {
    scale: transform.scale,
    isZoomed: transform.scale > MIN_SCALE,
    containerRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick,
    zoomIn,
    zoomOut,
    reset,
    contentStyle: {
      transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
      transformOrigin: 'center',
      transition: dragging ? 'none' : 'transform 120ms ease',
      cursor: transform.scale > MIN_SCALE ? (dragging ? 'grabbing' : 'grab') : 'default',
      touchAction: 'none',
    },
  };
}
