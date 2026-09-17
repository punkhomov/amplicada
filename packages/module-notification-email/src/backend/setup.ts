import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@amplicada/platform-core/backend';
import type { BackendDbService, BackendModule, BackendNotificationService } from '@amplicada/platform-core/contracts/backend';
import nodemailer from 'nodemailer';
import { moduleManifest } from '../contracts/manifest.js';
import { extendUserDoc } from './documents/user.js';
import { notificationEmailBackendLocales } from './locales/index.js';
import { EmailChannel, readSmtpConfig } from './services/email-channel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const notificationEmailModule: BackendModule = {
  ...moduleManifest,
  locales: { backend: { ru: notificationEmailBackendLocales.ru, en: notificationEmailBackendLocales.en } },

  setup(context) {
    const migrationsPath = join(__dirname, '..', '..', 'migrations');
    context.migrations.register('notification-email', migrationsPath);

    extendUserDoc(context.documents);

    const smtp = readSmtpConfig(process.env);
    if (!smtp) {
      // Узел без почты — штатная сборка: канал не регистрируется, ядро просто не найдёт адресата.
      logger.info('SMTP не сконфигурирован — канал email не зарегистрирован');
      return;
    }

    const db = context.services.resolve<BackendDbService>('db');
    const notification = context.services.resolve<BackendNotificationService>('notification');
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    });

    notification.registerChannel(new EmailChannel(db, transport, smtp.from));
    logger.info({ host: smtp.host, port: smtp.port }, 'Канал email зарегистрирован');
  },
};
