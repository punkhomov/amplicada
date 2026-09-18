import type { ApiClient } from '@amplicada/platform-core/frontend';
import type {
  SupportAdminThreadDetailDto,
  SupportAdminThreadDto,
  SupportSettingsDto,
  SupportThreadDto,
  SupportUserThreadSummaryDto,
} from '../../contracts/index.js';

export const SUPPORT_CHAT_REFETCH_INTERVAL_MS = 60_000;

export const supportChatQueryKeys = {
  thread: ['support-chat', 'thread'] as const,
  myThreads: ['support-chat', 'threads'] as const,
  myThread: (id: string) => ['support-chat', 'thread', id] as const,
  adminThreads: ['support-chat', 'admin', 'threads'] as const,
  adminThread: (id: string) => ['support-chat', 'admin', 'thread', id] as const,
  settings: ['support-chat', 'settings'] as const,
};

/** Активное обращение виджета: свежее по updatedAt, плюс непрочитанное по всем обращениям. */
export function supportChatThreadQueryOptions(api: ApiClient) {
  return {
    queryKey: supportChatQueryKeys.thread,
    queryFn: () => api.get<{ thread: SupportThreadDto | null; unreadTotal: number }>('/support-chat/thread'),
    refetchInterval: SUPPORT_CHAT_REFETCH_INTERVAL_MS,
  };
}

/** Список «Мои обращения» на портальной странице. */
export function supportChatMyThreadsQueryOptions(api: ApiClient) {
  return {
    queryKey: supportChatQueryKeys.myThreads,
    queryFn: () => api.get<SupportUserThreadSummaryDto[]>('/support-chat/threads'),
    refetchInterval: SUPPORT_CHAT_REFETCH_INTERVAL_MS,
  };
}

export function supportChatMyThreadQueryOptions(api: ApiClient, id: string) {
  return {
    queryKey: supportChatQueryKeys.myThread(id),
    queryFn: () => api.get<{ thread: SupportThreadDto }>(`/support-chat/threads/${id}`),
    refetchInterval: SUPPORT_CHAT_REFETCH_INTERVAL_MS,
  };
}

export function supportChatAdminThreadsQueryOptions(api: ApiClient) {
  return {
    queryKey: supportChatQueryKeys.adminThreads,
    queryFn: () => api.get<SupportAdminThreadDto[]>('/support-chat/admin/threads'),
    refetchInterval: SUPPORT_CHAT_REFETCH_INTERVAL_MS,
  };
}

export function supportChatSettingsQueryOptions(api: ApiClient) {
  return {
    queryKey: supportChatQueryKeys.settings,
    queryFn: () => api.get<SupportSettingsDto>('/support-chat/admin/settings'),
  };
}

export function supportChatAdminThreadQueryOptions(api: ApiClient, id: string) {
  return {
    queryKey: supportChatQueryKeys.adminThread(id),
    queryFn: () => api.get<SupportAdminThreadDetailDto>(`/support-chat/admin/threads/${id}`),
    refetchInterval: SUPPORT_CHAT_REFETCH_INTERVAL_MS,
  };
}
