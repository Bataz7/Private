delete from staff_ratings older
using staff_ratings newer
where older.guild_id = newer.guild_id
  and older.staff_user_id = newer.staff_user_id
  and older.reviewer_user_id = newer.reviewer_user_id
  and older.id < newer.id;

create unique index if not exists staff_ratings_one_per_reviewer_idx
  on staff_ratings (guild_id, staff_user_id, reviewer_user_id);