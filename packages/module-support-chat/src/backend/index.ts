export type { SupportChatMessageRow, SupportChatThreadRow } from './schemas/index.js';
export { supportChatMessages, supportChatThreads } from './schemas/index.js';
export type { SupportChatRedisClient } from './services/event-bridge.js';
export { publishSupportChatEvent, SupportChatEventBridge } from './services/event-bridge.js';
export type { SupportChatService, SupportThreadWithMessages } from './services/support-chat-service.js';
export { createSupportChatService, SupportChatError, toMessageDto, toThreadDto } from './services/support-chat-service.js';
export { supportChatModule as module } from './setup.js';
