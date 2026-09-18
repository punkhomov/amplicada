alter table metrics.settings
  add column retention_points_days integer not null default 30,
  add column slow_sql_threshold_ms integer not null default 1000,
  add column sample_sql_rate real not null default 1.0;

create table metrics.series (
  id          bigint generated always as identity primary key,
  instrument  text not null,
  kind        text not null,
  unit        text not null,
  boundaries  real[],
  dims        jsonb not null default '{}'::jsonb,
  dims_hash   text not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  unique (instrument, dims_hash)
);

create table metrics.points (
  series_id bigint not null references metrics.series(id),
  bucket    timestamptz not null,
  count     bigint not null default 0,
  sum       double precision not null default 0,
  min       double precision,
  max       double precision,
  histogram jsonb,
  primary key (bucket, series_id)
) partition by range (bucket);

create index metrics_points_series_idx on metrics.points (series_id, bucket desc);
create index metrics_points_bucket_brin on metrics.points using brin (bucket) with (pages_per_range = 32);

create table metrics.sql_fingerprints (
  fingerprint text primary key,
  query_text  text not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create table metrics.slow_queries (
  id          bigint generated always as identity not null,
  at          timestamptz not null,
  fingerprint text not null,
  query_text  text not null,
  route       text,
  duration_ms double precision not null,
  row_count   integer,
  error_code  text,
  request_id  text,
  primary key (at, id)
) partition by range (at);

create index metrics_slow_queries_at_brin on metrics.slow_queries using brin (at) with (pages_per_range = 32);

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

    part_name := 'points_' || to_char(range_from, 'YYYY_MM');
    execute format(
      'create table if not exists metrics.%I partition of metrics.points for values from (%L) to (%L)',
      part_name, range_from, range_to
    );

    part_name := 'slow_queries_' || to_char(range_from, 'YYYY_MM');
    execute format(
      'create table if not exists metrics.%I partition of metrics.slow_queries for values from (%L) to (%L)',
      part_name, range_from, range_to
    );
  end loop;
end $$;
