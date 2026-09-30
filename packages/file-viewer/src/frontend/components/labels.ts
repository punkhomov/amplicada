import { createContext, useContext } from 'react';
import type { FileViewerLabels } from '../../contracts/index.js';
import { DEFAULT_TEXT_PREVIEW_LIMIT } from '../lib/use-resolved-source.js';

/** Дефолты английские: либа не знает про i18n платформы, переводы передаёт потребитель. */
export const DEFAULT_LABELS: FileViewerLabels = {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomReset: 'Reset zoom',
  openExternal: 'Open in new tab',
  download: 'Download',
  unavailableTitle: 'No preview available',
  unavailableDescription: 'This file type has no inline viewer — open it in a new tab or download it.',
  failed: 'Failed to load the preview',
  textTruncated: 'Showing the first {{size}} — download for the full file',
  loadMore: 'Load more',
  edit: 'Edit',
  save: 'Save',
  saved: 'Saved',
  retry: 'Retry',
};

export interface FileViewerContextValue {
  labels: FileViewerLabels;
  textPreviewLimitBytes: number;
}

export const FileViewerContext = createContext<FileViewerContextValue>({
  labels: DEFAULT_LABELS,
  textPreviewLimitBytes: DEFAULT_TEXT_PREVIEW_LIMIT,
});

export function useFileViewer(): FileViewerContextValue {
  return useContext(FileViewerContext);
}

/** Подставляет `{{key}}` без i18n — подписи либы простые, плюрализации не требуют. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
}
