import { CircleDot, CircleStop, Clock, GitBranch, User, Zap } from 'lucide-react';
import type { DragEvent, ReactNode } from 'react';
import type { NodeType } from '../../../../contracts/graph.js';

export const PALETTE_DRAG_TYPE = 'application/x-workflow-node';

const PALETTE: { type: NodeType; label: string; icon: ReactNode }[] = [
  { type: 'start', label: 'Начало', icon: <CircleDot className="size-4 text-emerald-500" /> },
  { type: 'userTask', label: 'Задача пользователя', icon: <User className="size-4 text-sky-500" /> },
  { type: 'gateway', label: 'Шлюз (условие)', icon: <GitBranch className="size-4 text-amber-500" /> },
  { type: 'serviceTask', label: 'Автодействие', icon: <Zap className="size-4 text-violet-500" /> },
  { type: 'asyncTask', label: 'Асинхронное автодействие', icon: <Clock className="size-4 text-teal-500" /> },
  { type: 'end', label: 'Конец', icon: <CircleStop className="size-4 text-rose-500" /> },
];

export function NodePalette() {
  const onDragStart = (event: DragEvent, type: NodeType) => {
    event.dataTransfer.setData(PALETTE_DRAG_TYPE, type);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex w-56 shrink-0 flex-col gap-2 border-r p-3">
      <div className="text-xs font-semibold uppercase text-muted-foreground">Палитра</div>
      {PALETTE.map(item => (
        // biome-ignore lint/a11y/noStaticElementInteractions: drag-источник палитры; клавиатурной альтернативы создания нод в v1 нет (TODO вместе с доступностью канваса)
        <div
          key={item.type}
          draggable
          onDragStart={e => onDragStart(e, item.type)}
          className="flex cursor-grab items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent"
        >
          {item.icon}
          {item.label}
        </div>
      ))}
      <p className="mt-2 text-xs text-muted-foreground">Перетащите элемент на холст. Соединяйте ноды за точки по краям.</p>
    </div>
  );
}
