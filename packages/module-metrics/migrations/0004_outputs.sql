create table metrics.sink_configs (
  id         text primary key,
  enabled    boolean not null default false,
  settings   jsonb not null default '{}'::jsonb,
  mapping    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into metrics.sink_configs (id) values ('webhook'), ('yandex-metrica') on conflict do nothing;

create table metrics.outbox (
  id              bigint generated always as identity primary key,
  sink_id         text not null,
  item_kind       text not null,
  item_id         text not null,
  payload         jsonb not null,
  status          text not null default 'pending',
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  unique (sink_id, item_id)
);

create index metrics_outbox_due_idx on metrics.outbox (status, next_attempt_at) where status = 'pending';

create table metrics.sink_deliveries (
  id       bigint generated always as identity primary key,
  sink_id  text not null,
  item_id  text not null,
  status   text not null,
  attempts integer not null,
  error    text,
  at       timestamptz not null default now()
);

create index metrics_sink_deliveries_at_idx on metrics.sink_deliveries (sink_id, at desc);
