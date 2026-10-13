-- Leave + resignation system (ported from Melyx). Safe to run more than once.

-- Leave requests: lifecycle, extension requests, end-of-leave reminders and the review card.
alter table leave_requests add column if not exists activated_at timestamp with time zone;
alter table leave_requests add column if not exists dm_message_id text;
alter table leave_requests add column if not exists decision_note text not null default '';
alter table leave_requests add column if not exists extension_end_date timestamp with time zone;
alter table leave_requests add column if not exists extension_requested_at timestamp with time zone;
alter table leave_requests add column if not exists extension_channel_id text;
alter table leave_requests add column if not exists extension_message_id text;
alter table leave_requests add column if not exists end_reminder_at timestamp with time zone;
alter table leave_requests add column if not exists end_reminder_tried_at timestamp with time zone;
alter table leave_requests add column if not exists end_reminder_count integer not null default 0;
alter table leave_requests add column if not exists review_channel_id text;
alter table leave_requests add column if not exists review_message_id text;

-- Resignation requests: approved means "waiting for the last working day", accepted means completed.
alter table resignation_requests add column if not exists dm_message_id text;
alter table resignation_requests add column if not exists decision_note text not null default '';
alter table resignation_requests add column if not exists confirmation_sent_at timestamp with time zone;
alter table resignation_requests add column if not exists review_channel_id text;
alter table resignation_requests add column if not exists review_message_id text;
alter table resignation_requests drop constraint if exists resignation_requests_status_check;
alter table resignation_requests add constraint resignation_requests_status_check check (status in ('pending', 'approved', 'accepted', 'rejected'));

-- Where the panels were sent (the requests channels stay in guild_settings.leave_channel_id / resignation_channel_id).
create table if not exists request_panel_settings (
  guild_id text primary key,
  leave_panel_channel_id text,
  resignation_panel_channel_id text,
  updated_at timestamp with time zone default now()
);

create index if not exists leave_requests_guild_status_idx on leave_requests (guild_id, status);
create index if not exists resignation_requests_guild_status_idx on resignation_requests (guild_id, status);

notify pgrst, 'reload schema';
