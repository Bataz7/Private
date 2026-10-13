-- Staff applications (recruitment): form builder, DM / web delivery, review with votes, responses.
-- Idempotent: safe to run more than once.

-- Shared trigger function (also created by 001); recreated here so this file works on its own.
create or replace function update_updated_at()
  returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

-- One row per form. `questions` and `settings` are validated by src/applications/questions.ts before saving.
create table if not exists application_forms (
  id                 uuid primary key default gen_random_uuid(),
  guild_id           text not null,
  title              text not null,
  description        text not null default '',
  open               boolean not null default false,
  questions          jsonb not null default '[]'::jsonb,
  settings           jsonb not null default '{}'::jsonb,
  panel_channel_id   text not null default '',
  panel_message_id   text not null default '',
  created_by         text not null default '',
  updated_by         text not null default '',
  created_at         timestamp with time zone not null default now(),
  updated_at         timestamp with time zone not null default now()
);

create index if not exists application_forms_guild_idx on application_forms (guild_id, created_at desc);

-- One submission (or a DM session in progress). `questions` is a snapshot, so later form edits never change old responses.
create table if not exists applications (
  id                 uuid primary key default gen_random_uuid(),
  guild_id           text not null,
  form_id            uuid not null references application_forms(id) on delete cascade,
  form_title         text not null default '',
  user_id            text not null,
  username           text not null default '',
  display_name       text not null default '',
  avatar             text not null default '',
  source             text not null check (source in ('dm', 'web')),
  status             text not null default 'in_progress' check (status in ('in_progress', 'pending', 'accepted', 'rejected', 'cancelled', 'expired')),
  questions          jsonb not null default '[]'::jsonb,
  answers            jsonb not null default '{}'::jsonb,
  cursor             text not null default '',
  editing            boolean not null default false,
  prompt_message_id  text not null default '',
  dm_channel_id      text not null default '',
  last_activity_at   timestamp with time zone not null default now(),
  timeout_minutes    integer not null default 30,
  submitted_at       timestamp with time zone,
  reviewed_by        text,
  reviewed_at        timestamp with time zone,
  decision_reason    text not null default '',
  review_channel_id  text not null default '',
  review_message_id  text not null default '',
  review_thread_id   text not null default '',
  notes              jsonb not null default '[]'::jsonb,
  votes              jsonb not null default '[]'::jsonb,
  account_created_at timestamp with time zone,
  member_joined_at   timestamp with time zone,
  meta               jsonb not null default '{}'::jsonb,
  created_at         timestamp with time zone not null default now(),
  updated_at         timestamp with time zone not null default now()
);

create index if not exists applications_form_status_idx on applications (guild_id, form_id, status);
create index if not exists applications_user_form_idx on applications (guild_id, user_id, form_id);
create index if not exists applications_user_status_idx on applications (user_id, status);
create index if not exists applications_activity_idx on applications (status, last_activity_at);
create index if not exists applications_submitted_idx on applications (guild_id, submitted_at desc);

-- At most one open DM session per person, enforced by the database rather than by timing.
create unique index if not exists one_in_progress_per_user on applications (user_id) where status = 'in_progress';
-- At most one pending application per form per person.
create unique index if not exists one_pending_per_form on applications (form_id, user_id) where status = 'pending';

drop trigger if exists application_forms_updated_at on application_forms;
create trigger application_forms_updated_at
  before update on application_forms
  for each row execute function update_updated_at();

drop trigger if exists applications_updated_at on applications;
create trigger applications_updated_at
  before update on applications
  for each row execute function update_updated_at();

-- Counts per form and status for the dashboard (avoids pulling every row through the API row limit).
create or replace function application_status_counts(p_guild_id text)
  returns table (form_id uuid, status text, n bigint) as $$
  select a.form_id, a.status, count(*)::bigint
  from applications a
  where a.guild_id = p_guild_id
  group by a.form_id, a.status;
$$ language sql stable;

-- Only the service key (the bot and the dashboard server) touches these tables.
alter table application_forms enable row level security;
alter table applications enable row level security;
