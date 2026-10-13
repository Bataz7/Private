create table if not exists staff_reports (
  id bigint generated always as identity primary key,
  guild_id text not null,
  staff_user_id text not null,
  author_user_id text not null,
  period_start date not null,
  period_end date not null,
  note text not null default '',
  shift_hours numeric not null default 0,
  helped integer not null default 0,
  message_count integer not null default 0,
  active_days integer not null default 0,
  points integer not null default 0,
  voice_hours numeric not null default 0,
  complaints integer not null default 0,
  created_at timestamp with time zone default now(),
  unique (guild_id, staff_user_id, period_start)
);
create index if not exists staff_reports_guild_idx on staff_reports (guild_id);
