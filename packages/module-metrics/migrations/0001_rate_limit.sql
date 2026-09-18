alter table metrics.settings
  add column ingest_events_per_minute integer not null default 600;
