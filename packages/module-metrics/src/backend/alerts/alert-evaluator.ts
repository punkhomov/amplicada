import type { AlertCondition } from '../../contracts/index.js';

export type AlertRuntimeState = 'pending' | 'firing' | 'resolved';

export interface AlertInstanceState {
  state: 'pending' | 'firing';
  activeAt: Date;
  value: number;
}

export interface StateDecision {
  state: AlertRuntimeState;
  /** Что эмитить наружу: `alert` при переходе в firing, `resolved` при выходе. */
  emit: 'alert' | 'resolved' | null;
  /** `true` — строку состояния нужно удалить (pending без срабатывания). */
  remove: boolean;
}

/** Сравнение значения с порогом (условие отсутствия данных обрабатывает вызывающий). */
export function isBreaching(value: number, condition: AlertCondition): boolean {
  if (condition.kind !== 'threshold') return false;
  switch (condition.op) {
    case 'gt':
      return value > condition.value;
    case 'gte':
      return value >= condition.value;
    case 'lt':
      return value < condition.value;
    case 'lte':
      return value <= condition.value;
  }
}

/**
 * Переходы состояний правила: pending (условие держится, но `forMs` не истёк) → firing →
 * resolved. Чистая функция — состояние хранится в `metrics.alert_instances`.
 */
export function decideAlertState(previous: AlertInstanceState | null, breaching: boolean, forMs: number, now: number): StateDecision {
  if (!previous) {
    if (!breaching) return { state: 'pending', emit: null, remove: true };
    if (forMs <= 0) return { state: 'firing', emit: 'alert', remove: false };
    return { state: 'pending', emit: null, remove: false };
  }

  if (previous.state === 'firing') {
    if (breaching) return { state: 'firing', emit: null, remove: false };
    return { state: 'resolved', emit: 'resolved', remove: false };
  }

  // pending
  if (!breaching) return { state: 'pending', emit: null, remove: true };
  if (now - previous.activeAt.getTime() >= forMs) return { state: 'firing', emit: 'alert', remove: false };
  return { state: 'pending', emit: null, remove: false };
}
