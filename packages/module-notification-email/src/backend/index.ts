export type { UserEmailRow } from './schemas/index.js';
export { userEmail } from './schemas/index.js';
export type { SmtpConfig } from './services/email-channel.js';
export { EmailChannel, readSmtpConfig } from './services/email-channel.js';
export { notificationEmailModule as module } from './setup.js';
