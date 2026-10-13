alter table shifts add column if not exists last_activity_at timestamp with time zone not null default now();
alter table shifts add column if not exists check_sent_at timestamp with time zone;
