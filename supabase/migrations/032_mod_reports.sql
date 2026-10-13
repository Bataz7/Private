-- 032: Moderation reports. Safe to run more than once.

-- Per-server settings (channels, roles, points, panel messages) kept as one JSON document.
create table if not exists mod_report_settings (
  guild_id   text primary key,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now()
);

-- One counter row per server; the insert trigger below bumps it atomically, so report numbers are race-safe.
create table if not exists mod_report_counters (
  guild_id    text primary key,
  last_number integer not null default 0
);

create table if not exists mod_reports (
  id                bigint generated always as identity primary key,
  guild_id          text not null,
  number            integer not null default 0,
  moderator_id      text not null,
  moderator_name    text not null default '',
  target_user_id    text not null,
  target_tag        text not null default '',
  target_avatar     text not null default '',
  action            text not null check (action in ('warn', 'mute', 'kick', 'ban', 'unban', 'other')),
  reason            text not null,
  duration          text not null default '',
  evidence          text not null default '',
  flags             jsonb not null default '[]'::jsonb,
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by       text,
  reviewed_at       timestamp with time zone,
  points_applied    integer not null default 0,
  notes             jsonb not null default '[]'::jsonb,
  review_channel_id text not null default '',
  review_message_id text not null default '',
  lang              text not null default 'en' check (lang in ('ar', 'en')),
  created_at        timestamp with time zone not null default now(),
  updated_at        timestamp with time zone not null default now()
);

create unique index if not exists mod_reports_guild_number_idx on mod_reports (guild_id, number);
create index if not exists mod_reports_guild_status_idx on mod_reports (guild_id, status, created_at desc);
create index if not exists mod_reports_target_idx on mod_reports (guild_id, target_user_id);
create index if not exists mod_reports_moderator_idx on mod_reports (guild_id, moderator_id, created_at desc);

-- Sequential per-server numbers (#0001, #0002 ...). The counter row is locked by the upsert, so two reports that
-- arrive together always get different numbers, and a failed insert rolls its number back with it.
create or replace function mod_reports_assign_number() returns trigger
language plpgsql as $$
begin
  insert into mod_report_counters as counter (guild_id, last_number)
  values (new.guild_id, coalesce((select max(number) from mod_reports where guild_id = new.guild_id), 0) + 1)
  on conflict (guild_id) do update set last_number = counter.last_number + 1
  returning counter.last_number into new.number;
  return new;
end;
$$;

drop trigger if exists mod_reports_number on mod_reports;
create trigger mod_reports_number
  before insert on mod_reports
  for each row execute function mod_reports_assign_number();

drop trigger if exists mod_reports_updated_at on mod_reports;
create trigger mod_reports_updated_at
  before update on mod_reports
  for each row execute function update_updated_at();

-- Atomic points change for the moderator (never below zero). Returns the new total, or null when the person has no
-- staff row yet. TODO(points-ledger): once the points ledger (changePoints) is in use, the bot can call that instead.
create or replace function mod_report_adjust_points(p_guild_id text, p_user_id text, p_delta integer) returns integer
language plpgsql as $$
declare
  total integer;
begin
  update staff
     set points = greatest(0, points + p_delta)
   where guild_id = p_guild_id and user_id = p_user_id
  returning points into total;
  return total;
end;
$$;

-- Make the new tables and functions visible to the API right away.
notify pgrst, 'reload schema';
