import type { SupportMessageDto } from '../../../../contracts/index.js';

export type MessageGroupPosition = 'single' | 'first' | 'middle' | 'last';

export interface GroupedChatMessage {
  message: SupportMessageDto;
  position: MessageGroupPosition;
  groupStart: boolean;
}

export function groupMessages(messages: SupportMessageDto[]): GroupedChatMessage[] {
  return messages.map((message, index) => {
    const sameAsPrev = messages[index - 1]?.authorRole === message.authorRole;
    const sameAsNext = messages[index + 1]?.authorRole === message.authorRole;

    const position: MessageGroupPosition = !sameAsPrev && !sameAsNext ? 'single' : sameAsPrev ? (sameAsNext ? 'middle' : 'last') : 'first';

    return { message, position, groupStart: !sameAsPrev };
  });
}
