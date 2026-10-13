alter table shifts add column if not exists voice_minutes integer not null default 0;
alter table shifts add column if not exists voice_points_awarded integer not null default 0;
alter table staff_daily_activity add column if not exists voice_minutes integer not null default 0;