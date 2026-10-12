/**
 * لوحة التفعيل (cogs/apply.py) — العضو يختار «التفعيل» من القائمة، تجيه 7 أسئلة بالخاص،
 * وطلبه يروح لروم الإدارة مع زرين قبول/رفض (المسؤول يكتب السبب في الشات).
 *
 * الملفات (نفس بايثون):
 * - activation_requests.json  {staff_message_id: {user_id, guild_id, status}}  (المرفوض ينحذف، المقبول status=accepted)
 * - activation_settings.json  {guild_id: {staff_channel_id, add_role_id, remove_role_id, staff_role_id, panel_channel_id?}}
 */
import type { Bot } from "../discord/client.ts";
import type { Ctx } from "../discord/ctx.ts";
import { ButtonStyle, P } from "../discord/constants.ts";
import { JsonStore } from "../core/db.ts";
import { onJob } from "../core/jobs.ts";
import { log } from "../core/log.ts";
import { o } from "../core/opts.ts";
import { COLORS, button, embed, mention, row, select, type Embed } from "../core/ui.ts";
import { beginDmFlow, cleanEmbed, endDmFlow, setupWaiters, waitForMessage } from "./activation/shared.ts";

const requests = new JsonStore("activation_requests.json");
const settingsStore = new JsonStore("activation_settings.json");

interface ActSettings { staff_channel_id?: string | null; add_role_id?: string | null; remove_role_id?: string | null; staff_role_id?: string | null; panel_channel_id?: string | null }

const sid = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
export function loadSettings(gid: string): ActSettings {
  const all = settingsStore.get();
  const cfg = all[gid];
  return cfg && typeof cfg === "object" ? cfg : {};
}

const PANEL_IMAGE = "https://i.ibb.co/3s6q376/image.png";
const SELECT_ID = "apply_dropdown_persistent_dm";
const QUESTIONS = [
  "١- ما هو اسمك الحقيقي؟",
  "٢- ما هو عمرك الحقيقي؟",
  "٣- هل تم قراءة قوانين السيرفر؟ (نعم / لا)",
  "٤- اذكر ٢ من قوانين السيرفر:",
  "٥- اذكر ٢ من قوانين الرول بلاي:",
  "٦- كم مدة تفاعلك اليومي؟",
  "٧- هل تتعهد بالالتزام بالقوانين والأنظمة؟",
];
const FIELD_NAMES = ["١- الاسم الحقيقي", "٢- العمر", "٣- قراءة القوانين؟", "٤- قوانين السيرفر", "٥- قوانين الرول بلاي", "٦- مدة التفاعل", "٧- التعهد بالالتزام"];

