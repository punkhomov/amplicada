import { useSwipeSelect, useTranslation } from '@amplicada/platform-core/frontend';
import { Checkbox } from '@amplicada/platform-core/frontend/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@amplicada/platform-core/frontend/ui/dialog';
import type { DragEndEvent } from '@dnd-kit/core';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, ArrowRight, GripVertical, PinOff } from 'lucide-react';
import { useRef } from 'react';

interface SortableColumnItemProps {
  id: string;
  label: string;
  visible: boolean;
  onToggle: () => void;
  onPinLeft?: () => void;
  onPinRight?: () => void;
}

function SortableColumnItem({ id, label, visible, onToggle, onPinLeft, onPinRight }: SortableColumnItemProps) {
  const { t } = useTranslation('admin');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      data-swipe-item={id}
      data-swipe-checked={visible ? 'true' : 'false'}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : undefined,
      }}
      className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted"
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        {...listeners}
        {...attributes}
      >
        <GripVertical className="size-4" />
      </button>
      <Checkbox checked={visible} onCheckedChange={() => onToggle()} />
      <span className="text-sm flex-1">{label}</span>
      {onPinLeft && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onPinLeft}
          title={t('admin_column_pin_left')}
        >
          <ArrowLeft className="size-3.5" />
        </button>
      )}
      {onPinRight && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onPinRight}
          title={t('admin_column_pin_right')}
        >
          <ArrowRight className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function PinnedColumnItem({
  id,
  label,
  visible,
  onToggle,
  onPinLeft,
  onPinRight,
  onUnpin,
}: {
  id: string;
  label: string;
  visible: boolean;
  onToggle: () => void;
  onPinLeft?: () => void;
  onPinRight?: () => void;
  onUnpin?: () => void;
}) {
  const { t } = useTranslation('admin');
  return (
    <div
      data-swipe-item={id}
      data-swipe-checked={visible ? 'true' : 'false'}
      className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted"
    >
      <div className="size-4" />
      <Checkbox checked={visible} onCheckedChange={() => onToggle()} />
      <span className="text-sm flex-1">{label}</span>
      {onPinLeft && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onPinLeft}
          title={t('admin_column_pin_left')}
        >
          <ArrowLeft className="size-3.5" />
        </button>
      )}
      {onUnpin && (
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onUnpin} title={t('admin_column_unpin')}>
          <PinOff className="size-3.5" />
        </button>
      )}
      {onPinRight && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onPinRight}
          title={t('admin_column_pin_right')}
        >
          <ArrowRight className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export interface AdminColumnManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allColumnKeys: string[];
  unpinnedKeys: string[];
  currentSticky: { left: string[]; right: string[] };
  columnLabels: Record<string, string>;
  onPinLeft: (id: string) => void;
  onPinRight: (id: string) => void;
  onUnpin: (id: string) => void;
  onDragEnd: (event: DragEndEvent) => void;
  getColumnVisibility: (id: string) => boolean;
  toggleColumnVisibility: (id: string) => void;
}

export function AdminColumnManager({
  open,
  onOpenChange,
  allColumnKeys,
  unpinnedKeys,
  currentSticky,
  columnLabels,
  onPinLeft,
  onPinRight,
  onUnpin,
  onDragEnd,
  getColumnVisibility,
  toggleColumnVisibility,
}: AdminColumnManagerProps) {
  const { t } = useTranslation('admin');
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));
  const listContainerRef = useRef<HTMLDivElement>(null);

  useSwipeSelect({
    containerRef: listContainerRef,
    enabled: open,
    onToggle: (id: string, checked: boolean) => {
      const current = getColumnVisibility(id);
      if (current !== checked) toggleColumnVisibility(id);
    },
  });

  const renderPinnedItem = (key: string, showPinLeft?: boolean, showPinRight?: boolean) => (
    <PinnedColumnItem
      key={key}
      id={key}
      label={columnLabels[key]}
      visible={getColumnVisibility(key)}
      onToggle={() => toggleColumnVisibility(key)}
      onPinLeft={showPinLeft ? () => onPinLeft(key) : undefined}
      onPinRight={showPinRight ? () => onPinRight(key) : undefined}
      onUnpin={() => onUnpin(key)}
    />
  );

  const pinnedLeft = currentSticky.left.filter(k => allColumnKeys.includes(k));
  const pinnedRight = currentSticky.right.filter(k => allColumnKeys.includes(k));
  const hasPinned = pinnedLeft.length > 0 || pinnedRight.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('admin_toolbar_columns')}</DialogTitle>
        </DialogHeader>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div ref={listContainerRef} className="flex flex-col">
            {pinnedLeft.length > 0 && <div className="text-xs text-muted-foreground px-2 pt-1 pb-0.5">{t('admin_column_pinned_left')}</div>}
            {pinnedLeft.map(k => renderPinnedItem(k, false, true))}

            {hasPinned && unpinnedKeys.length > 0 && <div className="border-b my-1" />}

            {unpinnedKeys.length > 0 && (
              <SortableContext items={unpinnedKeys} strategy={verticalListSortingStrategy}>
                {unpinnedKeys.map(key => (
                  <SortableColumnItem
                    key={key}
                    id={key}
                    label={columnLabels[key]}
                    visible={getColumnVisibility(key)}
                    onToggle={() => toggleColumnVisibility(key)}
                    onPinLeft={() => onPinLeft(key)}
                    onPinRight={() => onPinRight(key)}
                  />
                ))}
              </SortableContext>
            )}

            {pinnedLeft.length > 0 && unpinnedKeys.length > 0 && pinnedRight.length > 0 && <div className="border-b my-1" />}

            {pinnedRight.length > 0 && (
              <div className="text-xs text-muted-foreground px-2 pt-1 pb-0.5">{t('admin_column_pinned_right')}</div>
            )}
            {pinnedRight.map(k => renderPinnedItem(k, true, false))}
          </div>
        </DndContext>
      </DialogContent>
    </Dialog>
  );
}
