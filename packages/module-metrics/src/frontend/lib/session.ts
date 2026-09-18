const SESSION_KEY = 'metrics.session';
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredSession {
  id: string;
  lastActivity: number;
}

let counter = 0;

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  counter += 1;
  return `session-${Date.now()}-${counter}`;
}

/**
 * Сессия трекера: 30 минут неактивности → новая (отраслевой стандарт PostHog/Matomo).
 * Сессия неперсистентна между вкладками/браузерами и не является идентификатором личности.
 */
export function currentSessionId(now = Date.now(), storage?: KeyValueStorage | null): string {
  const target = storage === undefined ? safeSessionStorage() : storage;
  if (!target) return newId();
  try {
    const raw = target.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredSession;
      if (typeof parsed.id === 'string' && typeof parsed.lastActivity === 'number' && now - parsed.lastActivity < SESSION_TTL_MS) {
        target.setItem(SESSION_KEY, JSON.stringify({ id: parsed.id, lastActivity: now }));
        return parsed.id;
      }
    }
    const id = newId();
    target.setItem(SESSION_KEY, JSON.stringify({ id, lastActivity: now }));
    return id;
  } catch {
    return newId();
  }
}

function safeSessionStorage(): KeyValueStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
