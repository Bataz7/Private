create table staff_ratings (
  id bigint generated always as identity primary key,
  guild_id text not null,
  staff_user_id text not null,
  reviewer_user_id text not null,
  rating integer not null check (rating between 1 and 5),
  comment text not null default '',
  created_at timestamp with time zone default now()
);

create index on staff_ratings (guild_id);
create index on staff_ratings (staff_user_id);