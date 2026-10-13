create table complaints (
  id bigint generated always as identity primary key,
  guild_id text not null,
  staff_user_id text not null,
  reporter_user_id text not null,
  reason text not null,
  evidence text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamp with time zone,
  decision_note text not null default '',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index on complaints (guild_id);
create index on complaints (staff_user_id);
create index on complaints (status);

create trigger complaints_updated_at
  before update on complaints
  for each row execute function update_updated_at();