/**
 * التقديمات (cogs/setup_apply.py) — حتى 10 تقديمات لكل سيرفر، كل تقديم له 5 أسئلة في نافذة،
 * والتقديم يروح لروم المراجعة مع أزرار قبول/رفض (تعطي/تسحب رتب وترسل رسالة بالخاص).
 *
 * الملفات (نفس بايثون):
 * - apply_data.json    {guild_id: {num: {num, name, admin_role_id, review_channel_id, accept_msg, reject_msg, given_roles_ids, removed_role_id, questions, panel_channel_id?}}}
 * - apply_reviews.json {review_message_id: {...apply, applicant_id}}
 * - apply_panels.json  {panel_message_id: {guild_id, panel_id, display, nums}}
 *
 * custom_id الدائمة: apply_btn:<panel>:<num> · apply_select:<panel> · persistent_apply_accept_btn · persistent_apply_reject_btn
 */
import type { Bot } from "../discord/client.ts";
import type { Ctx } from "../discord/ctx.ts";
import { ButtonStyle, ChannelType, P } from "../discord/constants.ts";
import { JsonStore, TTL } from "../core/db.ts";
import { onJob } from "../core/jobs.ts";
import { log } from "../core/log.ts";
import { o } from "../core/opts.ts";
import { button, channelSelect, clip, embed, input, mention, modal, row, select, type Embed } from "../core/ui.ts";
import { cleanEmbed, token } from "./activation/shared.ts";

const dataStore = new JsonStore("apply_data.json");
const reviewsStore = new JsonStore("apply_reviews.json");
const panelsStore = new JsonStore("apply_panels.json");

const BLURPLE = 0x5865f2;
const GREEN = 0x2ecc71;
const RED = 0xe74c3c;

interface Apply {
  num: string; name: string; admin_role_id?: string | null; review_channel_id?: string | null; accept_msg?: string; reject_msg?: string;
  given_roles_ids?: (string | number)[]; removed_role_id?: string | null; questions?: string[]; panel_channel_id?: string | null;
  [k: string]: unknown;
}

const sid = (v: unknown): string | null => (v === null || v === undefined || v === "" || v === 0 ? null : String(v));

export function guildApplies(gid: string): Record<string, Apply> {
  const g = dataStore.get()[gid];
  return g && typeof g === "object" ? g : {};
}
const sortedNums = (applies: Record<string, Apply>) =>
  Object.keys(applies).filter((n) => applies[n] && typeof applies[n] === "object").sort((a, b) => Number(a) - Number(b));

/** حالة مؤقتة لنوافذ الإعداد (بديل View بحالة في بايثون) — تنتهي بعد 3 دقائق (15 للإعداد). */
const pendingSetup = new TTL<Apply>(15 * 60_000, 200);
const pendingPanel = new TTL<{ channelId: string; nums: string[]; embed: Embed }>(180_000, 200);

