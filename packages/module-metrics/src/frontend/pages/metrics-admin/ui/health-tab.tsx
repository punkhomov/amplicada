import type { ApiClient } from '@amplicada/platform-core/frontend';
import { useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Skeleton } from '@amplicada/platform-core/frontend/ui/skeleton';
import { metricsHealthQueryOptions } from '../../../lib/query-options.js';
import { formatBytes } from './format.js';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/** Здоровье модуля: объёмы данных, очередь, алерты и runtime-счётчики коллекторов. */
export function HealthTab({ api }: { api: ApiClient }) {
  const { t } = useTranslation('metrics');
  const query = useQuery(metricsHealthQueryOptions(api));
  const health = query.data;

  if (!health) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {['h1', 'h2', 'h3', 'h4'].map(id => (
          <Skeleton key={id} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={t('health_events_hour')}
          value={String(health.eventsByKind.reduce((sum, entry) => sum + entry.count, 0))}
          hint={health.eventsByKind.map(entry => `${entry.kind}: ${entry.count}`).join(' · ') || t('health_empty')}
        />
        <Stat
          label={t('health_storage')}
          value={formatBytes(health.storage.totalBytes)}
          hint={health.storage.tables
            .slice(0, 3)
            .map(table => `${table.name}: ${formatBytes(table.bytes)}`)
            .join(' · ')}
        />
        <Stat
          label={t('health_series')}
          value={String(health.seriesCount)}
          hint={t('health_rows_hint', {
            events: health.approximateRows.events,
            points: health.approximateRows.points,
          })}
        />
        <Stat label={t('health_outbox')} value={`${health.outbox.pending} / ${health.outbox.dead}`} hint={t('health_outbox_hint')} />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat label={t('health_ingest_accepted')} value={String(health.ingest.accepted)} />
        <Stat label={t('health_ingest_rejected')} value={String(health.ingest.rejected)} />
        <Stat label={t('health_ingest_duplicates')} value={String(health.ingest.duplicates)} />
        <Stat label={t('health_rate_limited')} value={String(health.ingest.rateLimited)} />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={t('health_buffer')}
          value={String(health.runtime.bufferSize)}
          hint={t('health_buffer_hint', { overflow: health.runtime.bufferOverflow })}
        />
        <Stat
          label={t('health_last_flush')}
          value={health.runtime.lastFlushAt ? new Date(health.runtime.lastFlushAt).toLocaleTimeString() : '—'}
          hint={t('health_flush_errors', { count: health.runtime.flushErrors })}
        />
        <Stat
          label={t('health_last_dispatch')}
          value={health.runtime.lastDispatchAt ? new Date(health.runtime.lastDispatchAt).toLocaleTimeString() : '—'}
        />
        <Stat label={t('health_alerts')} value={`${health.alerts.firing} / ${health.alerts.pending}`} hint={t('health_alerts_hint')} />
      </section>

      <p className="text-xs text-muted-foreground">{t('health_hint')}</p>

      {health.storage.tables.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('health_tables')}</h3>
          <div className="flex flex-wrap gap-2">
            {health.storage.tables.map(table => (
              <Badge key={table.name} variant="secondary" className="font-mono text-xs">
                {table.name}: {formatBytes(table.bytes)}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
