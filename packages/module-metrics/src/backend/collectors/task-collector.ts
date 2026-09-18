import type { EventBus, EventBusEvent } from '@amplicada/platform-core/contracts';
import { TASK_EVENTS, type TaskRunFailedEvent, type TaskRunSucceededEvent } from '@amplicada/platform-core/contracts/backend';
import type { MeasurementBuffer } from '../services/measurement-buffer.js';

const INSTRUMENT = 'task.run.duration';

/** Метрики фоновых задач: длительность по задаче и исходу, подписка на шину событий. */
export function createTaskCollector({ buffer, eventBus }: { buffer: MeasurementBuffer; eventBus: EventBus }): () => void {
  const record = (taskId: string, outcome: string, durationMs: number) => {
    buffer.record({ instrument: INSTRUMENT, kind: 'histogram', unit: 's', dims: { task: taskId, outcome } }, durationMs / 1000);
  };

  const onSucceeded = (event: EventBusEvent<TaskRunSucceededEvent>) => {
    record(event.payload.taskId, 'success', event.payload.durationMs);
  };
  const onFailed = (event: EventBusEvent<TaskRunFailedEvent>) => {
    record(event.payload.taskId, event.payload.reason, event.payload.durationMs);
  };

  eventBus.on(TASK_EVENTS.succeeded, onSucceeded);
  eventBus.on(TASK_EVENTS.failed, onFailed);

  return () => {
    eventBus.off(TASK_EVENTS.succeeded, onSucceeded);
    eventBus.off(TASK_EVENTS.failed, onFailed);
  };
}
