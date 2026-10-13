-- Embed Studio: saved bot messages (Components V2 or classic embeds) with the steps their buttons and menus run.
-- Idempotent: safe to run more than once.
create extension if not exists pgcrypto;

create table if not exists studio_messages (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  name text not null default 'Untitled message',
  -- The message document validated by src/studio/schema.ts: { mode, content, embeds, components }.
  data jsonb not null,
  -- Copies posted to Discord: [{ "channelId": "...", "messageId": "...", "at": "..." }], newest last (kept to the last 20).
  sent jsonb not null default '[]'::jsonb,
  created_by text not null default '',
  updated_by text not null default '',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists studio_messages_guild_updated_idx on studio_messages (guild_id, updated_at desc);
