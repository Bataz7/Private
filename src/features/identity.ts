/**
 * الهوية الوطنية (cogs/id.py) — العضو يختار من القائمة، تجيه 6 أسئلة بالخاص (مع صورة حساب روبلوكس ورقم هوية من 4 أرقام)،
 * يضغط «أتعهد وأوافق» ويروح الطلب لروم الإدارة مع زرين قبول/رفض.
 * القبول: يغيّر اسمه «يوزر روبلوكس | رقم الهوية» (اختياري) ويعطي/يسحب الرتب ويضيفه لقائمة submitted.
 *
 * id_data.json — إعداد واحد عام (مو لكل سيرفر، نفس بايثون ولوحة التحكم):
 *   {submitted: [user_id…], admins_channel_id, change_nick, add_role_id, rem_role_id, panel_channel_id?}
 */
import type { Bot } from "../discord/client.ts";
import type { Ctx } from "../discord/ctx.ts";
import { ButtonStyle, P } from "../discord/constants.ts";
import { JsonStore, TTL } from "../core/db.ts";
import { onJob } from "../core/jobs.ts";
import { o } from "../core/opts.ts";
import { button, embed, input, mention, modal, row, select, type Embed } from "../core/ui.ts";
import { beginDmFlow, cleanEmbed, endDmFlow, setupWaiters, token, waitForMessage } from "./activation/shared.ts";

const store = new JsonStore("id_data.json");

interface IdData {
  submitted: (string | number)[]; admins_channel_id: string | null; change_nick: boolean; add_role_id: string | null; rem_role_id: string | null;
  [k: string]: unknown;
}

const sid = (v: unknown): string | null => (v === null || v === undefined || v === "" || v === 0 ? null : String(v));

function load(): IdData {
  const d = store.get() as Partial<IdData>;
  if (!Array.isArray(d.submitted)) d.submitted = [];
  if (!("change_nick" in d)) d.change_nick = true;
  if (!("add_role_id" in d)) d.add_role_id = null;
  if (!("rem_role_id" in d)) d.rem_role_id = null;
  if (!("admins_channel_id" in d)) d.admins_channel_id = null;
  return d as IdData;
}
const isSubmitted = (d: IdData, uid: string) => d.submitted.some((x) => String(x) === uid);

const SELECT_ID = "persistent_id_select_menu";
const OPT_APPLY = "تـقـديـم الـهـويـة الـوطـنـيـة 🪪";
const OPT_RESET = "اعادة التشغيل";
const BLUE = 0x3498db;
const GOLD = 0xf1c40f;
const GREEN = 0x2ecc71;
const RED = 0xe74c3c;
const PANEL_DESC =
  "أهلاً بك في نظام استخراج الهويات الوطنية الرسمية للسيرفر.\n"
  + "من هنا يمكنك توثيق حسابك للحصول على كامل الصلاحيات والمزايا الخاصة بالمجتمع.\n"
  + "نحرص دائماً على تنظيم الرول بلاي وتقديم أفضل تجربة ترفيهية تناسب الجميع.\n"
  + "يرجى التأكد من إدخال معلوماتك بدقة واجتياز المتطلبات المطلوبة لتجنب رفض الطلب.\n"
  + "نسعد بانضمامك الدائم وتواجدك المميز معنا في أوقاتك الممتعة.\n"
  + "اختر من القائمة أدناه للبدء في عملية التقديم بكل سهولة ويسر.";

interface Answers { name: string; age: string; country: string; image_url: string; roblox_user: string; id_num: string }
/** إجابات تنتظر زر «أتعهد وأوافق» (3 دقائق مثل بايثون). */
const pendingAgree = new TTL<{ userId: string; username: string; avatar: string; answers: Answers }>(180_000, 500);

