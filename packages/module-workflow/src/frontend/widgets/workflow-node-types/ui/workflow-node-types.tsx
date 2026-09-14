import { Handle, type NodeProps, Position } from '@xyflow/react';
import { CircleDot, CircleStop, Clock, GitBranch, User, Zap } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import type { EditorNode } from '../../../lib/graph-mapping.js';

interface ShellProps {
  icon: ReactNode;
  title: string;
  label: string;
  selected?: boolean;
  className: string;
  hasTarget?: boolean;
  hasSource?: boolean;
  /** Индикатор непустых postEnterHooks — факт наличия хуков виден без открытия properties panel. */
  hasHooks?: boolean;
}

function NodeShell({ icon, title, label, selected, className, hasTarget = true, hasSource = true, hasHooks }: ShellProps) {
  return (
    <div
      className={`relative rounded-md border-2 bg-background px-3 py-2 shadow-sm min-w-36 ${selected ? 'ring-2 ring-ring' : ''} ${className}`}
    >
      {hasTarget && <Handle type="target" position={Position.Left} />}
      {hasHooks && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-fuchsia-500" title="Есть хуки после входа" />}
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className="text-sm font-medium">{label}</div>
      {hasSource && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

function StartNode({ data, selected }: NodeProps<EditorNode>) {
  return (
    <NodeShell
      icon={<CircleDot className="size-3" />}
      title="Начало"
      label={data.label}
      selected={selected}
      className="border-emerald-500"
      hasTarget={false}
    />
  );
}

function EndNode({ data, selected }: NodeProps<EditorNode>) {
  return (
    <NodeShell
      icon={<CircleStop className="size-3" />}
      title="Конец"
      label={data.label}
      selected={selected}
      className="border-rose-500"
      hasSource={false}
      hasHooks={!!data.postEnterHooks?.length}
    />
  );
}

function UserTaskNode({ data, selected }: NodeProps<EditorNode>) {
  return (
    <NodeShell
      icon={<User className="size-3" />}
      title="Задача"
      label={data.label}
      selected={selected}
      className="border-sky-500"
      hasHooks={!!data.postEnterHooks?.length}
    />
  );
}

const GATEWAY_MODE_SUFFIX: Record<'exclusive' | 'parallel' | 'inclusive', string> = {
  exclusive: '',
  parallel: ' · AND',
  inclusive: ' · OR',
};

function GatewayNode({ data, selected }: NodeProps<EditorNode>) {
  const mode = data.mode ?? 'exclusive';
  return (
    <NodeShell
      icon={<GitBranch className="size-3" />}
      title={`Шлюз${GATEWAY_MODE_SUFFIX[mode]}`}
      label={data.label}
      selected={selected}
      className={mode === 'exclusive' ? 'border-amber-500' : 'border-fuchsia-600'}
    />
  );
}

function ServiceTaskNode({ data, selected }: NodeProps<EditorNode>) {
  return (
    <NodeShell
      icon={<Zap className="size-3" />}
      title="Автодействие"
      label={data.label}
      selected={selected}
      className="border-violet-500"
    />
  );
}

function AsyncTaskNode({ data, selected }: NodeProps<EditorNode>) {
  return (
    <NodeShell
      icon={<Clock className="size-3" />}
      title="Асинхронное автодействие"
      label={data.label}
      selected={selected}
      className="border-teal-500"
    />
  );
}

// biome-ignore lint/suspicious/noExplicitAny: сигнатура nodeTypes React Flow требует широкий тип компонента
export const workflowNodeTypes: Record<string, ComponentType<any>> = {
  start: StartNode,
  end: EndNode,
  userTask: UserTaskNode,
  gateway: GatewayNode,
  serviceTask: ServiceTaskNode,
  asyncTask: AsyncTaskNode,
};
