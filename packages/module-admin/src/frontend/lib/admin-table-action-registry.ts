import type { ComponentType } from 'react';

export interface TableActionProps {
  documentType: string;
  selectedIds: string[];
  refreshData: () => void;
}

export interface TableAction {
  id: string;
  label: string;
  component: ComponentType<TableActionProps>;
  order?: number;
  documentType?: string;
}

const registry = new Map<string, TableAction>();

export function registerTableAction(action: TableAction): void {
  registry.set(action.id, action);
}

export function getTableActions(documentType?: string): TableAction[] {
  return [...registry.values()]
    .filter(a => !documentType || !a.documentType || a.documentType === documentType)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
