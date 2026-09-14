import type { ComponentType } from 'react';

export interface RequestFormProps {
  fields: Record<string, unknown>;
  onChange: (fields: Record<string, unknown>) => void;
  readonly?: boolean;
}

/** Реестр React-форм по коду типа заявки (v1: формы пишутся руками на тип, без генерации из схемы). */
const registry = new Map<string, ComponentType<RequestFormProps>>();

export function registerRequestForm(typeCode: string, component: ComponentType<RequestFormProps>): void {
  registry.set(typeCode, component);
}

export function getRequestForm(typeCode: string): ComponentType<RequestFormProps> | undefined {
  return registry.get(typeCode);
}
