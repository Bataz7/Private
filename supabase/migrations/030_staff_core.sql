-- 030 Staff core: points ledger, assists, warnings, dashboard notifications, staff notes and persistent profiles.
-- Idempotent: safe to run more than once. Run it in the Supabase SQL editor.

-- ---------------------------------------------------------------------------------------------------
-- Points ledger: every change to staff.points is written here by change_staff_points(), so the dashboard can
-- show where points came from and who changed them.
-- ---------------------------------------------------------------------------------------------------
create table if not exists points_ledger (
  id            bigint generated always as identity primary key,
  guild_id      text not null,
  user_id       text not null,
  delta         integer not null,
  points_before integer not null default 0,
  points_after  integer not null default 0,
  source        text not null default 'manual',
  reason        text not null default '',
  actor_id      text,
  ref           text,
  created_at    timestamp with time zone not null default now()
);
create index if not exists points_ledger_user_idx on points_ledger (guild_id, user_id, created_at desc);
create index if not exists points_ledger_guild_idx on points_ledger (guild_id, created_at desc);

-- One atomic change, clamped at zero. Returns {"before": n, "after": n}, or null when the member is not on staff.
-- p_claimed lets a help credit raise the "people helped" counter in the same statement.
create or replace function change_staff_points(
  p_guild text, p_user text, p_delta integer,
  p_source text default 'manual', p_reason text default '', p_actor text default null, p_ref text default null,
  p_claimed integer default 0
) returns jsonb
language plpgsql
as $$
declare
  v_before integer;
  v_after integer;
begin
  select coalesce(points, 0) into v_before from staff where guild_id = p_guild and user_id = p_user for update;
  if not found then return null; end if;
  v_after := greatest(0, v_before + coalesce(p_delta, 0));
  if v_after <> v_before or coalesce(p_claimed, 0) <> 0 then
    update staff set points = v_after, claimed = greatest(0, coalesce(claimed, 0) + coalesce(p_claimed, 0))
      where guild_id = p_guild and user_id = p_user;
  end if;
  if v_after <> v_before then
    insert into points_ledger (guild_id, user_id, delta, points_before, points_after, source, reason, actor_id, ref)
    values (p_guild, p_user, v_after - v_before, v_before, v_after, coalesce(nullif(p_source, ''), 'manual'), left(coalesce(p_reason, ''), 300), p_actor, p_ref);
  end if;
  return jsonb_build_object('before', v_before, 'after', v_after);
end;
$$;

