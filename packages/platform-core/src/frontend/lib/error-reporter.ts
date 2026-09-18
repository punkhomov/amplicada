export interface FrontendErrorInfo {
  /** Откуда пришла ошибка: `react-uncaught`, `react-caught`, `window-error`, `unhandled-rejection`… */
  source: string;
  componentStack?: string;
  [key: string]: unknown;
}

export type FrontendErrorHandler = (error: unknown, info: FrontendErrorInfo) => void;

const handlers = new Set<FrontendErrorHandler>();

/**
 * Точка сбора клиентских ошибок ядра: React 19-хуки `createRoot` живут в приложении
 * (`apps/web`), а обработчик регистрирует модуль (например, метрики). Модуль не обязан
 * быть собран — репортер без подписчиков ничего не делает.
 */
export const frontendErrors = {
  subscribe(handler: FrontendErrorHandler): () => void {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  },

  report(error: unknown, info: FrontendErrorInfo): void {
    for (const handler of handlers) {
      try {
        handler(error, info);
      } catch {
        // Ошибка обработчика телеметрии не должна влиять на приложение.
      }
    }
  },
};
