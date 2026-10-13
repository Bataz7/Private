-- Staff Management Bot — Supabase schema

create table guild_settings (
  guild_id         text primary key,
  staff_role_id    text not null,
  on_shift_role_id text not null,
  leave_role_id    text not null,
  management_role_id text not null,
  shift_channel_id text not null,
  leave_channel_id text not null,
  resignation_channel_id text not null,
  logs_channel_id  text not null,
  report_channel_id text,
  created_at       timestamp with time zone default now(),
  updated_at       timestamp with time zone default now()
);

create table staff (
  id         bigint generated always as identity primary key,
  guild_id   text not null,
  user_id    text not null,
  joined_at  timestamp with time zone default now(),
  active     boolean default true,
  created_at timestamp with time zone default now(),
  unique (guild_id, user_id)
);

create index on staff (guild_id);
create index on staff (user_id);

create table shifts (
  id          bigint generated always as identity primary key,
  guild_id    text not null,
  user_id     text not null,
  started_at  timestamp with time zone not null,
  ended_at    timestamp with time zone,
  status      text not null default 'active' check (status in ('active', 'ended')),
  breaks      jsonb default '[]'::jsonb,
  created_at  timestamp with time zone default now(),
  updated_at  timestamp with time zone default now()
);

create index on shifts (guild_id);
create index on shifts (user_id);
create index on shifts (status);
create unique index shifts_active_per_user on shifts (guild_id, user_id) where status = 'active';

create table leave_requests (
  id               bigint generated always as identity primary key,
  guild_id         text not null,
  user_id          text not null,
  start_date       timestamp with time zone not null,
  end_date         timestamp with time zone not null,
  reason           text not null,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'returned')),
  previous_role_ids text[] default '{}',
  leave_role_id    text,
  reviewed_by      text,
  reviewed_at      timestamp with time zone,
  returned_at      timestamp with time zone,
  rejection_reason text,
  created_at       timestamp with time zone default now(),
  updated_at       timestamp with time zone default now()
);

create index on leave_requests (guild_id);
create index on leave_requests (user_id);
create index on leave_requests (status);

create table resignation_requests (
  id               bigint generated always as identity primary key,
  guild_id         text not null,
  user_id          text not null,
  last_working_day timestamp with time zone not null,
  reason           text not null,
  notes            text default '',
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  reviewed_by      text,
  reviewed_at      timestamp with time zone,
  rejection_reason text,
  created_at       timestamp with time zone default now(),
  updated_at       timestamp with time zone default now()
);

create index on resignation_requests (guild_id);
create index on resignation_requests (user_id);
create index on resignation_requests (status);

create table reports (
  id          bigint generated always as identity primary key,
  guild_id    text not null,
  user_id     text not null,
  title       text not null,
  content     text not null,
  type        text not null default 'general' check (type in ('shift_summary', 'incident', 'general')),
  shift_id    bigint references shifts(id),
  status      text not null default 'submitted' check (status in ('submitted', 'reviewed')),
  reviewed_by text,
  reviewed_at timestamp with time zone,
  created_at  timestamp with time zone default now(),
  updated_at  timestamp with time zone default now()
);

create index on reports (guild_id);
create index on reports (user_id);
create index on reports (type);
create index on reports (status);

create table staff_logs (
  id        bigint generated always as identity primary key,
  guild_id  text not null,
  action    text not null,
  user_id   text not null,
  actor_id  text,
  details   jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

create index on staff_logs (guild_id);
create index on staff_logs (action);
create index on staff_logs (user_id);

-- Auto-update updated_at
create or replace function update_updated_at()
  returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger guild_settings_updated_at
  before update on guild_settings
  for each row execute function update_updated_at();

create trigger shifts_updated_at
  before update on shifts
  for each row execute function update_updated_at();

create trigger leave_requests_updated_at
  before update on leave_requests
  for each row execute function update_updated_at();

create trigger resignation_requests_updated_at
  before update on resignation_requests
  for each row execute function update_updated_at();

create trigger reports_updated_at
  before update on reports
  for each row execute function update_updated_at();
