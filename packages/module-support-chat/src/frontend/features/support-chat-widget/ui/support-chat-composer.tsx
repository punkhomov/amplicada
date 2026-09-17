import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { useMessageScroller } from '@amplicada/platform-core/frontend/ui/message-scroller';
import { Textarea } from '@amplicada/platform-core/frontend/ui/textarea';
import { SendIcon } from 'lucide-react';

interface SupportChatComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  placeholder: string;
  submitLabel: string;
  hint?: string;
}

export function SupportChatComposer({ value, onValueChange, onSubmit, pending, placeholder, submitLabel, hint }: SupportChatComposerProps) {
  const { scrollToEnd } = useMessageScroller();

  const submit = () => {
    if (!value.trim() || pending) return;
    onSubmit();
    scrollToEnd();
  };

  return (
    <form
      className="border-t p-3 flex flex-col gap-2"
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        value={value}
        rows={2}
        placeholder={placeholder}
        onChange={event => onValueChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{hint ?? ''}</span>
        <Button type="submit" size="sm" disabled={!value.trim() || pending}>
          <SendIcon data-icon="inline-start" />
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
