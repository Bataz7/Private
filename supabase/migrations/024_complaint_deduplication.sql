alter table complaints add column if not exists dedupe_key text;

delete from complaints as d
using complaints as o
where d.id > o.id
  and d.guild_id = o.guild_id
  and d.staff_user_id = o.staff_user_id
  and d.reporter_user_id = o.reporter_user_id
  and d.reason = o.reason
  and coalesce(d.evidence, '') = coalesce(o.evidence, '')
  and d.status = 'pending'
  and o.status = 'pending';

create unique index if not exists complaints_dedupe_key
on complaints (dedupe_key)
where dedupe_key is not null;