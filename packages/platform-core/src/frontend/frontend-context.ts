import { createContext, useContext } from 'react';
import type { FrontendSetupContext } from '../contracts/frontend/index.js';

export const FrontendContext = createContext<FrontendSetupContext | null>(null);

export function useFrontendContext(): FrontendSetupContext {
  const ctx = useContext(FrontendContext);
  if (!ctx) throw new Error('useFrontendContext must be used within FrontendProvider');
  return ctx;
}
