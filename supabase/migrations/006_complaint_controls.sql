alter table guild_settings add column if not exists complaint_channel_id text;
alter table complaints add column if not exists penalty_points integer not null default 0;
