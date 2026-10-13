alter table guild_settings add column if not exists rating_channel_id text;
alter table staff_reports add column if not exists rating_average numeric not null default 0;
alter table staff_reports add column if not exists rating_count integer not null default 0;