export default function setup(bot: Bot): void {
  setupWaiters(bot);

  const icon = (gid: string) => bot.guildIcon(bot.guild(gid));
  const guildName = (gid: string) => bot.guild(gid)?.name ?? "";

  const panelEmbed = (gid: string): Embed => {
    const name = guildName(gid);
    return embed({
      color: COLORS.dark, now: false, author: { name: `${name} 🎮`, icon_url: icon(gid) }, image: PANEL_IMAGE,
      fields: [{
        name: "الأنشطة ✅", inline: false,
        value: `مرحباً بكم في مدينة \`${name}\` نورتونا 🎮\n\nللبدء في التفعيل يرجى اختيار **التفعيل** من القائمة بالأسفل! ✅\n\nحياكم الله نورتونا وشرفتونا 👋`,
      }],
    });
  };
  const panelRow = () => row(select(SELECT_ID, [
    { label: "التفعيل", description: "بدء طلب التفعيل", value: "start_apply_dm", emoji: "✅" },
    { label: "إعادة التشغيل", description: "إعادة تعيين خيارات القائمة", value: "reset_menu", emoji: "🔄" },
  ], { placeholder: "اختر من القائمة", min: 1, max: 1 }));
  const reviewRow = (disabled = false) => row(
    button("accept_apply", "قبول", ButtonStyle.Success, { disabled }),
    button("reject_apply", "رفض", ButtonStyle.Danger, { disabled }),
  );

  /** يرسل لوحة التفعيل (للأمر وللوحة التحكم). */
  const sendPanel = (gid: string, channelId: string) => bot.send(channelId, { embeds: [panelEmbed(gid)], components: [panelRow()] });

  // ─────────── القائمة ───────────
  bot.component(SELECT_ID, async (ctx) => {
    const gid = ctx.guildId;
    if (!gid) return ctx.deferUpdate();
    // يرجّع القائمة لوضعها الأصلي عشان يقدر يختار نفس الخيار مرة ثانية
    if (ctx.message) bot.edit(ctx.channelId, ctx.message.id, { components: [panelRow()] }).catch(() => undefined);
    const choice = ctx.values[0];
    if (choice === "reset_menu") return ctx.reply("🔄 تم إعادة تعيين القائمة بنجاح.", true);
    if (choice !== "start_apply_dm") return ctx.deferUpdate();

    const cfg = loadSettings(gid);
    const uid = ctx.user.id;
    let already = false;
    for (const req of Object.values(requests.get())) {
      if (req && String(req.user_id) === uid && String(req.guild_id ?? gid) === gid) {
        already = true;
        break;
      }
    }
    const addRole = sid(cfg.add_role_id);
    if (addRole && bot.role(gid, addRole) && ctx.hasRole(addRole)) already = true;
    if (already) return ctx.reply("❌ عذراً، أنت مفعل مسبقاً أو لديك طلب تفعيل قيد المراجعة!", true);
    if (!beginDmFlow(uid)) return ctx.reply("⏳ عندك أسئلة جارية في الخاص، أكملها أولاً.", true);

    try {
      await ctx.reply("📩 تم إرسال أسئلة التفعيل في الخاص، توجه هناك لو سمحت!", true);
      const answers: string[] = [];
      for (let i = 0; i < QUESTIONS.length; i++) {
        const sent = await bot.dm(uid, `**[سؤال ${i + 1}/7]**\n${QUESTIONS[i]}`);
        if (!sent) {
          if (i === 0) await ctx.followup("❌ ما قدرت أرسل لك في الخاص، افتح الخاص وحاول مرة ثانية.", true).catch(() => undefined);
          return;
        }
        const msg = await waitForMessage(bot, uid, null, 120_000);
        if (!msg) {
          await bot.dm(uid, "⏰ انتهى الوقت المحدد للتقديم. حاول مرة أخرى من السيرفر.");
          return;
        }
        answers.push(String(msg.content ?? ""));
      }
      await bot.dm(uid, "✅ تم استلام جميع إجاباتك بنجاح! تم إرسال طلبك للإدارة للمراجعة.");

      // الإعدادات من جديد (ممكن تغيّرت من لوحة التحكم أثناء الأسئلة)
      const st = loadSettings(gid);
      const staffChannel = sid(st.staff_channel_id);
      if (!staffChannel || bot.guildOfChannel(staffChannel) !== gid) return;
      const staffRole = sid(st.staff_role_id);
      const e = embed({
        title: "طلب تفعيل جديد (خاص)", color: COLORS.blue, now: false,
        author: { name: ctx.user.username, icon_url: bot.avatar(ctx.member ?? ctx.user) },
        fields: FIELD_NAMES.map((name, i) => ({ name, value: answers[i] || "—", inline: false })),
        footer: { text: `الآيدي: ${uid}` },
      });
      const sentMsg = await bot.send(staffChannel, {
        content: `${staffRole ? mention.role(staffRole) : "@here"} طلب تفعيل جديد مقدّم من: ${mention.user(uid)}`,
        embeds: [e], components: [reviewRow()], allowed_mentions: { parse: ["roles", "everyone"] },
      }).catch((err) => {
        log.warn("activation", `staff send ${staffChannel}: ${err.message}`);
        return null;
      });
      if (!sentMsg) return;
      const data = requests.get();
      data[sentMsg.id] = { user_id: uid, guild_id: gid, status: "pending" };
      requests.save(data);
    } finally {
      endDmFlow(uid);
    }
  });

  // ─────────── قبول / رفض ───────────
  const busy = new Set<string>();

  const askReason = async (ctx: Ctx, prompt: string, fallback: string): Promise<string> => {
    await ctx.reply(prompt, true);
    const msg = await waitForMessage(bot, ctx.user.id, ctx.channelId, 60_000);
    if (!msg) return fallback;
    await bot.deleteMessage(msg.channel_id, msg.id);
    return String(msg.content ?? "");
  };

  const targetOf = (ctx: Ctx): string | null => {
    const req = requests.get()[ctx.message?.id ?? ""];
    if (req?.user_id) return String(req.user_id);
    const m = /(\d{15,})/.exec(ctx.message?.embeds?.[0]?.footer?.text ?? "");
    return m ? m[1]! : null;
  };

  const review = async (ctx: Ctx, accepted: boolean) => {
    const gid = ctx.guildId;
    const msgId: string | undefined = ctx.message?.id;
    if (!gid || !msgId) return ctx.deferUpdate();
    if (busy.has(msgId)) return ctx.fail("⏳ هذا الطلب قيد المعالجة من مسؤول آخر.");
    busy.add(msgId);
    try {
      const reason = accepted
        ? await askReason(ctx, "✍️ أرسل الآن في الشات **سبب القبول**:", "تم القبول بدون ذكر سبب.")
        : await askReason(ctx, "✍️ أرسل الآن في الشات **سبب الرفض**:", "استيفاء الشروط المطلوبة.");
      const uid = targetOf(ctx);
      const g = bot.guild(gid);
      const st = loadSettings(gid);
      const member = uid ? await bot.member(gid, uid) : null;
      const author = { name: `${g?.name ?? ""} 🎮`, icon_url: bot.guildIcon(g) };

      if (accepted) {
        if (member) {
          const rem = sid(st.remove_role_id);
          const add = sid(st.add_role_id);
          if (rem && bot.role(gid, rem)) await bot.removeRole(gid, member.id, rem, "قبول التفعيل").catch(() => undefined);
          if (add && bot.role(gid, add)) await bot.addRole(gid, member.id, add, "قبول التفعيل").catch(() => undefined);
          await bot.dm(member.id, { embeds: [embed({
            color: COLORS.green, now: false, author,
            fields: [{ name: "التفعيل ✅", value: `-\n\nنهنئك بقبول تفعيلك في \`${g?.name ?? ""}\`\n\nالسبب: ${reason}\n\`🪪 ( ✅ ) R c\``, inline: false }],
          })] });
        }
        const data = requests.get();
        if (data[msgId]) {
          data[msgId].status = "accepted";
          requests.save(data);
        }
        const old = ctx.message.embeds?.[0];
        if (old) {
          const prev = cleanEmbed(old);
          const e: Embed = {
            title: "طلب تفعيل جديد (مقبول ✅)", color: COLORS.green,
            description: `**تم قبول العضو:** ${mention.user(uid ?? "0")}\n**من قبل المسؤول:** ${mention.user(ctx.user.id)}\n**السبب:** ${reason}`.slice(0, 4096),
          };
          if (prev.author) e.author = prev.author;
          if (prev.fields) e.fields = prev.fields;
          if (prev.footer) e.footer = { text: prev.footer.text };
          await bot.edit(ctx.channelId, msgId, { embeds: [e], components: [reviewRow(true)] }).catch(() => undefined);
        } else {
          await bot.edit(ctx.channelId, msgId, { components: [reviewRow(true)] }).catch(() => undefined);
        }
        await ctx.followup(`✅ تم قبول العضو بنجاح بواسطة ${mention.user(ctx.user.id)}`, true);
      } else {
        if (member) {
          await bot.dm(member.id, { embeds: [embed({
            color: 0xe74c3c, now: false, author,
            fields: [{
              name: "التفعيل ✅", inline: false,
              value: `-\n\nتم رفض طلب التفعيل ❌\n\nنعتذر منك تم رفض طلب التفعيل لعدم استيفاء الشروط المطلوبة\nيمكنك التقديم مرة أخرى بعد التأكد من استكمال جميع الشروط المطلوبة\n\nالسبب: ${reason}`,
            }],
          })] });
        }
        const data = requests.get();
        if (data[msgId]) {
          delete data[msgId];
          requests.save(data);
        }
        await bot.edit(ctx.channelId, msgId, { components: [reviewRow(true)] }).catch(() => undefined);
        await ctx.followup(`❌ تم رفض العضو بواسطة ${mention.user(ctx.user.id)}`, true);
      }
    } finally {
      busy.delete(msgId);
    }
  };

  bot.component("accept_apply", (ctx) => (ctx.customId === "accept_apply" ? review(ctx, true) : ctx.deferUpdate()));
  bot.component("reject_apply", (ctx) => (ctx.customId === "reject_apply" ? review(ctx, false) : ctx.deferUpdate()));

  // ─────────── الأمر ───────────
  bot.command({
    name: "لوحة-التفعيل", description: "إرسال بانل التفعيل الخاص بالسيرفر", perms: P.Administrator,
    options: [
      o.channel("روم_الادارة", "روم استقبال طلبات الإدارة"),
      o.role("رتبة_القبول", "رتبة العضو بعد القبول (اختياري)", { required: false }),
      o.role("رتبة_الازالة", "رتبة يتم إزالتها عند القبول (اختياري)", { required: false }),
      o.role("رتبة_الادارة", "رتبة الإدارة التي يتم عمل منشن لها (اختياري)", { required: false }),
    ],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("❌ هذا الأمر للمسؤولين فقط!");
      const gid = ctx.guildId!;
      const all = settingsStore.get();
      const prev = all[gid] && typeof all[gid] === "object" ? all[gid] : {};
      all[gid] = {
        ...prev, staff_channel_id: ctx.id("روم_الادارة")!, add_role_id: ctx.id("رتبة_القبول") ?? null,
        remove_role_id: ctx.id("رتبة_الازالة") ?? null, staff_role_id: ctx.id("رتبة_الادارة") ?? null,
      };
      settingsStore.save(all);
      try {
        await sendPanel(gid, ctx.channelId);
      } catch {
        return ctx.fail("❌ ما قدرت أرسل البانل في هذا الروم، تأكد من صلاحيات البوت.");
      }
      return ctx.reply("✅ تم إرسال البانل بنجاح وتفعيل القائمة!", true);
    },
  });

  // ─────────── لوحة التحكم ───────────
  onJob("activation-panel", async (gid, payload: { channel_id?: string } | null) => {
    const ch = sid(payload?.channel_id) ?? sid(loadSettings(gid).panel_channel_id);
    if (!ch || bot.guildOfChannel(ch) !== gid) throw new Error("الروم غير موجود");
    try {
      await sendPanel(gid, ch);
    } catch {
      throw new Error("تعذر إرسال البانل، تأكد من صلاحيات البوت في الروم");
    }
    return "تم إرسال البانل";
  });
}
