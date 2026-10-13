-- Weekly report settings per server, bot presence lines, and the tables behind the public status page.
-- Idempotent: safe to run more than once. (Status posts are in 035_status_posts.sql.)

-- ---- Weekly reports (weekly_enabled, weekly_language and weekly_last_run come from 028) ----
alter table guild_settings add column if not exists weekly_dm_staff boolean not null default true;
alter table guild_settings add column if not exists weekly_dm_summary boolean not null default true;
alter table guild_settings add column if not exists weekly_recipients text not null default 'all';
alter table guild_settings add column if not exists weekly_staff_ids jsonb not null default '[]'::jsonb;
-- null = use report_channel_id; '' = do not post a team summary
alter table guild_settings add column if not exists weekly_channel_id text;
alter table guild_settings add column if not exists weekly_targets jsonb not null default '{}'::jsonb;
alter table guild_settings add column if not exists weekly_enabled boolean not null default true;
alter table guild_settings add column if not exists weekly_language text;
alter table guild_settings add column if not exists weekly_last_run text;

-- ---- Bot presence: one line per entry { text, type }, and the rotation order ----
alter table guild_settings add column if not exists presence_entries jsonb;
alter table guild_settings add column if not exists custom_status_mode text not null default 'sequence';
alter table guild_settings add column if not exists custom_status_type text not null default 'playing';
alter table guild_settings add column if not exists custom_status_url text not null default '';

-- ---- Bot heartbeat: one row, updated every 15 seconds by the bot ----
create table if not exists bot_heartbeats (
  key           text primary key,
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  ping_ms       integer not null default 0,
  guilds        integer not null default 0,
  memory_mb     integer not null default 0,
  node_version  text not null default '',
  active_shifts integer not null default 0,
  watchdogs     jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz,
  stopped_at    timestamptz,
  alerted_for   timestamptz,
  stall_since   timestamptz,
  ready         boolean not null default true
);

-- ---- Restarts and downtime ----
create table if not exists bot_status_events (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('downtime', 'restart')),
  started_at timestamptz not null,
  ended_at   timestamptz,
  note       text not null default ''
);
create index if not exists bot_status_events_started_idx on bot_status_events (started_at desc);

-- ---- One metrics sample per process per minute (the bot prunes rows older than 91 days) ----
create table if not exists status_samples (
  id     bigint generated always as identity primary key,
  t      timestamptz not null,
  source text not null check (source in ('bot', 'dashboard')),
  cpu    numeric not null default 0,
  mem    numeric not null default 0,
  ping   numeric not null default 0,
  db_ms  numeric not null default 0
);
create index if not exists status_samples_source_t_idx on status_samples (source, t desc);
create index if not exists status_samples_t_idx on status_samples (t);

-- ---- Planned maintenance ----
create table if not exists status_maintenances (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null default '',
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  affects     jsonb not null default '[]'::jsonb,
  updates     jsonb not null default '[]'::jsonb,
  ended_early boolean not null default false,
  ended_at    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists status_maintenances_starts_idx on status_maintenances (starts_at desc);

-- The service key bypasses row level security; switching it on keeps these tables closed to anonymous API access.
alter table bot_heartbeats enable row level security;
alter table bot_status_events enable row level security;
alter table status_samples enable row level security;
alter table status_maintenances enable row level security;

-- ---- Aggregations used by the status page ----
-- Minutes with at least one sample per UTC day (a process that is down stores nothing, so gaps are downtime).
create or replace function status_coverage(p_sources text[], p_from timestamptz)
returns table(day date, minutes integer)
language sql stable as $$
  select (m.minute at time zone 'utc')::date as day, count(*)::integer as minutes
  from (select distinct date_trunc('minute', t) as minute from status_samples where source = any(p_sources) and t >= p_from) m
  group by 1 order by 1;
$$;

-- Averages per time bucket for the speed charts.
create or replace function status_metrics(p_source text, p_from timestamptz, p_bucket_seconds integer)
returns table(bucket bigint, cpu numeric, mem numeric, ping numeric, db_ms numeric)
language sql stable as $$
  select (floor(extract(epoch from t) / p_bucket_seconds) * p_bucket_seconds * 1000)::bigint as bucket,
         avg(cpu), avg(mem), avg(ping), avg(db_ms)
  from status_samples where source = p_source and t >= p_from
  group by 1 order by 1;
$$;
