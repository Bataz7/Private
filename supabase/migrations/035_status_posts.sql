-- News posts ("tweets") shown on the public status page. Idempotent.
create table if not exists status_posts (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  body          text not null default '',
  kind          text not null default 'update' check (kind in ('update', 'announcement', 'incident', 'resolved', 'maintenance')),
  pinned        boolean not null default false,
  author_id     text not null default '',
  author_name   text not null default '',
  author_avatar text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists status_posts_order_idx on status_posts (pinned desc, created_at desc);
alter table status_posts enable row level security;
