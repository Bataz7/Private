-- Automatic shifts: per-server tuning (defaults: 20 messages inside 10 minutes starts a shift, 30 minutes idle ends it).
alter table guild_settings add column if not exists auto_shift_enabled boolean not null default true;
alter table guild_settings add column if not exists auto_shift_messages integer not null default 20;
alter table guild_settings add column if not exists auto_shift_window_minutes integer not null default 10;
alter table guild_settings add column if not exists auto_shift_idle_minutes integer not null default 30;

-- Weekly report v2: score, grade, rank and engagement are stored with each report.
alter table staff_reports add column if not exists score integer not null default 0;
alter table staff_reports add column if not exists grade text not null default 'D';
alter table staff_reports add column if not exists rank integer not null default 0;
alter table staff_reports add column if not exists engagement numeric not null default 0;
alter table staff_reports add column if not exists points_total integer not null default 0;

-- One weekly run per server and week, claimed atomically so the bot and the dashboard never both send.
alter table guild_settings add column if not exists weekly_last_run text;
alter table guild_settings add column if not exists weekly_enabled boolean not null default true;
alter table guild_settings add column if not exists weekly_language text;
