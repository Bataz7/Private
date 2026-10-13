alter table guild_settings add column if not exists help_commands text[] not null default array['ساعدني'];
