alter table staff_reports add column if not exists activity_hours numeric not null default 0;
alter table staff_reports add column if not exists automated boolean not null default false;
alter table staff_reports drop constraint if exists staff_reports_guild_id_staff_user_id_period_start_key;
create unique index if not exists staff_reports_automated_period_idx on staff_reports (guild_id, staff_user_id, period_start) where automated = true;