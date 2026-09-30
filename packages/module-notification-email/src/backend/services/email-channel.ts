import type { NotificationChannel, ResolvedNotification } from '@amplicada/platform-core/contracts';
import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { logger } from '@amplicada/platform-core/backend';
import { eq } from 'drizzle-orm';
import type { Transporter } from 'nodemailer';
import { userEmail } from '../schemas/index.js';

/** Именованный отправитель узла: `SMTP_SENDERS` — карта имя → from/replyTo. */
export interface SenderConfig {
  from: string;
  replyTo?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  senders: Record<string, SenderConfig>;
}

const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SMTP_FROM = 'Amplicada <no-reply@amplicada.local>';

/** `SMTP_SENDERS` — JSON-карта; битый JSON или запись без `from` не роняют узел. */
export function readSendersConfig(env: NodeJS.ProcessEnv): Record<string, SenderConfig> {
  const raw = env.SMTP_SENDERS?.trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, { from?: unknown; replyTo?: unknown }>;
    const senders: Record<string, SenderConfig> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value?.from !== 'string' || !value.from.trim()) continue;
      senders[name] = {
        from: value.from.trim(),
        ...(typeof value.replyTo === 'string' && value.replyTo.trim() ? { replyTo: value.replyTo.trim() } : {}),
      };
    }
    return senders;
  } catch (err) {
    logger.warn({ err }, 'SMTP_SENDERS: некорректный JSON — именованные отправители отключены');
    return {};
  }
}

/** Известное имя → конфиг; неизвестное/пустое → null (канал уйдёт на дефолтный `SMTP_FROM`). */
export function selectSender(senders: Record<string, SenderConfig>, name: string | undefined): SenderConfig | null {
  if (!name) return null;
  return senders[name] ?? null;
}

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
    senders: readSendersConfig(env),
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
    private senders: Record<string, SenderConfig> = {},
  ) {}

  async resolveAddress(userId: string): Promise<string | null> {
    const [row] = await this.db.select().from(userEmail).where(eq(userEmail.userId, userId)).limit(1);
    return row?.verifiedAt ? row.email : null;
  }

  listSenders(): string[] {
    return Object.keys(this.senders).sort();
  }

  async send(message: ResolvedNotification): Promise<void> {
    const sender = selectSender(this.senders, message.sender);
    if (message.sender && !sender) {
      logger.warn({ sender: message.sender }, 'Неизвестный отправитель — используется SMTP_FROM');
    }
    const replyTo = message.replyTo ?? sender?.replyTo;

    await this.transport.sendMail({
      from: sender?.from ?? this.from,
      to: message.address,
      subject: message.subject,
      text: message.body,
      html: message.html ?? undefined,
      ...(replyTo ? { replyTo } : {}),
      ...(message.cc?.length ? { cc: message.cc } : {}),
      ...(message.bcc?.length ? { bcc: message.bcc } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
    });
  }
}
