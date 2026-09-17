import type { ApiClient } from '@amplicada/platform-core/frontend';
import type { SupportAdminThreadDetailDto, SupportAdminThreadDto, SupportThreadDto } from '../../contracts/index.js';

export const SUPPORT_CHAT_REFETCH_INTERVAL_MS = 60_000;

export const supportChatQueryKeys = {
  thread: ['support-chat', 'thread'] as const,
  adminThreads: ['support-chat', 'admin', 'threads'] as const,
  adminThread: (id: string) => ['support-chat', 'admin', 'thread', id] as const,
};

export function supportChatThreadQueryOptions(api: ApiClient) {
  return {
    queryKey: supportChatQueryKeys.thread,
    queryFn: () => api.get<{ thread: SupportThreadDto | null }>('/support-chat/thread'),
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

export function supportChatAdminThreadQueryOptions(api: ApiClient, id: string) {
  return {
    queryKey: supportChatQueryKeys.adminThread(id),
    queryFn: () => api.get<SupportAdminThreadDetailDto>(`/support-chat/admin/threads/${id}`),
    refetchInterval: SUPPORT_CHAT_REFETCH_INTERVAL_MS,
  };
}
