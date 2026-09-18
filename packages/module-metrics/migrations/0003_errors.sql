alter table metrics.events add column error_fingerprint text;

create index metrics_events_error_fp_idx on metrics.events (error_fingerprint, occurred_at desc)
  where error_fingerprint is not null;

create table metrics.error_issues (
  fingerprint      text primary key,
  error_type       text not null,
  message_template text not null,
  route            text,
  issue_count      bigint not null default 0,
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  first_release    text,
  last_release     text
);
