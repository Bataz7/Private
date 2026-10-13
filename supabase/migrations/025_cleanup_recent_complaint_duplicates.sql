delete from complaints as d
using complaints as o
where d.id > o.id
  and d.guild_id = o.guild_id
  and d.staff_user_id = o.staff_user_id
  and d.reporter_user_id = o.reporter_user_id
  and d.reason = o.reason
  and coalesce(d.evidence, '') = coalesce(o.evidence, '')
  and d.status = 'pending'
  and o.status = 'pending'
  and d.created_at - o.created_at < interval '10 minutes';