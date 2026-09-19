import type { ApiClient } from '@amplicada/platform-core/frontend';
import { useTranslation } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@amplicada/platform-core/frontend/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@amplicada/platform-core/frontend/ui/empty';
import { Download, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { StorageObject } from '../../../../contracts/storage.js';
import { formatBytes, formatDate } from '../lib/format.js';
import { objectName, storageDownloadUrl, storageViewUrl } from '../lib/paths.js';
import { storageFileKind } from '../lib/storage-file-kind.js';

/**
 * Потолок текстового превью: читаем начало файла через Range, а не тянем лог на гигабайт
 * целиком. Для «посмотреть глазами» этого хватает, полный файл доступен скачиванием.
 */
const TEXT_PREVIEW_LIMIT_BYTES = 256 * 1024;

type TextState = { status: 'loading' } | { status: 'ready'; content: string; truncated: boolean } | { status: 'error' };

interface StoragePreviewDialogProps {
  api: ApiClient;
  file: StorageObject | null;
  onOpenChange: (open: boolean) => void;
}

export function StoragePreviewDialog({ api, file, onOpenChange }: StoragePreviewDialogProps) {
  const { t } = useTranslation('admin');
  const [text, setText] = useState<TextState>({ status: 'loading' });
  const kind = file ? storageFileKind(file.key) : 'other';

  useEffect(() => {
    if (!file || storageFileKind(file.key) !== 'text') return;

    const controller = new AbortController();
    setText({ status: 'loading' });
    fetch(storageViewUrl(api, file.key), {
      credentials: 'include',
      headers: { Range: `bytes=0-${TEXT_PREVIEW_LIMIT_BYTES - 1}` },
      signal: controller.signal,
    })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(content => setText({ status: 'ready', content, truncated: file.size > TEXT_PREVIEW_LIMIT_BYTES }))
      .catch(error => {
        if ((error as Error).name !== 'AbortError') setText({ status: 'error' });
      });
    return () => controller.abort();
  }, [api, file]);

  const name = file ? objectName(file.key) : '';

  return (
    <Dialog open={file !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
        {file && (
          <>
            <DialogHeader>
              <DialogTitle className="truncate pr-8">{name}</DialogTitle>
              <DialogDescription>
                {formatBytes(file.size)} · {formatDate(file.lastModified)}
              </DialogDescription>
            </DialogHeader>

            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md border bg-muted/30">
              {kind === 'image' && (
                <img src={storageViewUrl(api, file.key)} alt={name} className="mx-auto max-h-[70vh] object-contain p-2" />
              )}
              {/* Файлы в хранилище произвольные — дорожек субтитров у них может не быть вовсе. */}
              {kind === 'video' && (
                // biome-ignore lint/a11y/useMediaCaption: пользовательские файлы, субтитры неоткуда взять
                <video src={storageViewUrl(api, file.key)} controls className="max-h-[70vh] w-full" />
              )}
              {kind === 'audio' && (
                <div className="w-full p-8">
                  {/* biome-ignore lint/a11y/useMediaCaption: пользовательские файлы, субтитры неоткуда взять */}
                  <audio src={storageViewUrl(api, file.key)} controls className="w-full" />
                </div>
              )}
              {kind === 'pdf' && <iframe src={storageViewUrl(api, file.key)} title={name} className="h-[70vh] w-full border-0" />}
              {kind === 'text' && <TextPreview text={text} />}
              {kind === 'other' && (
                <Empty className="border-0">
                  <EmptyHeader>
                    <EmptyTitle>{t('admin_storage_preview_unsupported_title')}</EmptyTitle>
                    <EmptyDescription>{t('admin_storage_preview_unsupported_description')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => window.open(storageDownloadUrl(api, file.key), '_blank')}>
                <Download className="size-4" />
                {t('admin_storage_download')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TextPreview({ text }: { text: TextState }) {
  const { t } = useTranslation('admin');

  if (text.status === 'loading') {
    return <LoaderCircle className="size-6 animate-spin text-muted-foreground" />;
  }
  if (text.status === 'error') {
    return <p className="p-8 text-muted-foreground">{t('admin_storage_preview_failed')}</p>;
  }
  return (
    <div className="w-full self-start">
      {text.truncated && (
        <p className="border-b bg-muted px-4 py-2 text-muted-foreground text-xs">
          {t('admin_storage_preview_truncated', { size: formatBytes(TEXT_PREVIEW_LIMIT_BYTES) })}
        </p>
      )}
      <pre className="whitespace-pre-wrap break-all p-4 font-mono text-xs">{text.content}</pre>
    </div>
  );
}
