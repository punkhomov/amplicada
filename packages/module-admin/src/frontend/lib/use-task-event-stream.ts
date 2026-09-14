import { useApiClient } from '@amplicada/platform-core/frontend';
import { useEffect, useRef } from 'react';

export interface TaskRunStartedPayload {
  runId: string;
  taskId: string;
  workerId: string;
  startedAt: string;
  trigger: 'schedule' | 'manual';
}

export interface TaskRunSucceededPayload {
  runId: string;
  taskId: string;
  finishedAt: string;
  durationMs: number;
}

export interface TaskRunFailedPayload {
  runId: string;
  taskId: string;
  finishedAt: string;
  durationMs: number;
  reason: 'error' | 'timeout' | 'cancelled';
  error?: { message: string; stack?: string };
}

export interface TaskRunLogPayload {
  runId: string;
  taskId: string;
  timestamp: string;
  level: 'info' | 'error';
  message: string;
}

interface TaskEventStreamHandlers {
  onStarted?: (payload: TaskRunStartedPayload) => void;
  onSucceeded?: (payload: TaskRunSucceededPayload) => void;
  onFailed?: (payload: TaskRunFailedPayload) => void;
  onLog?: (payload: TaskRunLogPayload) => void;
}

/** Один SSE-стрим (`/admin/tasks/events`) на весь открытый компонент — сервер шлёт все события задач, компонент фильтрует то, что ему нужно. */
export function useTaskEventStream(handlers: TaskEventStreamHandlers): void {
  const api = useApiClient();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const source = new EventSource(`${api.baseUrl}/admin/tasks/events`, { withCredentials: true });

    const listeners: [string, (e: MessageEvent) => void][] = [
      ['task.run.started', e => handlersRef.current.onStarted?.(JSON.parse(e.data))],
      ['task.run.succeeded', e => handlersRef.current.onSucceeded?.(JSON.parse(e.data))],
      ['task.run.failed', e => handlersRef.current.onFailed?.(JSON.parse(e.data))],
      ['task.run.log', e => handlersRef.current.onLog?.(JSON.parse(e.data))],
    ];
    for (const [type, listener] of listeners) source.addEventListener(type, listener);

    return () => {
      for (const [type, listener] of listeners) source.removeEventListener(type, listener);
      source.close();
    };
  }, [api.baseUrl]);
}
