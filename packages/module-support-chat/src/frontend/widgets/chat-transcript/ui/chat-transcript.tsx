import { cn } from '@amplicada/platform-core/frontend';
import { Bubble, BubbleContent } from '@amplicada/platform-core/frontend/ui/bubble';
import { Marker, MarkerContent } from '@amplicada/platform-core/frontend/ui/marker';
import { Message, MessageAvatar, MessageContent, MessageHeader } from '@amplicada/platform-core/frontend/ui/message';
import { MessageScrollerItem } from '@amplicada/platform-core/frontend/ui/message-scroller';
import { Fragment, type ReactNode } from 'react';
import type { SupportAuthorRole, SupportMessageDto } from '../../../../contracts/index.js';
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

interface ChatTranscriptProps {
  messages: SupportMessageDto[];
  /** Роль читателя: её сообщения уходят вправо, остальные — влево. */
  ownRole: SupportAuthorRole;
  labelFor: (message: SupportMessageDto) => string;
  avatarFor?: (message: SupportMessageDto) => ReactNode;
  emptyText?: string;
}

export function ChatTranscript({ messages, ownRole, labelFor, avatarFor, emptyText }: ChatTranscriptProps) {
  const grouped = groupMessages(messages);

  if (grouped.length === 0) {
    return emptyText ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null;
  }

  return (
    <>
      {grouped.map(({ message, position, groupStart }, index) => {
        const outgoing = message.authorRole === ownRole;
        const lastOfGroup = position === 'last' || position === 'single';
        const avatar = !outgoing && lastOfGroup && avatarFor ? avatarFor(message) : null;
        const dayBreak = index === 0 || !isSameDay(messages[index - 1].createdAt, message.createdAt);

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
                {avatar ? <MessageAvatar>{avatar}</MessageAvatar> : null}
                <MessageContent>
                  {!outgoing && groupStart ? <MessageHeader>{labelFor(message)}</MessageHeader> : null}
                  <Bubble variant={outgoing ? 'default' : 'muted'} align={outgoing ? 'end' : 'start'}>
                    <BubbleContent className={cn(BUBBLE_CORNERS[outgoing ? 'outgoing' : 'incoming'][position])}>
                      <span className="whitespace-pre-wrap">{message.body}</span>
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
