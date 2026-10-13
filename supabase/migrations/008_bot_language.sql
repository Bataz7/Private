alter table guild_settings add column bot_language text not null default 'en' check (bot_language in ('en', 'ar'));
