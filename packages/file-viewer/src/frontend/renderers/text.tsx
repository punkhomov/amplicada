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

type TextState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; text: string; truncated: boolean; nextOffset: number | null };

export default function TextRenderer({ descriptor, url, readText, edit }: RendererProps) {
  const { labels, textPreviewLimitBytes } = useFileViewer();
  const [state, setState] = useState<TextState>({ status: 'loading' });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const content = useRef('');
  const editMode = Boolean(edit);
  // Эпоха загрузки: ответ «Показать ещё», пришедший после смены url/режима, не должен
  // вклеиться в буфер уже другого файла — append проверяет эпоху перед setState.
  const readEpoch = useRef(0);

  // `readText`/`edit`/лимит читаются из ref: родитель (пример: `admin-storage`) пересоздаёт объект
  // `source`/`edit` на каждый рендер, и зависимость от их идентичности перечитывала бы файл и
  // сбрасывала буфер редактора при любом ре-рендере — например, во время сохранения.
  const readRef = useRef(readText);
  readRef.current = readText;
  const editRef = useRef(edit);
  editRef.current = edit;
  const previewLimitRef = useRef(textPreviewLimitBytes);
  previewLimitRef.current = textPreviewLimitBytes;

  // biome-ignore lint/correctness/useExhaustiveDependencies: url — ключ перезагрузки, `editMode` меняет лимит чтения; readText/лимит берём из ref, чтобы новая ссылка не перечитывала файл
  useEffect(() => {
    let alive = true;
    readEpoch.current += 1;
    setState({ status: 'loading' });
    setLoadMoreFailed(false);
    setLoadingMore(false);
    readRef
      .current({ limitBytes: editMode ? EDIT_LIMIT_BYTES : previewLimitRef.current })
      .then(result => {
        if (!alive) return;
        content.current = result.text;
        setDirty(false);
        setState({
          status: 'ready',
          text: result.text,
          truncated: result.truncated,
          nextOffset: result.nextOffsetBytes ?? null,
        });
      })
      .catch(() => {
        if (alive) setState({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [url, editMode]);

  // Догрузка следующего окна режима просмотра: append к буферу, а не замена — иначе
  // позиция чтения и выделение терялись бы на каждом клике. Стык безопасен: хелпер
  // вернул текст, оборванный только на границе кодовой точки.
  const handleLoadMore = useCallback(async () => {
    if (state.status !== 'ready' || state.nextOffset === null || loadingMore) return;
    const offset = state.nextOffset;
    const epoch = readEpoch.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const result = await readRef.current({ limitBytes: previewLimitRef.current, offsetBytes: offset });
      if (epoch !== readEpoch.current) return;
      setState(prev =>
        prev.status === 'ready'
          ? {
              status: 'ready',
              text: prev.text + result.text,
              truncated: result.truncated,
              nextOffset: result.nextOffsetBytes ?? null,
            }
          : prev,
      );
    } catch {
      // Окно не пришло — уже загруженный текст не выбрасываем: показываем ошибку у кнопки,
      // она же остаётся для повтора.
      if (epoch === readEpoch.current) setLoadMoreFailed(true);
    } finally {
      if (epoch === readEpoch.current) setLoadingMore(false);
    }
  }, [state, loadingMore]);

  const handleSave = useCallback(() => {
    const current = editRef.current;
    if (!current || saving) return;
    setSaving(true);
    Promise.resolve(current.onSave(content.current))
      .then(() => {
        setDirty(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      // Потребитель уже показал `onError`; иначе отказ сохранения всплывёт unhandled rejection'ом.
      .catch(() => {})
      .finally(() => setSaving(false));
  }, [saving]);

  if (state.status === 'loading') return <PreviewLoader />;
  if (state.status === 'error') {
    return <div className="grid h-full w-full place-items-center text-muted-foreground text-sm">{labels.failed}</div>;
  }

  const readOnly = !edit || state.truncated;
  const limit = edit ? EDIT_LIMIT_BYTES : textPreviewLimitBytes;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {state.truncated &&
        (editMode || state.nextOffset === null ? (
          // В правке окно одно: догрузка запрещена (сохранение неполного текста опасно), здесь только предупреждение.
          <p className="shrink-0 border-b bg-muted px-4 py-1.5 text-muted-foreground text-xs">
            {interpolate(labels.textTruncated, { size: formatBytes(limit) })}
          </p>
        ) : (
          <div className="flex shrink-0 items-center gap-2 border-b bg-muted px-4 py-1.5">
            <Button size="sm" variant="outline" onClick={() => void handleLoadMore()} disabled={loadingMore}>
              {labels.loadMore}
            </Button>
            {loadMoreFailed && <span className="text-muted-foreground text-xs">{labels.failed}</span>}
          </div>
        ))}
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
