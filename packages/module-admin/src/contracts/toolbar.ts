import type { ComponentType } from 'react';

export interface ToolbarActionProps {
  documentType: string;
  /** module → key extension'а → поля. Модуль с единственным `extend()` берёт `DEFAULT_EXTENSION_KEY`. */
  editData: Record<string, Record<string, Record<string, unknown>>>;
  updateField: (module: string, key: string, fieldKey: string, value: unknown) => void;
  isNew: boolean;
}

export interface ToolbarAction {
  id: string;
  label: string;
  component: ComponentType<ToolbarActionProps>;
  order?: number;
  documentType?: string;
}

/** Frontend service registered by admin under `admin:toolbar`. */
export interface AdminToolbarService {
  register(action: ToolbarAction): void;
  getAll(documentType?: string): ToolbarAction[];
}
