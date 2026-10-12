/**
 * حالة الرول بلاي (cogs/role.py) — لوحة فيها قائمة (بدء / انتهاء / تصويت) تحدّث رسالة الحالة في روم الرول
 * (تعدّل آخر رسالة حالة بدل ما ترسل جديدة).
 *
 * roleplay_data.json  {guild_id: {channel_id, start_msg, end_msg, vote_msg, ping_role_id, manager_role_id, last_status_msg_id, panel_channel_id?}}
 */
import type { Bot } from "../discord/client.ts";
import { P } from "../discord/constants.ts";
import { JsonStore } from "../core/db.ts";
import { onJob } from "../core/jobs.ts";
import { o } from "../core/opts.ts";
import { COLORS, embed, mention, row, select, type Embed } from "../core/ui.ts";

const store = new JsonStore("roleplay_data.json");

/** في بايثون القائمة ما كان لها custom_id ثابت (ما تشتغل بعد إعادة التشغيل) — هنا ثابت. */
const SELECT_ID = "rp_status_select";
const S_START = "بدء الرول";
const S_END = "انتهاء الرول";
const S_VOTE = "تصويت الرول";

const sid = (v: unknown): string | null => (v === null || v === undefined || v === "" || v === 0 ? null : String(v));

export default function setup(bot: Bot): void {
  const panelRow = () => row(select(SELECT_ID, [
    { label: S_START, value: S_START, description: "تغيير حالة الرول إلى (بدء)", emoji: "🟢" },
    { label: S_END, value: S_END, description: "تغيير حالة الرول إلى (انتهاء)", emoji: "🔴" },
    { label: S_VOTE, value: S_VOTE, description: "تغيير حالة الرول إلى (تصويت)", emoji: "🗳️" },
  ], { placeholder: "اختر حالة الرول...", min: 1, max: 1 }));
  const panelEmbed = () => embed({
    title: "🎮 لوحة تحكم إدارة الرول بلاي", color: COLORS.dark, now: false,
    description: "اختر الحالة المناسبة من القائمة المنسدلة بالأسفل لتحديث حالة الرول مباشرة في الروم المخصص.",
  });
  const sendPanel = (channelId: string) => bot.send(channelId, { embeds: [panelEmbed()], components: [panelRow()] });

  bot.component(SELECT_ID, async (ctx) => {
    await ctx.defer(true);
    const gid = ctx.guildId!;
    if (ctx.message) bot.edit(ctx.channelId, ctx.message.id, { components: [panelRow()] }).catch(() => undefined);
    const data = store.get();
    const gd = data[gid];
    if (!gd || typeof gd !== "object" || !Object.keys(gd).length) return ctx.followup("❌ لم يتم إعداد نظام الرول في هذا السيرفر بعد عبر `/اعداد-الرول`!", true);

    const manager = sid(gd.manager_role_id);
    if (manager && bot.role(gid, manager) && !ctx.hasRole(manager) && !ctx.isAdmin) {
      return ctx.followup("❌ ليس لديك الصلاحية أو رتبة مسؤول الرولات لاستخدام هذه القائمة!", true);
    }
    const channelId = sid(gd.channel_id);
    if (!channelId) return ctx.followup("❌ لم يتم تحديد روم بدء الرول في الإعدادات!", true);
    if (bot.guildOfChannel(channelId) !== gid) return ctx.followup("❌ روم بدء الرول المحدد غير موجود!", true);

    const sel = ctx.values[0];
    const ping = sid(gd.ping_role_id);
    const content = ping ? mention.role(ping) : "";
    let e: Embed;
    if (sel === S_START) e = embed({ title: "🟢 حالة الرول: بدأ", description: gd.start_msg || "🟢 **تم افتتاح الرول الآن، تفضلوا بالدخول!**", color: 0x2ecc71, now: false, footer: { text: `بواسطة: ${ctx.user.username}` } });
    else if (sel === S_END) e = embed({ title: "🔴 حالة الرول: انتهى", description: gd.end_msg || "🔴 **انتهى الرول لهذا اليوم، شكراً لحسن تواجدكم.**", color: 0xe74c3c, now: false, footer: { text: `بواسطة: ${ctx.user.username}` } });
    else if (sel === S_VOTE) e = embed({ title: "🗳️ حالة الرول: تصويت", description: gd.vote_msg || "🗳️ **هناك تصويت جارٍ الآن، يرجى المشاركة.**", color: 0x3498db, now: false, footer: { text: `بواسطة: ${ctx.user.username}` } });
    else return ctx.followup("❌ اختيار غير معروف.", true);

    const payload = { content, embeds: [e], allowed_mentions: ping ? { roles: [ping] } : { parse: [] } };
    const last = sid(gd.last_status_msg_id);
    let sent = false;
    if (last) sent = !!(await bot.edit(channelId, last, payload).catch(() => null));
    if (!sent) {
      const msg = await bot.send(channelId, payload).catch(() => null);
      if (!msg) return ctx.followup("❌ البوت لا يمتلك صلاحية الكتابة أو إرسال الرسائل في روم الرول المختار!", true);
      // نقرأ الملف من جديد (ممكن لوحة التحكم عدّلته) ونحدّث رقم الرسالة فقط
      const fresh = store.get();
      const cur = fresh[gid] && typeof fresh[gid] === "object" ? fresh[gid] : (fresh[gid] = { ...gd });
      cur.last_status_msg_id = msg.id;
      store.save(fresh);
    }
    return ctx.followup(`✅ تم تحديث حالة الرول بنجاح في روم ${mention.channel(channelId)}!`, true);
  });

  bot.command({
    name: "اعداد-الرول", description: "إعداد نظام الرول بلاي والرسائل الخاصة به", perms: P.ManageGuild,
    options: [
      o.channel("الروم", "روم بدء الرول (اختر القناة أو اكتب منشن لها)"),
      o.str("رسالة_البدء", "رسالة بدء الرول (اختياري)", { required: false }),
      o.str("رسالة_الانتهاء", "رسالة انتهاء الرول (اختياري)", { required: false }),
      o.str("رسالة_التصويت", "رسالة تصويت الرول (اختياري)", { required: false }),
      o.role("رتبة_المنشن", "رتبة المنشن عند تحديث الحالة (اختياري)", { required: false }),
      o.role("رتبة_المسؤول", "رتبة مسؤول الرولات للتحكم بالقائمة (اختياري)", { required: false }),
    ],
    run: (ctx) => {
      if (!ctx.can(P.ManageGuild)) return ctx.fail("❌ هذا الأمر للمسؤولين فقط!");
      const gid = ctx.guildId!;
      const channel = ctx.id("الروم")!;
      const data = store.get();
      const prev = data[gid] && typeof data[gid] === "object" ? data[gid] : {};
      data[gid] = {
        ...prev, // يحافظ على panel_channel_id من لوحة التحكم
        channel_id: channel,
        start_msg: ctx.str("رسالة_البدء") ?? null,
        end_msg: ctx.str("رسالة_الانتهاء") ?? null,
        vote_msg: ctx.str("رسالة_التصويت") ?? null,
        ping_role_id: ctx.id("رتبة_المنشن") ?? null,
        manager_role_id: ctx.id("رتبة_المسؤول") ?? null,
        last_status_msg_id: prev.last_status_msg_id ?? null,
      };
      store.save(data);
      return ctx.reply(`✅ تم حفظ إعدادات الرول بنجاح!\n📌 روم الرول: ${mention.channel(channel)}`, true);
    },
  });

  bot.command({
    name: "لوحة-الرول", description: "إرسال لوحة التحكم (البانل) الخاصة بالرول بلاي مع القائمة المنسدلة", perms: P.ManageGuild,
    run: async (ctx) => {
      const gid = ctx.guildId!;
      if (!(gid in store.get())) return ctx.reply("❌ يرجى استخدام أمر التسطيب `/اعداد-الرول` أولاً!", true);
      const need = P.SendMessages | P.ViewChannel;
      if (ctx.appPerms && (ctx.appPerms & P.Administrator) !== P.Administrator && (ctx.appPerms & need) !== need) {
        return ctx.reply("❌ البوت لا يمتلك صلاحية قراءة أو إرسال الرسائل في هذه الروم!", true);
      }
      await ctx.reply("✅ تم إرسال بانل الرول بنجاح.", true);
      await sendPanel(ctx.channelId).catch(() => ctx.followup("❌ البوت لا يمتلك صلاحية قراءة أو إرسال الرسائل في هذه الروم!", true));
    },
  });

  onJob("rolestatus-panel", async (gid, payload: { channel_id?: string } | null) => {
    const gd = store.get()[gid];
    const ch = sid(payload?.channel_id) ?? sid(gd?.panel_channel_id);
    if (!ch || bot.guildOfChannel(ch) !== gid) throw new Error("حدد روم إرسال بانل حالة الرول");
    try {
      await sendPanel(ch);
    } catch {
      throw new Error("تعذر إرسال البانل، تأكد من صلاحيات البوت في الروم");
    }
    return "تم إرسال البانل";
  });
}
