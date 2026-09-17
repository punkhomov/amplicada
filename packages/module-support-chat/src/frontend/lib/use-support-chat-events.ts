import { useApiClient, useQueryClient } from '@amplicada/platform-core/frontend';
import { useEffect } from 'react';
import { SUPPORT_CHAT_EVENTS } from '../../contracts/index.js';

export function useSupportChatEvents(stream: 'user' | 'admin' = 'user', enabled = true): void {
  const api = useApiClient();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const path = stream === 'admin' ? '/support-chat/admin/events' : '/support-chat/events';
    const source = new EventSource(`${api.baseUrl}${path}`, { withCredentials: true });

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['support-chat'] });
    };

    source.addEventListener(SUPPORT_CHAT_EVENTS.MESSAGE_CREATED, invalidate);
    source.addEventListener(SUPPORT_CHAT_EVENTS.THREAD_UPDATED, invalidate);

    return () => source.close();
  }, [api.baseUrl, queryClient, stream, enabled]);
}
