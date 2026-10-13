alter table staff_reports add column if not exists points integer not null default 0;
alter table staff_reports add column if not exists voice_hours numeric not null default 0;
alter table staff_reports add column if not exists complaints integer not null default 0;