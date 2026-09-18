create table metrics.alert_rules (
  id          uuid primary key,
  name        text not null,
  enabled     boolean not null default true,
  severity    text not null default 'warning',
  target      jsonb not null,
  window_ms   bigint not null,
  condition   jsonb not null,
  delivery    jsonb not null default '{"eventBus": true}'::jsonb,
  labels      jsonb not null default '{}'::jsonb,
  annotations jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table metrics.alert_instances (
  rule_id      uuid not null references metrics.alert_rules(id) on delete cascade,
  fingerprint  text not null,
  state        text not null,
  value        double precision,
  labels       jsonb not null default '{}'::jsonb,
  active_at    timestamptz not null,
  last_eval_at timestamptz not null default now(),
  resolved_at  timestamptz,
  primary key (rule_id, fingerprint)
);

create table metrics.alert_events (
  id       bigint generated always as identity primary key,
  rule_id  uuid not null,
  state    text not null,
  severity text not null,
  value    double precision,
  labels   jsonb not null default '{}'::jsonb,
  message  text,
  at       timestamptz not null default now()
);

create index metrics_alert_events_at_idx on metrics.alert_events (at desc);
