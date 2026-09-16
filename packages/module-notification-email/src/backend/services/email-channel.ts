import type { NotificationChannel, ResolvedNotification } from '@amplicada/platform-core/contracts';
import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { eq } from 'drizzle-orm';
import type { Transporter } from 'nodemailer';
import { userEmail } from '../schemas/index.js';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SMTP_FROM = 'Amplicada <no-reply@amplicada.local>';

/**
 * Настройки SMTP узла. Нет `SMTP_HOST` — почты на узле нет: это штатный режим (канал не
 * регистрируется), а не ошибка конфигурации.
 */
export function readSmtpConfig(env: NodeJS.ProcessEnv): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;

  const parsedPort = Number(env.SMTP_PORT);
  return {
    host,
    port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_SMTP_PORT,
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER?.trim() || undefined,
    password: env.SMTP_PASSWORD || undefined,
    from: env.SMTP_FROM?.trim() || DEFAULT_SMTP_FROM,
  };
}

/**
 * Почтовый канал: транспорт (SMTP) плюс адресная книга. Ядро не знает, что такое email — оно
 * спрашивает адрес у канала и отдаёт ему готовое сообщение.
 *
 * `resolveAddress` отдаёт адрес только при непустом `verified_at`: неподтверждённые адреса в
 * рассылку не попадают, а строка outbox просто не создаётся.
 */
export class EmailChannel implements NotificationChannel {
  readonly id = 'email';

  constructor(
    private db: BackendDbService,
    private transport: Transporter,
    private from: string,
  ) {}

  async resolveAddress(userId: string): Promise<string | null> {
    const [row] = await this.db.select().from(userEmail).where(eq(userEmail.userId, userId)).limit(1);
    return row?.verifiedAt ? row.email : null;
  }

  async send(message: ResolvedNotification): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.address,
      subject: message.subject,
      text: message.body,
      html: message.html ?? undefined,
    });
  }
}