export default function setup(bot: Bot): void {
  setupWaiters(bot);

  const panelRow = () => row(select(SELECT_ID, [
    { label: OPT_APPLY, value: OPT_APPLY, description: "اضغط هنا لبدء تقديم طلب الهوية بالخاص", emoji: "🪪" },
    { label: OPT_RESET, value: OPT_RESET, description: "إعادة تعيين خيارات القائمة", emoji: "🔄" },
  ], { placeholder: "اضغط هنا لاختيار الخدمة...", min: 1, max: 1 }));

  const panelEmbed = (gid: string): Embed => {
    const g = bot.guild(gid);
    const ic = bot.guildIcon(g);
    return embed({
      title: "الـهـويـة الـوطـنـيـة 🪪", description: PANEL_DESC, color: BLUE, now: false,
      author: ic && g ? { name: g.name, icon_url: ic } : undefined, thumbnail: ic,
    });
  };
  const sendPanel = (gid: string, channelId: string) => bot.send(channelId, { embeds: [panelEmbed(gid)], components: [panelRow()] });

  const reviewRow = () => row(
    button("accept_id_btn", "قبول", ButtonStyle.Success),
    button("reject_id_btn", "رفض", ButtonStyle.Danger),
  );

  // ─────────── القائمة + أسئلة الخاص ───────────
  bot.component(SELECT_ID, async (ctx) => {
    if (ctx.message && ctx.guildId) bot.edit(ctx.channelId, ctx.message.id, { components: [panelRow()] }).catch(() => undefined);
    if (ctx.values[0] === OPT_RESET) return ctx.reply("🔄 تم إعادة تشغيل القائمة بنجاح.", true);
    const uid = ctx.user.id;
    if (isSubmitted(load(), uid)) return ctx.reply("⚠️ لقد قمت بتقديم الهوية وتم قبولك مسبقاً، لا يمكنك التقديم مرة أخرى!", true);
    if (!beginDmFlow(uid)) return ctx.reply("⏳ عندك أسئلة جارية في الخاص، أكملها أولاً.", true);
    try {
      await ctx.reply("📬 تم إرسال الأسئلة لك في **الخاص**، يرجى التوجه هناك لإكمال التقديم!", true);
      const fail = () => bot.dm(uid, "❌ انتهى الوقت المخصص للإجابة أو حدث خطأ، يرجى إعادة محاولة التقديم من السيرفر.");
      const ask = async (q: string): Promise<any | null> => {
        if (!(await bot.dm(uid, q))) return null;
        return waitForMessage(bot, uid, null, 120_000);
      };

      const first = await bot.dm(uid, "📌 **السؤال (1/6):** ما هو اسمك بالرول؟");
      if (!first) {
        await ctx.followup("❌ ما قدرت أرسل لك في الخاص، افتح الخاص وحاول مرة ثانية.", true).catch(() => undefined);
        return;
      }
      const m1 = await waitForMessage(bot, uid, null, 120_000);
      if (!m1) return void (await fail());
      const m2 = await ask("📌 **السؤال (2/6):** كم عمرك بالرول؟");
      if (!m2) return void (await fail());
      const m3 = await ask("📌 **السؤال (3/6):** من أي دولة أنت؟");
      if (!m3) return void (await fail());
      const m4 = await ask("📌 **السؤال (4/6):** أرسل **صورة** لحسابك في روبلوكس (في حال أرسلت شيئاً غير الصورة سيتم الرفض فوراً):");
      if (!m4) return void (await fail());
      if (!m4.attachments?.length) {
        await bot.dm(uid, "❌ لم تقم بإرسال صورة، تم إلغاء تقديمك.");
        return;
      }
      const imageUrl: string = m4.attachments[0].url;
      const m5 = await ask("📌 **السؤال (5/6):** ما هو يوزرك في روبلوكس؟");
      if (!m5) return void (await fail());
      let idNum = "";
      for (;;) {
        const m6 = await ask("📌 **السؤال (6/6):** اختر رقم هوية مكوناً من **4 أرقام إنجليزية** فقط (مثال: 0506):");
        if (!m6) return void (await fail());
        idNum = String(m6.content ?? "").trim();
        if (/^[0-9]{4}$/.test(idNum)) break;
        await bot.dm(uid, "❌ خطأ! يرجى إرسال **أرقام إنجليزية** فقط وبطول 4 أرقام تماماً. حاول مرة أخرى:");
      }

      const key = token(16);
      pendingAgree.set(key, {
        userId: uid, username: ctx.user.username, avatar: bot.avatar(ctx.member ?? ctx.user),
        answers: { name: String(m1.content ?? ""), age: String(m2.content ?? ""), country: String(m3.content ?? ""), image_url: imageUrl, roblox_user: String(m5.content ?? ""), id_num: idNum },
      });
      await bot.dm(uid, {
        content: "📌 **السؤال (7/7):** هل تتعهد بقوانين الرول بلاي وعدم التخريب؟\nاضغط على الزر أدناه لإرسال طلبك نهائياً للإدارة:",
        components: [row(button(`id_agree:${key}`, "أتعهد وأوافق", ButtonStyle.Success))],
      });
    } finally {
      endDmFlow(uid);
    }
  });

  // ─────────── «أتعهد وأوافق» ───────────
  bot.component("id_agree:", async (ctx) => {
    const key = ctx.customId.slice("id_agree:".length);
    const p = pendingAgree.get(key);
    if (!p || p.userId !== ctx.user.id) return ctx.reply("⏰ انتهت مهلة التقديم، يرجى إعادة محاولة التقديم من السيرفر.", true);
    const data = load();
    const channelId = sid(data.admins_channel_id);
    if (!channelId) return ctx.reply("❌ لم يتم تحديد روم الإدارة بعد!", true);
    if (!bot.channel(channelId)) return ctx.reply("❌ روم الإدارة غير موجود!", true);
    const a = p.answers;
    const e = embed({
      title: "📋 طلب هوية وطنية جديد", color: GOLD, now: false,
      author: { name: `العضو: ${p.username} (الآيدي: ${p.userId})`, icon_url: p.avatar },
      fields: [
        { name: "١- الاسم بالرول", value: a.name.slice(0, 1024) || "—" },
        { name: "٢- العمر", value: a.age.slice(0, 1024) || "—" },
        { name: "٣- الدولة", value: a.country.slice(0, 1024) || "—" },
        { name: "٥- يوزر روبلوكس", value: a.roblox_user.slice(0, 1024) || "—" },
        { name: "٦- رقم الهوية", value: a.id_num },
        { name: "٧- التعهد", value: "متعهد بقوانين الرول بلاي وعدم التخريب ✅", inline: false },
      ],
      image: a.image_url || null,
      footer: { text: `صاحب الطلب: ${p.userId}` },
    });
    const ping = sid(data.add_role_id);
    try {
      await bot.send(channelId, { content: ping ? mention.role(ping) : "", embeds: [e], components: [reviewRow()], allowed_mentions: ping ? { roles: [ping] } : { parse: [] } });
    } catch {
      return ctx.reply("❌ تعذر إرسال الطلب لروم الإدارة (تأكد من صلاحيات البوت).", true);
    }
    pendingAgree.delete(key);
    await ctx.reply("✅ تم إرسال تقديمك بنجاح إلى الإدارة، انتظر رد الإدارة بالخاص!", true);
    if (ctx.message) bot.edit(ctx.channelId, ctx.message.id, { components: [] }).catch(() => undefined);
  });

  // ─────────── مراجعة الإدارة ───────────
  /** يقرأ بيانات الطلب من الإيمبد (تشتغل حتى بعد إعادة التشغيل). */
  const parseRequest = (msg: any) => {
    const e = msg?.embeds?.[0];
    const uid = /(\d{15,})/.exec(e?.footer?.text ?? "")?.[1] ?? /(\d{15,})/.exec(e?.author?.name ?? "")?.[1] ?? null;
    const field = (prefix: string) => String((e?.fields ?? []).find((f: any) => String(f.name).startsWith(prefix))?.value ?? "");
    const username = /العضو:\s*(.+?)\s*\(الآيدي/.exec(e?.author?.name ?? "")?.[1] ?? uid ?? "";
    return { e, uid, username, roblox: field("٥-"), idNum: field("٦-") };
  };

  const updatedEmbed = (old: any, title: string, description: string, color: number, footer: string): Embed => {
    const prev = cleanEmbed(old);
    const e: Embed = { title, description: description.slice(0, 4096), color, footer: { text: footer } };
    if (prev.author) e.author = prev.author;
    if (prev.fields) e.fields = prev.fields;
    if (prev.image) e.image = prev.image;
    return e;
  };

  const busy = new Set<string>();

  bot.component("accept_id_btn", async (ctx) => {
    const gid = ctx.guildId;
    if (!gid || !ctx.message) return ctx.deferUpdate();
    const r = parseRequest(ctx.message);
    if (!r.e || !r.uid) return ctx.fail("تعذر قراءة بيانات الطلب.");
    if (busy.has(ctx.message.id)) return ctx.fail("⏳ هذا الطلب قيد المعالجة من مسؤول آخر.");
    busy.add(ctx.message.id);
    try {
      await ctx.defer(true);
      const data = load();
      if (!isSubmitted(data, r.uid)) {
        data.submitted.push(r.uid);
        store.save(data);
      }
      const member = await bot.member(gid, r.uid);
      const adminName = ctx.member ? bot.name(ctx.member) : bot.name(ctx.user);
      if (member) {
        if (data.change_nick !== false) {
          await bot.setNick(gid, member.id, `${r.roblox} | ${r.idNum}`.slice(0, 32), "قبول الهوية الوطنية").catch(() => undefined);
        }
        const rem = sid(data.rem_role_id);
        if (rem && bot.role(gid, rem) && member.roles.includes(rem)) await bot.removeRole(gid, member.id, rem, "قبول الهوية الوطنية").catch(() => undefined);
        const add = sid(data.add_role_id);
        if (add && bot.role(gid, add) && !member.roles.includes(add)) await bot.addRole(gid, member.id, add, "قبول الهوية الوطنية").catch(() => undefined);
        await bot.dm(member.id, `🎉 مبروك! تم **قبول** طلب الهوية الوطنية الخاصة بك بواسطة الإداري: ${adminName}`);
      }
      const e = updatedEmbed(r.e, "📋 طلب هوية وطنية (تم القبول ✅)",
        `👤 **العضو:** ${mention.user(r.uid)} (\`${r.username}\`)\n🛡️ **المسؤول:** ${mention.user(ctx.user.id)} (\`${ctx.user.username}\`)`,
        GREEN, `تم القبول بواسطة: ${ctx.user.username}`);
      await bot.edit(ctx.channelId, ctx.message.id, { embeds: [e], components: [] }).catch(() => undefined);
      await ctx.followup("✅ تم قبول العضو بنجاح.", true);
    } finally {
      busy.delete(ctx.message.id);
    }
  });

  bot.component("reject_id_btn", (ctx) => {
    if (!ctx.guildId || !ctx.message) return ctx.deferUpdate();
    return ctx.showModal(modal("id_reject_modal", "سبب الرفض", [input("reason", "اكتب سبب رفض الهوية هنا:", { paragraph: true, required: true })]));
  });

  bot.modal("id_reject_modal", async (ctx: Ctx) => {
    const gid = ctx.guildId;
    const message = ctx.message;
    if (!gid || !message) return ctx.fail("تعذر قراءة بيانات الطلب.");
    const r = parseRequest(message);
    if (!r.e || !r.uid) return ctx.fail("تعذر قراءة بيانات الطلب.");
    const reason = ctx.fields.get("reason") ?? "";
    await ctx.defer(true);
    const adminName = ctx.member ? bot.name(ctx.member) : bot.name(ctx.user);
    const member = await bot.member(gid, r.uid);
    if (member) await bot.dm(member.id, `❌ عذراً، تم **رفض** طلب الهوية الوطنية الخاصة بك بواسطة الإداري: ${adminName}.\nالسبب: ${reason}`);
    const e = updatedEmbed(r.e, "📋 طلب هوية وطنية (تم الرفض ❌)",
      `👤 **العضو:** ${mention.user(r.uid)} (\`${r.username}\`)\n🛡️ **المسؤول:** ${mention.user(ctx.user.id)} (\`${ctx.user.username}\`)\n📌 **السبب:** ${reason}`,
      RED, `تم الرفض بواسطة: ${ctx.user.username}`);
    await bot.edit(ctx.channelId, message.id, { embeds: [e], components: [] }).catch(() => undefined);
    await ctx.followup("❌ تم رفض الطلب وإرسال السبب للعضو.", true);
  });

  // ─────────── /لوحة-الهوية ───────────
  bot.command({
    name: "لوحة-الهوية", description: "إرسال لوحة الهوية الوطنية وتحديد الإعدادات", perms: P.Administrator,
    options: [
      o.channel("روم_الادارة", "روم الإدارة لاستقبال التقديمات"),
      o.bool("تغيير_الاسم", "هل يتم تغيير اسم العضو بعد القبول تلقائياً؟", { required: false }),
      o.role("رتبة_القبول", "رتبة يتم إعطاؤها عند القبول (اختياري)", { required: false }),
      o.role("رتبة_الازالة", "رتبة يتم إزالتها عند القبول مثل رتبة مواطن جديد (اختياري)", { required: false }),
    ],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("❌ هذا الأمر للمسؤولين فقط!");
      const gid = ctx.guildId!;
      const channel = ctx.id("روم_الادارة")!;
      const changeNick = ctx.bool("تغيير_الاسم") ?? true;
      const add = ctx.id("رتبة_القبول") ?? null;
      const rem = ctx.id("رتبة_الازالة") ?? null;
      const data = load();
      data.admins_channel_id = channel;
      data.change_nick = changeNick;
      data.add_role_id = add;
      data.rem_role_id = rem;
      store.save(data);
      try {
        await sendPanel(gid, ctx.channelId);
      } catch {
        return ctx.fail("❌ ما قدرت أرسل اللوحة في هذا الروم، تأكد من صلاحيات البوت.");
      }
      let info = `\n• تغيير الاسم: \`${changeNick ? "مفعل" : "معطل"}\``;
      if (add) info += `\n• رتبة الإعطاء: ${mention.role(add)}`;
      if (rem) info += `\n• رتبة الإزالة: ${mention.role(rem)}`;
      return ctx.reply(`✅ تم إرسال لوحة الهوية بنجاح وتحديث الإعدادات إلى روم: ${mention.channel(channel)}${info}`, true);
    },
  });

  // ─────────── لوحة التحكم ───────────
  onJob("identity-panel", async (gid, payload: { channel_id?: string } | null) => {
    const ch = sid(payload?.channel_id) ?? sid(load().panel_channel_id);
    if (!ch || bot.guildOfChannel(ch) !== gid) throw new Error("حدد روم إرسال بانل الهوية");
    try {
      await sendPanel(gid, ch);
    } catch {
      throw new Error("تعذر إرسال البانل، تأكد من صلاحيات البوت في الروم");
    }
    return "تم إرسال البانل";
  });
}
