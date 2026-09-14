import { ApiError } from './api-client.js';

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Неизвестная ошибка';
}
