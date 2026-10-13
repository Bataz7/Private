alter table guild_settings add column if not exists custom_statuses jsonb not null default '[]'::jsonb;
alter table guild_settings add column if not exists custom_status_interval integer not null default 30;
