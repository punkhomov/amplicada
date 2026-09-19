import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { ExternalLink, FileQuestion } from 'lucide-react';
import type { RendererProps } from '../../contracts/index.js';
import { useFileViewer } from '../components/labels.js';

/**
 * Фолбэк для всего, что браузер сам не отрисует (docx, xlsx, архивы). Не пытаемся
 * конвертировать на клиенте: отдаём файл браузеру в новой вкладке — он либо покажет,
 * либо скачает.
 */
export default function ExternalRenderer({ openExternal }: RendererProps) {
  const { labels } = useFileViewer();
  return (
    <div className="grid h-full w-full place-items-center p-8 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <div className="grid size-12 place-items-center rounded-full bg-muted">
          <FileQuestion className="size-6 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-medium">{labels.unavailableTitle}</p>
          <p className="text-muted-foreground text-sm">{labels.unavailableDescription}</p>
        </div>
        <Button variant="outline" size="sm" onClick={openExternal}>
          <ExternalLink className="size-4" />
          {labels.openExternal}
        </Button>
      </div>
    </div>
  );
}
