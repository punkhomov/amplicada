export function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env?.VITE_API_URL as string | undefined;
  const raw = fromEnv && fromEnv.length > 0 ? fromEnv : '/api';
  return raw.replace(/\/+$/, '');
}