export default function setup(bot: Bot): void {
  const icon = (gid: string) => bot.guildIcon(bot.guild(gid));

  // ─────────── بناء البانل ───────────
  const panelComponents = (panelId: string, display: string, applies: Record<string, Apply>, nums: string[]) => {
    if (display === "buttons") {
      const btns = nums.map((n) => button(`apply_btn:${panelId}:${n}`, String(applies[n]?.name ?? "تقديم").slice(0, 80), ButtonStyle.Primary, { emoji: "📋" }));
      const rows = [];
      for (let i = 0; i < btns.length; i += 5) rows.push(row(...btns.slice(i, i + 5)));
      return rows;
    }
    return [row(select(`apply_select:${panelId}`, nums.map((n) => ({ label: `تقديم: ${applies[n]?.name ?? ""}`.slice(0, 100), value: n, emoji: "📝" })), {
      placeholder: "اختر نوع التقديم الذي ترغب به...", min: 1, max: 1,
    }))];
  };

  /** يرسل البانل ويحفظه في apply_panels.json. يرمي Error بالعربي. */
  async function sendPanel(gid: string, channelId: string, e: Embed, display: string, numsIn: (string | number)[]): Promise<any> {
    if (!channelId || bot.guildOfChannel(channelId) !== gid) throw new Error("الروم غير موجود");
    const applies = guildApplies(gid);
    const nums = [...new Set(numsIn.map(String))].filter((n) => applies[n] && typeof applies[n] === "object");
    if (!nums.length) throw new Error("التقديمات المحددة غير مسطّبة");
    const disp = display === "buttons" ? "buttons" : "dropdown";
    const panelId = token(12);
    const msg = await bot.send(channelId, { embeds: [e], components: panelComponents(panelId, disp, applies, nums) });
    const panels = panelsStore.get();
    panels[msg.id] = { guild_id: gid, panel_id: panelId, display: disp, nums };
    panelsStore.save(panels);
    return msg;
  }

  const panelEmbed = (gid: string, title: string, desc: string, image?: string | null) =>
    embed({ title, description: desc, color: BLURPLE, thumbnail: icon(gid), image: image || undefined, now: false });

  // ─────────── نافذة التقديم للعضو ───────────
  const openApply = (ctx: Ctx, num: string | undefined) => {
    const gid = ctx.guildId;
    const a = gid && num ? guildApplies(gid)[num] : undefined;
    if (!a) return ctx.reply("❌ بيانات هذا التقديم غير متوفرة.", true);
    const qs = Array.isArray(a.questions) ? a.questions : [];
    const inputs = [0, 1, 2, 3, 4].map((i) => input(`ans_${i + 1}`, String(qs[i] ?? `السؤال ${i + 1}`).slice(0, 45), {
      paragraph: true, placeholder: "اكتب إجابتك هنا...", required: true, max: 1000,
    }));
    return ctx.showModal(modal(`apply_modal:${num}`, `تقديم: ${a.name}`.slice(0, 45), inputs));
  };

  bot.component("apply_btn:", (ctx) => openApply(ctx, ctx.customId.split(":")[2]));
  bot.component("apply_select:", async (ctx) => {
    await openApply(ctx, ctx.values[0]);
    // يرجّع القائمة لوضعها الأصلي (عشان يقدر يختار نفس التقديم مرة ثانية)
    if (ctx.message?.components) bot.edit(ctx.channelId, ctx.message.id, { components: ctx.message.components }).catch(() => undefined);
  });

  bot.modal("apply_modal:", async (ctx) => {
    const gid = ctx.guildId;
    if (!gid) return;
    const num = ctx.customId.split(":")[1] ?? "";
    await ctx.defer(true);
    const a = guildApplies(gid)[num];
    if (!a) return ctx.followup("❌ بيانات هذا التقديم غير متوفرة.", true);
    const reviewCh = sid(a.review_channel_id);
    if (!reviewCh || bot.guildOfChannel(reviewCh) !== gid) return ctx.followup("❌ روم مراجعة التقديمات غير موجود حالياً!", true);

    const qs = Array.isArray(a.questions) ? a.questions : [];
    const e = embed({
      title: `📥 تقديم جديد: ${a.name}`, color: BLURPLE, thumbnail: icon(gid),
      author: { name: ctx.user.username, icon_url: bot.avatar(ctx.member ?? ctx.user) },
      fields: [
        { name: "المتقدم", value: mention.user(ctx.user.id), inline: false },
        ...[0, 1, 2, 3, 4].map((i) => ({ name: `${i + 1}) ${qs[i] ?? `السؤال ${i + 1}`}`, value: clip(ctx.fields.get(`ans_${i + 1}`) ?? "", 1024) || "—", inline: false })),
      ],
      footer: { text: `الآيدي: ${ctx.user.id}` },
    });
    const adminRole = sid(a.admin_role_id);
    const pingRole = adminRole && bot.role(gid, adminRole) ? adminRole : null;
    let msg: any;
    try {
      msg = await bot.send(reviewCh, {
        content: pingRole ? mention.role(pingRole) : undefined, embeds: [e], components: [reviewRow(false)],
        allowed_mentions: pingRole ? { roles: [pingRole] } : { parse: [] },
      });
    } catch {
      return ctx.followup("❌ تعذر إرسال التقديم لروم المراجعة (تأكد من صلاحيات البوت).", true);
    }
    const reviews = reviewsStore.get();
    reviews[msg.id] = { ...a, applicant_id: ctx.user.id };
    reviewsStore.save(reviews);
    return ctx.followup("✅ تم إرسال تقديمك بنجاح وفي انتظار المراجعة.", true);
  });

  // ─────────── المراجعة (قبول / رفض) ───────────
  const reviewRow = (disabled: boolean) => row(
    button("persistent_apply_accept_btn", "قبول", ButtonStyle.Success, { emoji: "✅", disabled }),
    button("persistent_apply_reject_btn", "رفض", ButtonStyle.Danger, { emoji: "❌", disabled }),
  );
  const busy = new Set<string>();

  const processReview = async (ctx: Ctx, accepted: boolean) => {
    const gid = ctx.guildId;
    const message = ctx.message;
    if (!gid || !message) return ctx.deferUpdate();
    const info: Partial<Apply> & { applicant_id?: string } = reviewsStore.get()[message.id] ?? {};
    let applicantId = sid(info.applicant_id);
    if (!applicantId) applicantId = /\d+/.exec(message.embeds?.[0]?.footer?.text ?? "")?.[0] ?? null;

    const adminRole = sid(info.admin_role_id);
    if (!(ctx.isAdmin || (adminRole && ctx.hasRole(adminRole)))) return ctx.reply("❌ هذا الزر مخصص للإدارة أو المسؤولين فقط!", true);
    if (busy.has(message.id)) return ctx.fail("⏳ هذا التقديم قيد المعالجة من مسؤول آخر.");
    busy.add(message.id);
    try {
      await ctx.defer(true);
      const applicant = applicantId ? await bot.member(gid, applicantId) : null;
      const notes: string[] = [];
      let dmTitle: string, dmText: string, color: number, status: string, result: string;

      if (accepted) {
        const roles = (info.given_roles_ids ?? []).map(String).filter((r) => bot.role(gid, r));
        if (applicant && roles.length) {
          try {
            for (const r of roles) await bot.addRole(gid, applicant.id, r, "قبول التقديم");
          } catch {
            notes.push("⚠️ تعذر منح الرتب (تأكد أن رتبة البوت أعلى من الرتب المراد منحها).");
          }
        }
        const removed = sid(info.removed_role_id);
        if (applicant && removed && bot.role(gid, removed) && applicant.roles.includes(removed)) {
          await bot.removeRole(gid, applicant.id, removed, "إزالة رتبة ما بعد القبول").catch(() => notes.push("⚠️ تعذر إزالة الرتبة المحددة."));
        }
        dmTitle = "🎉 نتيجة التقديم: مقبول";
        dmText = info.accept_msg ?? "تم قبول تقديمك بنجاح!";
        color = GREEN;
        status = `✅ مقبول بواسطة ${mention.user(ctx.user.id)}`;
        result = "✅ تم قبول العضو بنجاح.";
      } else {
        dmTitle = "❌ نتيجة التقديم: مرفوض";
        dmText = info.reject_msg ?? "نعتذر منك، تم رفض تقديمك.";
        color = RED;
        status = `❌ مرفوض بواسطة ${mention.user(ctx.user.id)}`;
        result = "❌ تم رفض التقديم.";
      }

      if (applicant) {
        const sent = await bot.dm(applicant.id, { embeds: [embed({ title: dmTitle, description: dmText, color, thumbnail: icon(gid), now: false })] });
        if (!sent) notes.push("⚠️ تعذر إرسال رسالة الخاص (الخاص مغلق).");
      } else {
        notes.push("⚠️ العضو غير موجود في السيرفر.");
      }

      const old = message.embeds?.[0];
      if (old) {
        const e = cleanEmbed(old);
        e.color = color;
        e.fields = [...(e.fields ?? []), { name: "حالة التقديم", value: status, inline: false }].slice(0, 25);
        await bot.edit(ctx.channelId, message.id, { embeds: [e], components: [reviewRow(true)] }).catch((err) => log.warn("applications", `edit review: ${err.message}`));
      } else {
        await bot.edit(ctx.channelId, message.id, { components: [reviewRow(true)] }).catch(() => undefined);
      }

      const reviews = reviewsStore.get();
      if (message.id in reviews) {
        delete reviews[message.id];
        reviewsStore.save(reviews);
      }
      await ctx.followup([result, ...notes].join("\n"), true);
    } finally {
      busy.delete(message.id);
    }
  };

  bot.component("persistent_apply_accept_btn", (ctx) => processReview(ctx, true));
  bot.component("persistent_apply_reject_btn", (ctx) => processReview(ctx, false));

  // ─────────── /اعداد-تقديم ───────────
  bot.command({
    name: "اعداد-تقديم", description: "إعداد تقديم جديد وتحديد الخيارات والأسئلة", perms: P.Administrator,
    options: [
      o.int("رقم_التقديم", "رقم التقديم (من 1 إلى 10)"),
      o.str("اسم_التقديم", "اسم التقديم"),
      o.role("رتبة_المسؤول", "رتبة المسؤول عن القبول أو الإدارة"),
      o.channel("روم_المراجعة", "روم القبول والرفض ومراجعة التقديمات"),
      o.str("رسالة_القبول", "رسالة القبول في الخاص"),
      o.str("رسالة_الرفض", "رسالة الرفض في الخاص"),
      o.role("رتبة_معطاة_1", "رتبة معطاة أولى (اختياري)", { required: false }),
      o.role("رتبة_معطاة_2", "رتبة معطاة ثانية (اختياري)", { required: false }),
      o.role("رتبة_تزال", "رتبة تزال عند القبول (اختياري)", { required: false }),
    ],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("❌ هذا الأمر للمسؤولين فقط!");
      const num = ctx.int("رقم_التقديم")!;
      if (!(num >= 1 && num <= 10)) return ctx.reply("❌ يجب أن يكون رقم التقديم بين 1 و 10 تماماً!", true);
      const base: Apply = {
        num: String(num),
        name: ctx.str("اسم_التقديم")!.slice(0, 90),
        admin_role_id: ctx.id("رتبة_المسؤول")!,
        review_channel_id: ctx.id("روم_المراجعة")!,
        accept_msg: ctx.str("رسالة_القبول")!,
        reject_msg: ctx.str("رسالة_الرفض")!,
        given_roles_ids: [ctx.id("رتبة_معطاة_1"), ctx.id("رتبة_معطاة_2")].filter((x): x is string => !!x),
        removed_role_id: ctx.id("رتبة_تزال") ?? null,
      };
      const key = token(12);
      pendingSetup.set(`${ctx.guildId}:${key}`, base);
      return ctx.showModal(modal(`apply_setup:q:${key}`, "تحديد الـ 5 أسئلة الإجبارية للتقديم", [
        input("q1", "السؤال الأول", { placeholder: "مثال: كم عمرك؟", max: 100 }),
        input("q2", "السؤال الثاني", { placeholder: "مثال: لماذا تريد الانضمام؟", max: 100 }),
        input("q3", "السؤال الثالث", { placeholder: "مثال: هل لديك خبرة سابقة؟", max: 100 }),
        input("q4", "السؤال الرابع", { placeholder: "مثال: كم تفعل من ساعات تفاعل؟", max: 100 }),
        input("q5", "السؤال الخامس", { placeholder: "مثال: لماذا نختارك أنت بالذات؟", max: 100 }),
      ]));
    },
  });

  bot.modal("apply_setup:q:", async (ctx) => {
    const gid = ctx.guildId!;
    const key = `${gid}:${ctx.customId.split(":")[2]}`;
    const base = pendingSetup.get(key);
    if (!base) return ctx.fail("⏰ انتهت مهلة الإعداد، استخدم `/اعداد-تقديم` مرة ثانية.");
    pendingSetup.delete(key);
    base.questions = ["q1", "q2", "q3", "q4", "q5"].map((q) => ctx.fields.get(q) ?? "");
    const data = dataStore.get();
    const g = data[gid] && typeof data[gid] === "object" ? data[gid] : (data[gid] = {});
    const prev = g[base.num] && typeof g[base.num] === "object" ? g[base.num] : {};
    // نحافظ على أي حقول إضافية من لوحة التحكم (مثل panel_channel_id)
    g[base.num] = { ...prev, ...base };
    dataStore.save(data);
    return ctx.reply({ embeds: [embed({
      title: "✅ تم إعداد التقديم بنجاح", color: GREEN, thumbnail: icon(gid), now: false,
      description: `تم حفظ التقديم رقم **${base.num}** باسم: **${base.name}** مع الأسئلة الـ 5 بنجاح!`,
    })] }, true);
  });

  // ─────────── /لوحة-التقديمات ───────────
  bot.command({
    name: "لوحة-التقديمات", description: "إرسال بانل التقديمات الرئيسي للسيرفر", perms: P.Administrator,
    run: (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("❌ هذا الأمر للمسؤولين فقط!");
      return ctx.reply({
        content: "🔍 اختر الروم المراد إرسال بانل التقديمات إليه:",
        components: [row(channelSelect("apply_setup:ch", "ابحث واختر روم إرسال بانل التقديم...", [ChannelType.Text], { min: 1, max: 1 }))],
      }, true);
    },
  });

  bot.component("apply_setup:ch", (ctx) => {
    const gid = ctx.guildId!;
    const channelId = ctx.values[0]!;
    const applies = guildApplies(gid);
    const nums = sortedNums(applies);
    if (!nums.length) return ctx.update({ content: "❌ لا توجد أي تقديمات مسجلة! استخدم أمر `/اعداد-تقديم` أولاً.", components: [] });
    return ctx.update({
      content: "📋 حدد التقديمات التي تريد إظهارها في البانل:",
      components: [row(select(`apply_setup:pick:${channelId}`, nums.map((n) => ({ label: `تقديم ${n}: ${applies[n]!.name}`.slice(0, 100), value: n, emoji: "📌" })), {
        placeholder: "اختر التقديمات المراد إظهارها في البانل...", min: 1, max: Math.min(nums.length, 25),
      }))],
    });
  });

  bot.component("apply_setup:pick:", (ctx) => {
    const channelId = ctx.customId.split(":")[2]!;
    return ctx.showModal(modal(`apply_setup:embed:${channelId}:${ctx.values.join(",")}`, "إعداد إيمبد بانل التقديم", [
      input("title", "عنوان الإيمبد", { placeholder: "اكتب عنوان البانل هنا...", max: 256 }),
      input("desc", "وصف الإيمبد", { paragraph: true, placeholder: "اكتب وصف الإيمبد هنا...", max: 4000 }),
      input("image", "رابط صورة الإيمبد (اختياري)", { placeholder: "https://example.com/image.png", required: false }),
    ]));
  });

  bot.modal("apply_setup:embed:", (ctx) => {
    const gid = ctx.guildId!;
    const [, , channelId = "", numsStr = ""] = ctx.customId.split(":");
    if (bot.guildOfChannel(channelId) !== gid) return ctx.reply("❌ لم يتم العثور على الروم المحددة!", true);
    const image = (ctx.fields.get("image") ?? "").trim();
    if (image && !/^https?:\/\//.test(image)) return ctx.reply("❌ رابط الصورة غير صالح، يجب أن يبدأ بـ http:// أو https://", true);
    const key = token(12);
    pendingPanel.set(key, { channelId, nums: numsStr.split(",").filter(Boolean), embed: panelEmbed(gid, ctx.fields.get("title") ?? "", ctx.fields.get("desc") ?? "", image || null) });
    return ctx.reply({
      content: "🔘 حدد طريقة عرض التقديمات في البانل:",
      components: [row(
        button(`apply_setup:mode:${key}:buttons`, "أزرار", ButtonStyle.Primary, { emoji: "🔘" }),
        button(`apply_setup:mode:${key}:dropdown`, "قائمة منسدلة", ButtonStyle.Success, { emoji: "📜" }),
      )],
    }, true);
  });

  bot.component("apply_setup:mode:", async (ctx) => {
    const gid = ctx.guildId!;
    const [, , key = "", display = "dropdown"] = ctx.customId.split(":");
    const p = pendingPanel.get(key);
    if (!p) return ctx.update({ content: "⏰ انتهت المهلة، استخدم `/لوحة-التقديمات` مرة ثانية.", components: [] });
    pendingPanel.delete(key);
    try {
      await sendPanel(gid, p.channelId, p.embed, display, p.nums);
    } catch (e) {
      const msg = (e as Error).message;
      const known = msg === "الروم غير موجود" || msg === "التقديمات المحددة غير مسطّبة";
      return ctx.update({ content: known ? `❌ ${msg}` : "❌ تعذر الإرسال في هذه الروم (تأكد من صلاحيات البوت).", components: [] });
    }
    return ctx.update({ content: `✅ تم إرسال بانل التقديم بنجاح إلى الروم ${mention.channel(p.channelId)}!`, components: [] });
  });

  // ─────────── لوحة التحكم ───────────
  onJob("apply-panel", async (gid, payload: { channel_id?: string; title?: string; desc?: string; image?: string | null; display?: string; nums?: (string | number)[] }) => {
    const channelId = sid(payload?.channel_id) ?? "";
    const nums = (payload?.nums ?? []).map(String).filter((n) => /^\d+$/.test(n));
    const image = (payload?.image ?? "").trim() || null;
    if (image && !/^https?:\/\//.test(image)) throw new Error("رابط الصورة لازم يبدأ بـ http أو https");
    const e = panelEmbed(gid, String(payload?.title ?? ""), String(payload?.desc ?? ""), image);
    try {
      await sendPanel(gid, channelId, e, payload?.display === "buttons" ? "buttons" : "dropdown", nums);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "الروم غير موجود" || msg === "التقديمات المحددة غير مسطّبة") throw err;
      throw new Error("تعذر إرسال البانل، تأكد من صلاحيات البوت في الروم");
    }
    return "تم إرسال البانل";
  });
}
