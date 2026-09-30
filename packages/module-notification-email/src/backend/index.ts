export type { UserEmailRow } from './schemas/index.js';
export { userEmail } from './schemas/index.js';
export type { SenderConfig, SmtpConfig } from './services/email-channel.js';
export { EmailChannel, readSendersConfig, readSmtpConfig, selectSender } from './services/email-channel.js';
export { notificationEmailModule as module } from './setup.js';
