export type {
  SupportAdminThreadDetailDto,
  SupportAdminThreadDto,
  SupportAuthorRole,
  SupportChatEventPayload,
  SupportMessageDto,
  SupportThreadDto,
  SupportThreadStatus,
} from '../contracts/index.js';
export { SUPPORT_CHAT_EVENTS, SUPPORT_CHAT_MESSAGE_MAX_LENGTH } from '../contracts/index.js';
export { SupportChatWidget } from './features/support-chat-widget/index.js';
export { supportChatQueryKeys } from './lib/query-options.js';
export { useSupportChatEvents } from './lib/use-support-chat-events.js';
export { SupportChatAdminPage } from './pages/support-chat-admin/index.js';

export { supportChatFrontendModule as module } from './setup.js';
