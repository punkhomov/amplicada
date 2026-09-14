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

const registry = new Map<string, ToolbarAction>();

export function registerToolbarAction(action: ToolbarAction): void {
  registry.set(action.id, action);
}

export function getToolbarActions(documentType?: string): ToolbarAction[] {
  return [...registry.values()]
    .filter(a => !documentType || !a.documentType || a.documentType === documentType)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
