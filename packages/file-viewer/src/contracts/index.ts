import type { ComponentType, ReactNode } from 'react';

/** Что за файл — определяет, какой рендерер его откроет. */
export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'word' | 'spreadsheet' | 'other';

/** Минимум, нужный для выбора рендерера и шапки диалога. */
export interface FileDescriptor {
  name: string;
  mime?: string;
  size?: number;
}

/**
 * Откуда берётся файл. `url` — уже готовый адрес (auth на стороне потребителя, например
 * query-роут хранилища); `file`/`blob` — локальные данные (вложение ещё не загружено на сервер).
 */
export type FileSource =
  | { type: 'url'; url: string; name?: string; mime?: string; size?: number }
  | { type: 'file'; file: File }
  | { type: 'blob'; blob: Blob; name: string; mime?: string; size?: number };

export interface TextReadResult {
  text: string;
  /** Текст обрезан по лимиту — в редакторе такое сохранять нельзя. */
  truncated: boolean;
}

export interface TextEditOptions {
  /** Язык Monaco; если не задан, выводится из расширения/`mime`. */
  language?: string;
  onSave(content: string): Promise<void> | void;
}

/** Всё, что рендерер получает от shell'а. */
export interface RendererProps {
  descriptor: FileDescriptor;
  /** Уже разрешённый URL: для `file`/`blob` — object URL. `null`, пока создаётся. */
  url: string | null;
  /** Читает текст (для URL — с `Range` и лимитом). */
  readText(options?: { limitBytes?: number }): Promise<TextReadResult>;
  /** Читает файл целиком в память (для рендереров, которым нужны байты: Office, архивы). */
  readBytes(): Promise<ArrayBuffer>;
  /** Открыть файл в новой вкладке — браузер решает, отрисовать или скачать. */
  openExternal(): void;
  edit?: TextEditOptions;
}

export interface RendererPlugin {
  id: string;
  match(descriptor: FileDescriptor): boolean;
  component: ComponentType<RendererProps>;
  /** Больше — проверяется раньше; по умолчанию 0. */
  priority?: number;
  capabilities?: { zoom?: boolean; edit?: boolean };
}

/** Подписи chrome'а либы; дефолты английские, потребитель передаёт переводы. */
export interface FileViewerLabels {
  zoomIn: string;
  zoomOut: string;
  zoomReset: string;
  openExternal: string;
  download: string;
  unavailableTitle: string;
  unavailableDescription: string;
  failed: string;
  textTruncated: string;
  edit: string;
  save: string;
  saved: string;
  retry: string;
}

export interface FilePreviewProps {
  source: FileSource | null;
  /** `edit` включает редактор для текста (требует `onSave`). */
  mode?: 'view' | 'edit';
  onSave?(content: string): Promise<void> | void;
  labels?: Partial<FileViewerLabels>;
  renderers?: RendererPlugin[];
  /** Потолок для просмотра текста, байт. По умолчанию 512 КБ. */
  textPreviewLimitBytes?: number;
  className?: string;
}

export interface FilePreviewDialogProps extends FilePreviewProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title?: string;
  description?: ReactNode;
  /** Дополнительные кнопки в подвале (например, «Скачать» из конкретного роута). */
  actions?: ReactNode;
}
