import { cn } from '@amplicada/platform-core/frontend';
import { Suspense, useMemo } from 'react';
import type { FileDescriptor, FilePreviewProps, RendererPlugin } from '../../contracts/index.js';
import { fileKindOf } from '../lib/file-kind.js';
import { monacoLanguageOf } from '../lib/file-language.js';
import { DEFAULT_TEXT_PREVIEW_LIMIT, useResolvedSource } from '../lib/use-resolved-source.js';
import { defaultRenderers, externalRenderer } from '../renderers/registry.js';
import { DEFAULT_LABELS, FileViewerContext } from './labels.js';
import { PreviewLoader } from './preview-loader.js';

/**
 * Поверхность предпросмотра: выбирает рендерер по типу файла и передаёт ему источник.
 * Тяжёлые рендереры (Monaco) подтягиваются через `Suspense` — пока текстовый файл не
 * открыли, их в бандле нет.
 */
export function FilePreview({ source, mode = 'view', onSave, labels, renderers, textPreviewLimitBytes, className }: FilePreviewProps) {
  const resolved = useResolvedSource(source);
  const registry = useMemo(() => renderers ?? defaultRenderers, [renderers]);
  const contextValue = useMemo(
    () => ({
      labels: { ...DEFAULT_LABELS, ...labels },
      textPreviewLimitBytes: textPreviewLimitBytes ?? DEFAULT_TEXT_PREVIEW_LIMIT,
    }),
    [labels, textPreviewLimitBytes],
  );

  if (!resolved) return null;

  const descriptor = resolved.descriptor;
  const plugin = selectRenderer(registry, descriptor);
  const canEdit = mode === 'edit' && Boolean(onSave) && fileKindOf(descriptor) === 'text' && Boolean(plugin.capabilities?.edit);
  const edit = canEdit && onSave ? { language: monacoLanguageOf(descriptor), onSave } : undefined;
  const Renderer = plugin.component;

  return (
    <FileViewerContext.Provider value={contextValue}>
      <div className={cn('relative h-full w-full', className)}>
        <Suspense fallback={<PreviewLoader />}>
          <Renderer
            descriptor={descriptor}
            url={resolved.url}
            readText={resolved.readText}
            openExternal={resolved.openExternal}
            edit={edit}
          />
        </Suspense>
      </div>
    </FileViewerContext.Provider>
  );
}

function selectRenderer(registry: RendererPlugin[], descriptor: FileDescriptor): RendererPlugin {
  const byPriority = [...registry].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return byPriority.find(plugin => plugin.match(descriptor)) ?? externalRenderer;
}
