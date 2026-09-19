import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RendererProps } from '../../contracts/index.js';
import { interpolate, useFileViewer } from '../components/labels.js';
import { PreviewLoader } from '../components/preview-loader.js';
import { TextEditor } from '../components/text-editor.js';
import { monacoLanguageOf } from '../lib/file-language.js';
import { formatBytes } from '../lib/format.js';

/** Потолок для режима правки: больше — не редактор, а способ уронить вкладку. */
const EDIT_LIMIT_BYTES = 5 * 1024 * 1024;

type TextState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; text: string; truncated: boolean };

export default function TextRenderer({ descriptor, readText, edit }: RendererProps) {
  const { labels, textPreviewLimitBytes } = useFileViewer();
  const [state, setState] = useState<TextState>({ status: 'loading' });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const content = useRef('');

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    readText({ limitBytes: edit ? EDIT_LIMIT_BYTES : textPreviewLimitBytes })
      .then(result => {
        if (!alive) return;
        content.current = result.text;
        setDirty(false);
        setState({ status: 'ready', text: result.text, truncated: result.truncated });
      })
      .catch(() => {
        if (alive) setState({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [readText, edit, textPreviewLimitBytes]);

  const handleSave = useCallback(() => {
    if (!edit || saving) return;
    setSaving(true);
    Promise.resolve(edit.onSave(content.current))
      .then(() => {
        setDirty(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .finally(() => setSaving(false));
  }, [edit, saving]);

  if (state.status === 'loading') return <PreviewLoader />;
  if (state.status === 'error') {
    return <div className="grid h-full w-full place-items-center text-muted-foreground text-sm">{labels.failed}</div>;
  }

  const readOnly = !edit || state.truncated;
  const limit = edit ? EDIT_LIMIT_BYTES : textPreviewLimitBytes;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {state.truncated && (
        <p className="shrink-0 border-b bg-muted px-4 py-1.5 text-muted-foreground text-xs">
          {interpolate(labels.textTruncated, { size: formatBytes(limit) })}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <TextEditor
          value={state.text}
          language={edit?.language ?? monacoLanguageOf(descriptor)}
          readOnly={readOnly}
          onChange={next => {
            content.current = next;
            setDirty(true);
          }}
          onSave={edit ? () => handleSave() : undefined}
        />
      </div>
      {edit && !state.truncated && (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2">
          {saved && <span className="text-muted-foreground text-xs">{labels.saved}</span>}
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {labels.save}
          </Button>
        </div>
      )}
    </div>
  );
}
