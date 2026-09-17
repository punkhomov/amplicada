import { cn } from '@amplicada/platform-core/frontend';
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@amplicada/platform-core/frontend/ui/attachment';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Bubble, BubbleContent } from '@amplicada/platform-core/frontend/ui/bubble';
import { Marker, MarkerContent } from '@amplicada/platform-core/frontend/ui/marker';
import { Message, MessageAvatar, MessageContent } from '@amplicada/platform-core/frontend/ui/message';
import { MessageScrollerItem } from '@amplicada/platform-core/frontend/ui/message-scroller';
import { FileIcon } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import type { SupportAttachmentDto, SupportAuthorRole, SupportMessageDto } from '../../../../contracts/index.js';
import { formatBytes } from '../lib/format.js';
import { groupMessages, type MessageGroupPosition } from '../lib/grouping.js';

const BUBBLE_CORNERS: Record<'incoming' | 'outgoing', Record<MessageGroupPosition, string>> = {
  incoming: {
    single: 'rounded-2xl',
    first: 'rounded-2xl rounded-bl-md',
    middle: 'rounded-2xl rounded-tl-md rounded-bl-md',
    last: 'rounded-2xl rounded-tl-md',
  },
  outgoing: {
    single: 'rounded-2xl',
    first: 'rounded-2xl rounded-br-md',
    middle: 'rounded-2xl rounded-tr-md rounded-br-md',
    last: 'rounded-2xl rounded-tr-md',
  },
};

export interface ChatTranscriptRoleTag {
  label: string;
  variant?: 'default' | 'secondary' | 'outline';
}

interface ChatTranscriptProps {
  messages: SupportMessageDto[];
  /** Роль читателя: её сообщения уходят вправо, остальные — влево. */
  ownRole: SupportAuthorRole;
  /** Имя автора в шапке группы (только для входящих). */
  nameFor?: (message: SupportMessageDto) => string | null;
  /** Тег роли справа от имени в шапке группы. */
  roleTagFor?: (message: SupportMessageDto) => ChatTranscriptRoleTag | null;
  avatarFor?: (message: SupportMessageDto) => ReactNode;
  /** Ссылка на скачивание вложения; без неё вложение рисуется некликабельным. */
  attachmentHrefFor?: (message: SupportMessageDto) => string;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDay(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString(undefined, options);
}

function isSameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function isImageAttachment(attachment: SupportAttachmentDto): boolean {
  return attachment.mime.startsWith('image/');
}

function AttachmentBody({ attachment, href }: { attachment: SupportAttachmentDto; href?: string }) {
  const media = isImageAttachment(attachment) ? (
    <img src={href} alt={attachment.name} loading="lazy" className="max-h-64 w-full min-w-40 rounded-lg object-cover" />
  ) : (
    <Attachment size="sm" className="max-w-full bg-background/60">
      <AttachmentMedia>
        <FileIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{attachment.name}</AttachmentTitle>
        <AttachmentDescription>{formatBytes(attachment.size)}</AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  );

  if (!href) return media;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="block">
      {media}
    </a>
  );
}

export function ChatTranscript({ messages, ownRole, nameFor, roleTagFor, avatarFor, attachmentHrefFor }: ChatTranscriptProps) {
  const grouped = groupMessages(messages);

  return (
    <>
      {grouped.map(({ message, position, groupStart }, index) => {
        const outgoing = message.authorRole === ownRole;
        const lastOfGroup = position === 'last' || position === 'single';
        const avatar = !outgoing && lastOfGroup && avatarFor ? avatarFor(message) : null;
        const dayBreak = index === 0 || !isSameDay(messages[index - 1].createdAt, message.createdAt);
        const name = !outgoing && groupStart ? (nameFor?.(message) ?? null) : null;
        const tag = !outgoing && groupStart ? (roleTagFor?.(message) ?? null) : null;
        const href = attachmentHrefFor?.(message);

        return (
          <Fragment key={message.id}>
            {dayBreak ? (
              <MessageScrollerItem className={cn(index > 0 && 'mt-4')}>
                <Marker variant="separator">
                  <MarkerContent>{formatDay(message.createdAt)}</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            ) : null}
            <MessageScrollerItem
              messageId={message.id}
              scrollAnchor={message.authorRole === 'user'}
              className={cn(!dayBreak && index > 0 && (groupStart ? 'mt-4' : 'mt-1'))}
            >
              <Message align={outgoing ? 'end' : 'start'}>
                {!outgoing && avatarFor ? (
                  avatar ? (
                    <MessageAvatar className="size-8">{avatar}</MessageAvatar>
                  ) : (
                    // Пустой слот аватара резервирует гуттер, чтобы пузыри группы стояли по одной
                    // левой границе с сообщением, на котором аватар виден (канон Message).
                    <MessageAvatar aria-hidden />
                  )
                ) : null}
                <MessageContent>
                  <Bubble variant={outgoing ? 'default' : 'muted'} align={outgoing ? 'end' : 'start'}>
                    <BubbleContent className={cn(BUBBLE_CORNERS[outgoing ? 'outgoing' : 'incoming'][position])}>
                      {!outgoing && groupStart && (name || tag) ? (
                        <div className="mb-1 flex min-w-40 items-center justify-between gap-3">
                          <span className="truncate text-xs font-semibold">{name}</span>
                          {tag ? (
                            <Badge variant={tag.variant ?? 'secondary'} className="shrink-0">
                              {tag.label}
                            </Badge>
                          ) : null}
                        </div>
                      ) : null}
                      {message.attachment ? (
                        <div className="mb-1.5">
                          <AttachmentBody attachment={message.attachment} href={href} />
                        </div>
                      ) : null}
                      {message.body ? <span className="whitespace-pre-wrap">{message.body}</span> : null}
                      {lastOfGroup ? (
                        <span className="ms-2 align-bottom text-[10px] opacity-60 tabular-nums">{formatTime(message.createdAt)}</span>
                      ) : null}
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            </MessageScrollerItem>
          </Fragment>
        );
      })}
    </>
  );
}
