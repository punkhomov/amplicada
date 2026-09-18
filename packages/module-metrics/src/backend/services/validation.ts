import {
  type ClientEventContext,
  type ClientEventInput,
  METRIC_EVENT_KINDS,
  type MetricAttrValue,
  type MetricEventKind,
} from '../../contracts/index.js';

/** Лимиты приёма: защита от мусора, PII-раздувания и кардинального взрыва. */
export interface EventLimits {
  maxEventBytes: number;
  maxAttributes: number;
  maxMeasures: number;
  maxStringLength: number;
  maxNameLength: number;
  maxRouteLength: number;
  maxReferrerLength: number;
  maxSessionIdLength: number;
  maxEventsPerBatch: number;
  storeRawUrls: boolean;
}

export const DEFAULT_EVENT_LIMITS: EventLimits = {
  maxEventBytes: 8192,
  maxAttributes: 32,
  maxMeasures: 16,
  maxStringLength: 256,
  maxNameLength: 100,
  maxRouteLength: 256,
  maxReferrerLength: 512,
  maxSessionIdLength: 64,
  maxEventsPerBatch: 500,
  storeRawUrls: false,
};

const NAME_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
/** id события — uuid: PK журнала и ключ идемпотентности должен совпадать с типом колонки. */
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;

export interface ValidatedEvent {
  event: ClientEventInput;
  /** Сколько атрибутов отброшено/обрезано. */
  overflow: number;
}

export type ValidateResult = { ok: true; value: ValidatedEvent } | { ok: false; reason: string };

function stringField(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;
}

function sanitizeAttributes(raw: unknown, limits: EventLimits): { attributes: Record<string, MetricAttrValue>; overflow: number } {
  const attributes: Record<string, MetricAttrValue> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { attributes, overflow: 0 };

  let overflow = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(attributes).length >= limits.maxAttributes) {
      overflow += 1;
      continue;
    }
    if (!KEY_RE.test(key)) {
      overflow += 1;
      continue;
    }
    if (typeof value === 'string') {
      attributes[key] = value.length > limits.maxStringLength ? value.slice(0, limits.maxStringLength) : value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      attributes[key] = value;
    } else if (typeof value === 'boolean') {
      attributes[key] = value;
    } else {
      overflow += 1;
    }
  }
  return { attributes, overflow };
}

function sanitizeMeasures(raw: unknown, limits: EventLimits): Record<string, number> {
  const measures: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return measures;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(measures).length >= limits.maxMeasures) break;
    if (!KEY_RE.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) measures[key] = value;
  }
  return measures;
}

export function validateClientEvent(raw: unknown, limits: EventLimits = DEFAULT_EVENT_LIMITS): ValidateResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not_object' };
  const input = raw as Record<string, unknown>;

  const id = typeof input.id === 'string' && ID_RE.test(input.id) ? input.id : null;
  if (!id) return { ok: false, reason: 'invalid_id' };

  const name = typeof input.name === 'string' && input.name.length <= limits.maxNameLength && NAME_RE.test(input.name) ? input.name : null;
  if (!name) return { ok: false, reason: 'invalid_name' };

  const kind =
    typeof input.kind === 'string' && (METRIC_EVENT_KINDS as readonly string[]).includes(input.kind)
      ? (input.kind as MetricEventKind)
      : null;
  if (!kind) return { ok: false, reason: 'invalid_kind' };

  const occurredRaw = typeof input.occurredAt === 'string' ? new Date(input.occurredAt) : null;
  if (!occurredRaw || Number.isNaN(occurredRaw.getTime())) return { ok: false, reason: 'invalid_occurred_at' };
  const now = Date.now();
  if (occurredRaw.getTime() < now - MAX_PAST_MS) return { ok: false, reason: 'too_old' };
  const occurredAt = new Date(Math.min(occurredRaw.getTime(), now + MAX_FUTURE_SKEW_MS));

  const contextInput = (input.context && typeof input.context === 'object' && !Array.isArray(input.context) ? input.context : {}) as Record<
    string,
    unknown
  >;
  const context: ClientEventContext = {
    route: stringField(contextInput.route, limits.maxRouteLength),
    referrer: stringField(contextInput.referrer, limits.maxReferrerLength),
  };
  if (limits.storeRawUrls) {
    const url = stringField(contextInput.url, 2048);
    if (url) context.url = url;
  }

  const { attributes, overflow } = sanitizeAttributes(input.attributes, limits);
  const measures = sanitizeMeasures(input.measures, limits);

  const sessionId = stringField(input.sessionId, limits.maxSessionIdLength);

  let sampling: ClientEventInput['sampling'];
  if (input.sampling && typeof input.sampling === 'object' && !Array.isArray(input.sampling)) {
    const rate = (input.sampling as Record<string, unknown>).rate;
    if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 1) {
      const reason = (input.sampling as Record<string, unknown>).reason;
      sampling = { rate, reason: typeof reason === 'string' ? reason.slice(0, 64) : undefined };
    }
  }

  const event: ClientEventInput = {
    id,
    name,
    kind,
    occurredAt: occurredAt.toISOString(),
    sessionId,
    context,
    attributes,
    measures: Object.keys(measures).length > 0 ? measures : undefined,
    sampling,
  };

  if (Buffer.byteLength(JSON.stringify(event)) > limits.maxEventBytes) {
    return { ok: false, reason: 'too_large' };
  }

  return { ok: true, value: { event, overflow } };
}

export interface BatchValidation {
  accepted: ClientEventInput[];
  rejected: { index: number; reason: string }[];
  overflow: number;
}

export function validateBatch(raw: unknown, limits: EventLimits = DEFAULT_EVENT_LIMITS): BatchValidation {
  const events =
    raw && typeof raw === 'object' && Array.isArray((raw as { events?: unknown }).events) ? (raw as { events: unknown[] }).events : null;
  if (!events) return { accepted: [], rejected: [{ index: 0, reason: 'invalid_body' }], overflow: 0 };

  const accepted: ClientEventInput[] = [];
  const rejected: { index: number; reason: string }[] = [];
  let overflow = 0;

  events.forEach((event, index) => {
    if (index >= limits.maxEventsPerBatch) {
      rejected.push({ index, reason: 'batch_too_large' });
      return;
    }
    const result = validateClientEvent(event, limits);
    if (result.ok) {
      accepted.push(result.value.event);
      overflow += result.value.overflow;
    } else {
      rejected.push({ index, reason: result.reason });
    }
  });

  return { accepted, rejected, overflow };
}
