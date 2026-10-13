-- 036 تحقق التواجد في الفويس، نظام الفصل، لوحة المتصدرين الأسبوعية.
-- Idempotent: safe to run more than once. Run it in the Supabase SQL editor.
-- البوت يشتغل بدونه (قيم افتراضية)، لكن حفظ الإعدادات الجديدة والفصل الكامل يحتاجونه.

-- ---------------------------------------------------------------------------------------------------
-- تحقق التواجد («هل انت موجود؟»): بعد ساعة في الفويس بدون أي تفاعل يرسل البوت سؤال، وبدون رد خلال 30 دقيقة
-- يوقف الشفت بصمت. check_sent_at موجود من قبل في shifts؛ هنا مكان رسالة التحقق عشان تنحذف بعد إعادة التشغيل.
-- ---------------------------------------------------------------------------------------------------
alter table guild_settings add column if not exists presence_check_enabled boolean not null default true;
alter table guild_settings add column if not exists presence_check_minutes integer not null default 60;
alter table guild_settings add column if not exists presence_check_timeout_minutes integer not null default 30;

alter table shifts add column if not exists check_sent_at timestamp with time zone;
alter table shifts add column if not exists presence_channel_id text;
alter table shifts add column if not exists presence_message_id text;

-- ---------------------------------------------------------------------------------------------------
-- الفصل: المفصول ما يرجع ستاف تلقائياً (لا من الرسائل ولا من المزامنة) لين أحد يلغي فصله.
-- ---------------------------------------------------------------------------------------------------
alter table staff add column if not exists dismissed_at timestamp with time zone;
alter table staff add column if not exists dismissed_by text;
alter table staff add column if not exists dismiss_reason text;
create index if not exists staff_dismissed_idx on staff (guild_id) where dismissed_at is not null;

-- حد الإنذارات: لما توصل الإنذارات النشطة لهذا الرقم ينفصل الإداري تلقائياً (0 = متوقف).
alter table guild_settings add column if not exists warn_limit integer not null default 3;

-- ---------------------------------------------------------------------------------------------------
-- لوحة المتصدرين الأسبوعية: رسالة وحدة تتحدث كل 10 دقايق. الأسبوع يبدأ السبت 00:00 بتوقيت السعودية.
-- leaderboard_week = بداية الأسبوع اللي تعرضه الرسالة الحالية (ISO)، عشان نعرف متى ننشر «أبطال الأسبوع».
-- ---------------------------------------------------------------------------------------------------
alter table guild_settings add column if not exists leaderboard_channel_id text;
alter table guild_settings add column if not exists leaderboard_message_id text;
alter table guild_settings add column if not exists leaderboard_week text;

create index if not exists points_ledger_guild_idx on points_ledger (guild_id, created_at desc);

-- مجموع النقاط لكل عضو من p_since (وإلى p_until لو انعطى)، الأعلى أول.
create or replace function weekly_points(p_guild text, p_since timestamptz, p_until timestamptz default null)
returns table (user_id text, points bigint)
language sql stable
as $$
  select l.user_id, sum(l.delta)::bigint as points
  from points_ledger l
  where l.guild_id = p_guild and l.created_at >= p_since and (p_until is null or l.created_at < p_until)
  group by l.user_id
  order by points desc;
$$;

notify pgrst, 'reload schema';
