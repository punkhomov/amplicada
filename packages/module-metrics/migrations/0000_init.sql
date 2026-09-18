create schema if not exists metrics;

create table metrics.settings (
  id                       text primary key default 'default' check (id = 'default'),
  enabled                  boolean not null default true,
  retention_events_days    integer not null default 30,
  sample_pageview_rate     real    not null default 1.0,
  sample_click_rate        real    not null default 0.10,
  store_raw_urls           boolean not null default false,
  updated_at               timestamptz not null default now()
);

insert into metrics.settings (id) values ('default') on conflict do nothing;

create table metrics.events (
  id             uuid        not null,
  occurred_at    timestamptz not null,
  received_at    timestamptz not null default now(),
  name           text        not null,
  kind           text        not null,
  module         text,
  actor_kind     text,
  actor_hash     text,
  session_hash   text,
  route          text,
  url            text,
  referrer       text,
  release        text,
  instance       text,
  attributes     jsonb       not null default '{}'::jsonb,
  measures       jsonb       not null default '{}'::jsonb,
  sampling_rate  real,
  schema_version integer     not null default 1,
  primary key (occurred_at, id)
) partition by range (occurred_at);

create index metrics_events_name_time_idx on metrics.events (name, occurred_at desc);
create index metrics_events_actor_time_idx on metrics.events (actor_hash, occurred_at desc) where actor_hash is not null;
create index metrics_events_session_time_idx on metrics.events (session_hash, occurred_at) where session_hash is not null;
create index metrics_events_time_brin on metrics.events using brin (occurred_at) with (pages_per_range = 32);

do $$
declare
  start_month date := date_trunc('month', now())::date;
  range_from date;
  range_to date;
  part_name text;
  i integer;
begin
  for i in 0..2 loop
    range_from := (start_month + make_interval(months => i))::date;
    range_to := (range_from + interval '1 month')::date;
    part_name := 'events_' || to_char(range_from, 'YYYY_MM');
    execute format(
      'create table if not exists metrics.%I partition of metrics.events for values from (%L) to (%L)',
      part_name, range_from, range_to
    );
  end loop;
end $$;
