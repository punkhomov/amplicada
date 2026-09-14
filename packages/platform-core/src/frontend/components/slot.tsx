import type { ComponentType } from 'react';
import { useFrontendContext } from '../frontend-context.js';

interface SlotProps {
  name: string;
  fallback?: ComponentType;
}

export function Slot({ name, fallback: Fallback }: SlotProps) {
  const { slots } = useFrontendContext();
  const Component = slots.get(name);

  if (Component) return <Component />;
  if (Fallback) return <Fallback />;
  return null;
}
