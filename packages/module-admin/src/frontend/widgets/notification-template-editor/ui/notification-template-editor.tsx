import type { FieldMetadata } from '@amplicada/platform-core/contracts';
import { useTranslation } from '@amplicada/platform-core/frontend';
import { Label } from '@amplicada/platform-core/frontend/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@amplicada/platform-core/frontend/ui/tabs';
import { Textarea } from '@amplicada/platform-core/frontend/ui/textarea';

interface NotificationTemplateEditorProps {
  /** Бакет extension'а целиком: subject/name — соседние поля карточки, их надо сохранять. */
  data: Record<string, unknown>;
  fields: Record<string, FieldMetadata>;
  readonly?: boolean;
  onChange: (data: Record<string, unknown>) => void;
}

/**
 * Редактор контента шаблона: plain text, HTML и предпросмотр. Без rich-text библиотеки —
 * текст правится в textarea, письмо смотрится в песочнице iframe (`sandbox=""` без скриптов).
 * `onChange` заменяет бакет extension'а целиком, поэтому остальные ключи сохраняются явно.
 */
export function NotificationTemplateEditor({ data, fields, readonly, onChange }: NotificationTemplateEditorProps) {
  const { t } = useTranslation('admin');
  const body = typeof data.body === 'string' ? data.body : '';
  const html = typeof data.html === 'string' ? data.html : '';
  const subject = typeof data.subject === 'string' ? data.subject : '';

  const patch = (key: 'body' | 'html', value: string) => onChange({ ...data, [key]: value });

  return (
    <Tabs defaultValue="body">
      <TabsList>
        <TabsTrigger value="body">{t('template_editor_tab_body')}</TabsTrigger>
        <TabsTrigger value="html">{t('template_editor_tab_html')}</TabsTrigger>
        <TabsTrigger value="preview">{t('template_editor_tab_preview')}</TabsTrigger>
      </TabsList>

      <TabsContent value="body" className="mt-2">
        <Label className="mb-1 block">{fields.body?.label ?? t('template_editor_tab_body')}</Label>
        <Textarea
          rows={12}
          value={body}
          readOnly={readonly}
          placeholder={fields.body?.placeholder}
          onChange={event => patch('body', event.target.value)}
        />
      </TabsContent>

      <TabsContent value="html" className="mt-2">
        <Label className="mb-1 block">{fields.html?.label ?? t('template_editor_tab_html')}</Label>
        <Textarea
          rows={12}
          value={html}
          readOnly={readonly}
          placeholder={fields.html?.placeholder}
          onChange={event => patch('html', event.target.value)}
        />
      </TabsContent>

      <TabsContent value="preview" className="mt-2">
        <div className="overflow-hidden rounded-lg border">
          <div className="border-b bg-muted/40 px-3 py-2 text-sm">
            {subject || <span className="text-muted-foreground">{t('template_editor_no_subject')}</span>}
          </div>
          {html.trim() ? (
            <iframe title={t('template_editor_preview_title')} className="h-96 w-full bg-white" sandbox="" srcDoc={html} />
          ) : (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap p-3 text-sm">{body}</pre>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
