alter table guild_settings add column if not exists custom_status_type text not null default 'playing';
alter table guild_settings add column if not exists custom_status_url text not null default '';