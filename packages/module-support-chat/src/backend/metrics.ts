import type { MetricDefinition } from '@amplicada/module-metrics/contracts';

/** Бизнес-метрики поддержки: объявляются в реестре метрик, если модуль метрик собран. */
export const SUPPORT_CHAT_METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    key: 'support.threads_opened',
    module: 'support-chat',
    titleKey: 'support-chat:metrics_threads_opened',
    category: 'business',
    source: { events: ['support.thread.opened'] },
  },
  {
    key: 'support.messages_sent',
    module: 'support-chat',
    titleKey: 'support-chat:metrics_messages_sent',
    category: 'business',
    source: { events: ['support.message.sent'] },
  },
  {
    key: 'support.status_changes',
    module: 'support-chat',
    titleKey: 'support-chat:metrics_status_changes',
    category: 'quality',
    source: { events: ['support.thread.status_changed'] },
  },
];

export interface SupportChatMetric {
  name: string;
  actorUserId?: string;
  attributes?: Record<string, string | number | boolean>;
}