-- Where a member's points came from. Shifts, ratings, complaints and helps are counted from their own tables
-- (so older points are explained too); everything else comes from the ledger; the rest is "manual & older".
create or replace function staff_points_breakdown(p_guild text, p_user text) returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'total',         (select coalesce(points, 0) from staff where guild_id = p_guild and user_id = p_user),
    'claimed',       (select coalesce(claimed, 0) from staff where guild_id = p_guild and user_id = p_user),
    'shift',         coalesce((select sum(coalesce(points_awarded, 0)) from shifts where guild_id = p_guild and user_id = p_user), 0),
    'shiftCount',    coalesce((select count(*) from shifts where guild_id = p_guild and user_id = p_user and coalesce(points_awarded, 0) > 0), 0),
    'messages',      coalesce((select sum(coalesce(interaction_points_awarded, 0)) from shifts where guild_id = p_guild and user_id = p_user), 0),
    'voice',         coalesce((select sum(coalesce(voice_points_awarded, 0)) from shifts where guild_id = p_guild and user_id = p_user), 0),
    'ratingPoints',  coalesce((select sum(case rating when 5 then 3 when 4 then 2 when 3 then 1 else 0 end) from staff_ratings where guild_id = p_guild and staff_user_id = p_user), 0),
    'ratingCount',   coalesce((select count(*) from staff_ratings where guild_id = p_guild and staff_user_id = p_user), 0),
    'complaint',     coalesce((select sum(coalesce(penalty_points, 0)) from complaints where guild_id = p_guild and staff_user_id = p_user and status = 'approved'), 0),
    'complaintCount',coalesce((select count(*) from complaints where guild_id = p_guild and staff_user_id = p_user and status = 'approved'), 0),
    'ledger',        coalesce((select jsonb_object_agg(source, jsonb_build_object('points', points, 'n', n))
                               from (select source, sum(delta) as points, count(*) as n from points_ledger where guild_id = p_guild and user_id = p_user group by source) t), '{}'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------------------------------
-- Assists: "I helped this member" logs (+1 point each, limited per day and per member).
-- ---------------------------------------------------------------------------------------------------
create table if not exists assistances (
  id               bigint generated always as identity primary key,
  guild_id         text not null,
  staff_user_id    text not null,
  member_user_id   text not null,
  type             text not null default 'General Support',
  note             text not null default '',
  feedback         text,
  feedback_reason  text,
  created_at       timestamp with time zone not null default now()
);
create index if not exists assistances_staff_idx on assistances (guild_id, staff_user_id, created_at desc);
create index if not exists assistances_pair_idx on assistances (guild_id, staff_user_id, member_user_id, created_at desc);

-- ---------------------------------------------------------------------------------------------------
-- Staff warnings
-- ---------------------------------------------------------------------------------------------------
create table if not exists staff_warnings (
  id             bigint generated always as identity primary key,
  guild_id       text not null,
  staff_user_id  text not null,
  reason         text not null,
  issued_by      text not null,
  automatic      boolean not null default false,
  active         boolean not null default true,
  created_at     timestamp with time zone not null default now()
);
create index if not exists staff_warnings_staff_idx on staff_warnings (guild_id, staff_user_id, active);

-- ---------------------------------------------------------------------------------------------------
-- Dashboard notifications (one row per recipient; recipient_user_id null = visible to every staff member)
-- ---------------------------------------------------------------------------------------------------
create table if not exists staff_notifications (
  id                 bigint generated always as identity primary key,
  guild_id           text not null,
  recipient_user_id  text,
  sender_user_id     text not null,
  sender_name        text not null default '',
  type               text not null default 'admin_note',
  level              text not null default 'info' check (level in ('info', 'warning', 'important')),
  delivery           text not null default 'both' check (delivery in ('dashboard', 'discord', 'both')),
  title              text not null default '',
  message            text not null,
  link               text not null default '',
  read_by            jsonb not null default '[]'::jsonb,
  created_at         timestamp with time zone not null default now(),
  updated_at         timestamp with time zone not null default now()
);
create index if not exists staff_notifications_recipient_idx on staff_notifications (guild_id, recipient_user_id, created_at desc);
drop trigger if exists staff_notifications_updated_at on staff_notifications;
create trigger staff_notifications_updated_at before update on staff_notifications for each row execute function update_updated_at();

-- ---------------------------------------------------------------------------------------------------
-- Private staff notes (administrators only)
-- ---------------------------------------------------------------------------------------------------
create table if not exists staff_notes (
  id          bigint generated always as identity primary key,
  guild_id    text not null,
  user_id     text not null,
  text        text not null,
  added_by    text not null default '',
  added_by_id text,
  created_at  timestamp with time zone not null default now()
);
create index if not exists staff_notes_user_idx on staff_notes (guild_id, user_id, created_at desc);

-- ---------------------------------------------------------------------------------------------------
-- Staff profile page: customisation, comments, reputation and views
-- ---------------------------------------------------------------------------------------------------
create table if not exists staff_profiles (
  id                     bigint generated always as identity primary key,
  guild_id               text not null,
  user_id                text not null,
  tagline                text not null default '',
  bio                    text not null default '',
  accent                 text not null default '',
  banner_url             text not null default '',
  show_feedback          boolean not null default true,
  show_connections       boolean not null default true,
  links                  jsonb not null default '[]'::jsonb,
  connections            jsonb not null default '[]'::jsonb,
  connections_synced_at  timestamp with time zone,
  updated_at             timestamp with time zone not null default now(),
  unique (guild_id, user_id)
);

create table if not exists profile_comments (
  id               bigint generated always as identity primary key,
  guild_id         text not null,
  profile_user_id  text not null,
  author_user_id   text not null,
  author_name      text not null default '',
  text             text not null,
  created_at       timestamp with time zone not null default now()
);
create index if not exists profile_comments_profile_idx on profile_comments (guild_id, profile_user_id, created_at desc);

create table if not exists profile_reps (
  id               bigint generated always as identity primary key,
  guild_id         text not null,
  profile_user_id  text not null,
  from_user_id     text not null,
  created_at       timestamp with time zone not null default now(),
  unique (guild_id, profile_user_id, from_user_id)
);

create table if not exists profile_views (
  id               bigint generated always as identity primary key,
  guild_id         text not null,
  profile_user_id  text not null,
  viewer_user_id   text not null,
  day              date not null default current_date,
  unique (guild_id, profile_user_id, viewer_user_id, day)
);
create index if not exists profile_views_profile_idx on profile_views (guild_id, profile_user_id);

-- Private data: only the bot and the dashboard (service key) may touch these tables.
alter table points_ledger enable row level security;
alter table assistances enable row level security;
alter table staff_warnings enable row level security;
alter table staff_notifications enable row level security;
alter table staff_notes enable row level security;
alter table staff_profiles enable row level security;
alter table profile_comments enable row level security;
alter table profile_reps enable row level security;
alter table profile_views enable row level security;
