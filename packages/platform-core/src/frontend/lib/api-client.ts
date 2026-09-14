import { resolveApiBaseUrl } from './api-base-url.js';
import { i18n } from './i18n.js';

export const API_CLIENT_TOKEN = 'api:client';

export interface ApiRequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, message: string, data: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export interface ApiClient {
  baseUrl: string;
  request<T = unknown>(method: string, path: string, options?: ApiRequestOptions): Promise<T>;
  get<T = unknown>(path: string, options?: ApiRequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T>;
  delete<T = unknown>(path: string, options?: ApiRequestOptions): Promise<T>;
}

/**
 * Текст серверной ошибки.
 *
 * Две формы, обе живые. Наши роуты отвечают `{ error: 'Курс не найден' }` — так написаны все
 * обработчики в платформе и модулях. Fastify в своих ошибках кладёт в `error` **название статуса**
 * (`"Not Found"`), а суть — в `message`. Отсюда порядок: `message` главнее, `error` — когда его нет.
 *
 * Раньше читалось только `message`, то есть текст любой ошибки наших роутов выбрасывался, и человек
 * видел «Request failed with status 409» вместо причины отказа.
 */
function messageOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  for (const key of ['message', 'error']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function buildUrl(baseUrl: string, path: string, query?: ApiRequestOptions['query']): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let url = `${baseUrl}${normalizedPath}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params.append(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

export function createApiClient(options: { baseUrl?: string } = {}): ApiClient {
  const baseUrl = options.baseUrl ?? resolveApiBaseUrl();

  async function request<T>(method: string, path: string, opts: ApiRequestOptions = {}): Promise<T> {
    const { query, body, headers, ...rest } = opts;
    const isJsonBody = body !== undefined && !(body instanceof FormData);

    const res = await fetch(buildUrl(baseUrl, path, query), {
      method,
      credentials: 'include',
      headers: {
        'Accept-Language': i18n.resolvedLanguage ?? i18n.language,
        ...(isJsonBody ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isJsonBody ? JSON.stringify(body) : (body as BodyInit),
      ...rest,
    });

    const contentType = res.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await res.json().catch(() => null) : await res.text().catch(() => null);

    if (!res.ok) {
      throw new ApiError(res.status, messageOf(payload) ?? `Request failed with status ${res.status}`, payload);
    }

    return payload as T;
  }

  return {
    baseUrl,
    request,
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts) => request('POST', path, { ...opts, body }),
    put: (path, body, opts) => request('PUT', path, { ...opts, body }),
    patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
    delete: (path, opts) => request('DELETE', path, opts),
  };
}
