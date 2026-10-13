alter table staff add column if not exists message_count integer not null default 0;
alter table staff add column if not exists voice_minutes integer not null default 0;
