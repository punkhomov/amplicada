import type { ComponentType } from 'react';

export interface AdminApp {
  id: string;
  /** i18n-ключ заголовка, например `support-chat:app_title` (локали модуля неймспейсятся его id). */
  titleKey: string;
  /** i18n-ключ описания. */
  descriptionKey?: string;
  icon?: ComponentType<{ className?: string }>;
  order?: number;
  component: ComponentType;
}

/** Frontend service registered by admin under `admin:apps`. */
export interface AdminAppsService {
  register(app: AdminApp): void;
  getAll(): AdminApp[];
  getById(id: string): AdminApp | undefined;
}
