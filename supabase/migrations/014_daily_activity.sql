create table if not exists staff_daily_activity (
  id bigint generated always as identity primary key,
  guild_id text not null,
  user_id text not null,
  activity_date date not null default current_date,
  active_minutes integer not null default 0,
  message_count integer not null default 0,
  last_message_at timestamp with time zone,
  unique (guild_id, user_id, activity_date)
);
create index if not exists staff_daily_activity_lookup on staff_daily_activity (guild_id, user_id, activity_date);
