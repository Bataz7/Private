/**
 * الترحيب والمغادرة (من cogs/welcome.py).
 *
 * - /الترحيب اعداد  → استوديو تفاعلي (قوائم وأزرار ونوافذ) مع معاينة مباشرة ثم حفظ.
 * - /الترحيب تجربة · /الترحيب ايقاف · /الترحيب معلومات
 * - نفس جدول welcome_settings في welcome_goodbye.db الذي تعدّله لوحة التحكم (يُقرأ عند كل حدث).
 *
 * البطاقة: بايثون كان يرسم صورة PNG بـ Pillow. هنا (بدون مكتبات صور وبميزانية ذاكرة صغيرة) البطاقة
 * حاوية Components V2: لون التمييز من الإعدادات، صورة العضو مصغّرة بجانب العنوان/الاسم/السطر الثاني/الشارة،
 * وخلفية البطاقة (card_bg) لو كانت رابط تظهر كصورة (media gallery) داخل البطاقة.
 * لو البطاقة معطّلة تُرسل الرسالة كإيمبد عادي مثل بايثون تماماً.
 */
import type { Bot } from "../discord/client.ts";
import type { CMember } from "../discord/cache.ts";
import type { Ctx, Payload } from "../discord/ctx.ts";
import { ButtonStyle, ChannelType, P } from "../discord/constants.ts";
import { db, TTL } from "../core/db.ts";
import { E } from "../core/emojis.ts";
import { o } from "../core/opts.ts";
import {
  button, channelSelect, container, embed, field, gallery, input, mention, modal, row, section, select, sep, text, thumb, V2,
} from "../core/ui.ts";

type Kind = "welcome" | "goodbye";
const KINDS: Kind[] = ["welcome", "goodbye"];
const KIND_LABEL: Record<Kind, string> = { welcome: "ترحيب", goodbye: "مغادرة" };
const EMBED_COLORS: Record<string, number> = {
  "أزرق": 0x4f8cff, "أخضر": 0x2fd18b, "أحمر": 0xff5470, "أصفر": 0xffc83d, "بنفسجي": 0x9b7bff, "برتقالي": 0xff8a3d, "أبيض": 0xf2f3f5, "أسود": 0x2b2f3a,
};
/** التصاميم القديمة (كانت ألوان خلفية الصورة) — هنا تغيّر زخرفة البطاقة فقط. */
const STYLES: Record<string, { label: string; deco: string }> = {
  royal: { label: "ملكي", deco: "👑" }, neon: { label: "نيون", deco: "⚡" }, glass: { label: "زجاجي", deco: "💠" },
  minimal: { label: "بسيط فاتح", deco: "" }, sunset: { label: "غروب", deco: "🌅" }, aurora: { label: "شفق", deco: "🌌" },
};
const D_TEXT: Record<Kind, string> = {
  welcome: "حياك الله {user} في **{server}**! 🎉\nأنت العضو رقم **{count}**.",
  goodbye: "{name} غادر **{server}**. نتمنى لك التوفيق 👋",
};
const D_TITLE: Record<Kind, string> = { welcome: "حياك الله", goodbye: "في أمان الله" };
const D_SUB: Record<Kind, string> = { welcome: "نورت {server}", goodbye: "نتمنى لك التوفيق" };
const D_BADGE: Record<Kind, string> = { welcome: "العضو رقم {count}", goodbye: "المتبقي {count} عضو" };
const VARS = "المتغيرات: `{user}` منشن · `{name}` الاسم · `{server}` السيرفر · `{count}` العدد · `{id}` الآيدي";
const NO_CFG = "ما فيه إعدادات بعد. استخدم `/الترحيب اعداد`.";
const BRAND = 0x2f6bff;

// ─────────── قاعدة البيانات ───────────
const sql = db("welcome_goodbye.db");
sql.exec(`CREATE TABLE IF NOT EXISTS welcome_settings (
            guild_id INTEGER, type TEXT, channel_id INTEGER, color TEXT, show_avatar INTEGER, ignore_bots INTEGER, disable_mention INTEGER,
            embed_type TEXT, image_url TEXT, embed_text TEXT, outside_text TEXT, status INTEGER DEFAULT 1, PRIMARY KEY (guild_id, type))`);
const COLUMNS: Record<string, string> = { card: "INTEGER DEFAULT 1", card_style: "TEXT DEFAULT 'royal'", card_bg: "TEXT", card_title: "TEXT", card_sub: "TEXT" };
for (const [c, ddl] of Object.entries(COLUMNS)) sql.addColumn("welcome_settings", c, ddl);

export interface WCfg {
  channel_id: string | null; color: string | null; show_avatar: number | null; ignore_bots: number | null; disable_mention: number | null;
  embed_type: string | null; image_url: string | null; embed_text: string | null; outside_text: string | null; status: number | null;
  card: number | null; card_style: string | null; card_bg: string | null; card_title: string | null; card_sub: string | null;
}
const SAVE_COLS = ["channel_id", "color", "show_avatar", "ignore_bots", "disable_mention", "embed_type", "image_url", "embed_text", "outside_text", "status", ...Object.keys(COLUMNS)] as (keyof WCfg)[];

const getCfg = (gid: string, kind: Kind) => sql.get<WCfg>("SELECT * FROM welcome_settings WHERE guild_id = ? AND type = ?", gid, kind);
function saveCfg(gid: string, kind: Kind, c: WCfg) {
  sql.run(
    `INSERT INTO welcome_settings(guild_id,type,${SAVE_COLS.join(",")}) VALUES(?,?,${SAVE_COLS.map(() => "?").join(",")}) `
    + `ON CONFLICT(guild_id,type) DO UPDATE SET ${SAVE_COLS.map((k) => `${k}=excluded.${k}`).join(",")}`,
    gid, kind, ...SAVE_COLS.map((k) => (c[k] ?? null) as string | number | null),
  );
}
const defaults = (): WCfg => ({
  channel_id: null, color: "#4f8cff", show_avatar: 1, ignore_bots: 1, disable_mention: 0, embed_type: "ايمبد حديث", image_url: null,
  embed_text: null, outside_text: null, status: 1, card: 1, card_style: "royal", card_bg: null, card_title: null, card_sub: null,
});

function accentOf(color: string | null | undefined): number {
  const c = color || "أزرق";
  if (c in EMBED_COLORS) return EMBED_COLORS[c]!;
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  return m && c.startsWith("#") ? parseInt(m[1]!, 16) : 0x4f8cff;
}
const isUrl = (s: string | null | undefined) => !!s && /^https?:\/\//i.test(s.trim());

/** العضو كما نحتاجه للرسالة (يشتغل حتى بعد ما يطلع من السيرفر). */
interface Person { id: string; name: string; avatar: string; bot: boolean }

export default function setup(bot: Bot): void {
  const person = (m: CMember | { id: string; username: string; globalName: string | null; avatar: string | null; bot: boolean; nick?: string | null; memberAvatar?: string | null; guildId?: string }): Person =>
    ({ id: m.id, name: bot.name({ nick: m.nick ?? null, globalName: m.globalName, username: m.username }), avatar: bot.avatar(m, 256), bot: m.bot });

  function fill(t: string | null | undefined, p: Person, gid: string, ment = true): string | null {
    if (!t) return t ?? null;
    const g = bot.guild(gid);
    return t.replaceAll("{user}", ment ? mention.user(p.id) : p.name).replaceAll("{name}", p.name)
      .replaceAll("{server}", g?.name ?? "").replaceAll("{count}", (g?.memberCount ?? 0).toLocaleString("en-US")).replaceAll("{id}", p.id);
  }

  /** يركّب رسالة الترحيب/المغادرة: بطاقة V2 أو إيمبد عادي لو البطاقة معطّلة. */
  function compose(p: Person, gid: string, kind: Kind, c: WCfg): Payload {
    const g = bot.guild(gid);
    const ment = !c.disable_mention;
    const body = fill(c.embed_text || D_TEXT[kind], p, gid, ment)!;
    const outside = fill(c.outside_text, p, gid, ment);
    const accent = accentOf(c.color);
    const allowed_mentions = { parse: ment ? ["users", "roles", "everyone"] : ["roles", "everyone"] };
    if (c.card) {
      const st = STYLES[c.card_style || "royal"] ?? STYLES.royal!;
      const title = fill(c.card_title, p, gid, false) || D_TITLE[kind];
      const sub = fill(c.card_sub, p, gid, false) || D_SUB[kind].replace("{server}", g?.name ?? "");
      const badge = D_BADGE[kind].replace("{count}", (g?.memberCount ?? 0).toLocaleString("en-US"));
      const head = [`## ${st.deco ? `${st.deco} ` : ""}${title}`, `### ${p.name}`, `${sub}\n\`${badge}\``];
      return {
        flags: V2, allowed_mentions,
        components: [
          outside ? text(outside) : null,
          container(accent,
            c.show_avatar ? section(head, thumb(p.avatar)) : text(head.join("\n")),
            sep(c.card_style !== "minimal"),
            text(body),
            isUrl(c.card_bg) ? gallery(c.card_bg!.trim()) : null,
          ),
        ].filter(Boolean),
      };
    }
    return {
      content: outside ?? undefined, allowed_mentions,
      embeds: [embed({
        description: body, color: accent,
        author: c.embed_type === "ايمبد حديث" ? { name: p.name, icon_url: p.avatar } : undefined,
        thumbnail: c.show_avatar ? p.avatar : null, image: c.image_url || null,
      })],
    };
  }

  async function canSend(gid: string, chId: string): Promise<boolean> {
    const me = await bot.me(gid);
    if (!me) return false;
    const perms = bot.channelPerms(gid, chId, me.roles, me.id);
    return (perms & (P.ViewChannel | P.SendMessages)) === (P.ViewChannel | P.SendMessages);
  }
  const textChannel = (id: string | null | undefined) => {
    const ch = id ? bot.channel(String(id)) : undefined;
    return ch && (ch.type === ChannelType.Text || ch.type === ChannelType.News) ? ch : undefined;
  };

  async function handle(gid: string, p: Person, kind: Kind) {
    const c = getCfg(gid, kind);
    if (!c || c.status === 0 || (p.bot && c.ignore_bots)) return;
    const ch = textChannel(c.channel_id);
    if (!ch || bot.guildOfChannel(ch.id) !== gid || !(await canSend(gid, ch.id))) return;
    await bot.trySend(ch.id, compose(p, gid, kind, c));
  }

  bot.on("GUILD_MEMBER_ADD", async (d, { member }) => {
    if (member) await handle(d.guild_id, person(member), "welcome");
  });
  bot.on("GUILD_MEMBER_REMOVE", async (d, { before }) => {
    const u = d.user;
    if (!u) return;
    const p = before ? person(before) : person({ id: u.id, username: u.username, globalName: u.global_name ?? null, avatar: u.avatar ?? null, bot: !!u.bot });
    await handle(d.guild_id, p, "goodbye");
  });

  // ─────────── الاستوديو ───────────
  interface Studio { owner: string; gid: string; kind: Kind; cfg: WCfg }
  const studios = new TTL<Studio>(900_000, 50);
  const token = () => Math.random().toString(36).slice(2, 10);
  const me = (ctx: Ctx): Person => (ctx.member ? person(ctx.member) : person(ctx.user));

  /** معاينة داخل رسالة الاستوديو (V2): البطاقة كما هي، والإيمبد يتحول لحاوية مشابهة. */
  function preview(p: Payload): any[] {
    if (p.flags) return p.components ?? [];
    const e = p.embeds![0]!;
    const out: any[] = [];
    if (p.content) out.push(text(p.content));
    const desc = [e.author ? `**${e.author.name}**` : "", e.description ?? ""].filter(Boolean).join("\n");
    out.push(container(e.color ?? BRAND,
      e.thumbnail ? section([desc], thumb(e.thumbnail.url)) : text(desc),
      e.image ? gallery(e.image.url) : null,
      text("-# البطاقة معطّلة — تُرسل الرسالة كإيمبد عادي."),
    ));
    return out;
  }

  function studioView(ctx: Ctx, t: string, s: Studio): Payload {
    const c = s.cfg;
    const id = (a: string) => `wl:st:${t}:${a}`;
    const tg = (on: unknown) => (on ? ButtonStyle.Success : ButtonStyle.Secondary);
    const chSel: any = channelSelect(id("chan"), "📍 اختر روم الرسالة", [ChannelType.Text]);
    if (c.channel_id) chSel.default_values = [{ id: String(c.channel_id), type: "channel" }];
    const on = c.status ?? 1;
    return {
      flags: V2,
      components: [
        container(BRAND, text(`## ${E("welcome")} ${s.kind === "welcome" ? "استوديو الترحيب" : "استوديو المغادرة"}\nعدّل التصميم من القوائم والأزرار وشاهد المعاينة مباشرة، ثم اضغط **حفظ**.\n-# ${VARS}`
          + `\n-# 📍 الروم: ${c.channel_id ? mention.channel(String(c.channel_id)) : "—"}`)),
        ...preview(compose(me(ctx), s.gid, s.kind, c)),
        row(select(id("style"), Object.entries(STYLES).map(([v, x]) => ({ label: x.label, value: v, default: (c.card_style || "royal") === v, emoji: E("palette") })), { placeholder: "🎨 اختر تصميم البطاقة" })),
        row(select(id("color"), [
          ...Object.keys(EMBED_COLORS).map((n) => ({ label: n, value: n, default: c.color === n })),
          { label: "لون مخصص", value: "__hex", emoji: E("palette"), default: !!c.color && c.color.startsWith("#") },
        ], { placeholder: "🌈 اختر لون التمييز" })),
        row(chSel),
        row(
          button(id("texts"), "النصوص", ButtonStyle.Primary, { emoji: E("message") }),
          button(id("bg"), "الخلفية", ButtonStyle.Secondary, { emoji: E("image") }),
          button(id("card"), "البطاقة", tg(c.card), { emoji: E("eye") }),
          button(id("avatar"), "الصورة", tg(c.show_avatar), { emoji: E("user") }),
          button(id("mention"), "المنشن", tg(!c.disable_mention), { emoji: E("users") }),
        ),
        row(
          button(id("save"), "حفظ", ButtonStyle.Success, { emoji: E("success") }),
          button(id("test"), "تجربة", ButtonStyle.Secondary, { emoji: E("bolt") }),
          button(id("bots"), "تجاهل البوتات", tg(c.ignore_bots), { emoji: E("bot") }),
          button(id("status"), `الحالة: ${on ? "مفعّل" : "معطّل"}`, tg(on), { emoji: E(on ? "on" : "off") }),
          button(id("cancel"), "إلغاء", ButtonStyle.Danger, { emoji: E("error") }),
        ),
      ],
    };
  }

  const studioOf = async (ctx: Ctx, t: string): Promise<Studio | null> => {
    const s = studios.get(t);
    if (!s) {
      await ctx.reply("⌛ انتهت صلاحية الاستوديو، افتحه من جديد بـ `/الترحيب اعداد`.", true);
      return null;
    }
    if (s.owner !== ctx.user.id) {
      await ctx.reply("هذا الاستوديو لصاحب الأمر فقط.", true);
      return null;
    }
    return s;
  };
  const done = (ctx: Ctx, accent: number, msg: string) => ctx.update({ flags: V2, components: [container(accent, text(msg))] });

  const TOGGLES: Record<string, [keyof WCfg, number]> = { card: ["card", 1], avatar: ["show_avatar", 1], mention: ["disable_mention", 0], bots: ["ignore_bots", 0], status: ["status", 1] };

  bot.component("wl:st:", async (ctx) => {
    const [, , t, action] = ctx.customId.split(":") as [string, string, string, string];
    const s = await studioOf(ctx, t);
    if (!s) return;
    const c = s.cfg;
    const refresh = () => ctx.update(studioView(ctx, t, s));
    if (action in TOGGLES) {
      const [key, def] = TOGGLES[action]!;
      (c as any)[key] = (c[key] ?? def) ? 0 : 1;
      return refresh();
    }
    switch (action) {
      case "style":
        c.card_style = ctx.values[0] && ctx.values[0] in STYLES ? ctx.values[0] : "royal";
        return refresh();
      case "color":
        if (ctx.values[0] === "__hex") {
          return ctx.showModal(modal(`wl:m:${t}:hex`, "لون مخصص", [input("v", "الكود مثل #7C4DFF", { min: 6, max: 7, placeholder: "#7C4DFF" })]));
        }
        c.color = ctx.values[0] ?? c.color;
        return refresh();
      case "chan":
        c.channel_id = ctx.values[0] ?? null;
        return refresh();
      case "texts":
        return ctx.showModal(modal(`wl:m:${t}:texts`, "نصوص الرسالة", [
          input("embed", "نص الإيمبد", { paragraph: true, required: false, max: 1000, value: c.embed_text ?? undefined, placeholder: D_TEXT[s.kind].slice(0, 100) }),
          input("out", "نص خارج الإيمبد (اختياري)", { required: false, max: 300, value: c.outside_text ?? undefined }),
          input("title", "عنوان البطاقة", { required: false, max: 40, value: c.card_title ?? undefined, placeholder: D_TITLE[s.kind] }),
          input("sub", "السطر الثاني في البطاقة", { required: false, max: 70, value: c.card_sub ?? undefined }),
        ]));
      case "bg":
        return ctx.showModal(modal(`wl:m:${t}:bg`, "خلفية البطاقة", [
          input("bg", "رابط صورة الخلفية (فاضي = بدون)", { required: false, max: 400, value: c.card_bg ?? undefined }),
          input("img", "رابط صورة الإيمبد (لو البطاقة معطلة)", { required: false, max: 400, value: c.image_url ?? undefined }),
        ]));
      case "test": {
        const ch = textChannel(c.channel_id);
        if (!ch) return ctx.reply("اختر روم الرسالة أولاً من القائمة.", true);
        await bot.send(ch.id, compose(me(ctx), s.gid, s.kind, c));
        return ctx.reply(`📨 أُرسلت رسالة تجريبية إلى ${mention.channel(ch.id)}.`, true);
      }
      case "save": {
        const ch = textChannel(c.channel_id);
        if (!ch) return ctx.reply("اختر روم الرسالة أولاً من القائمة.", true);
        const meM = await bot.me(s.gid);
        const need = P.ViewChannel | P.SendMessages | P.EmbedLinks;
        if (!meM || (bot.channelPerms(s.gid, ch.id, meM.roles, meM.id) & need) !== need) {
          return ctx.reply(`البوت يحتاج صلاحية **إرسال الرسائل + تضمين الروابط** في ${mention.channel(ch.id)}.`, true);
        }
        saveCfg(s.gid, s.kind, c);
        studios.delete(t);
        return done(ctx, 0x1fc46a, `### ${E("success")} ${s.kind === "welcome" ? "استوديو الترحيب" : "استوديو المغادرة"}\n✅ تم حفظ إعدادات **${KIND_LABEL[s.kind]}** وهي الآن **${(c.status ?? 1) ? "مفعّل" : "معطّل"}** في ${mention.channel(ch.id)}.`);
      }
      case "cancel":
        studios.delete(t);
        return done(ctx, 0xffa51f, "تم إلغاء الاستوديو.");
    }
  });

  bot.modal("wl:m:", async (ctx) => {
    const [, , t, which] = ctx.customId.split(":") as [string, string, string, string];
    const s = await studioOf(ctx, t);
    if (!s) return;
    const c = s.cfg;
    const f = (k: string) => (ctx.fields.get(k) ?? "").trim();
    if (which === "texts") {
      c.embed_text = f("embed") || null;
      c.outside_text = f("out") || null;
      c.card_title = f("title") || null;
      c.card_sub = f("sub") || null;
    } else if (which === "bg") {
      const bg = f("bg");
      const img = f("img");
      if ((bg && !isUrl(bg)) || (img && !isUrl(img))) return ctx.reply("❌ الرابط لازم يبدأ بـ http أو https", true);
      c.card_bg = bg || null;
      c.image_url = img || null;
    } else if (which === "hex") {
      const v = f("v");
      if (!/^#?[0-9a-fA-F]{6}$/.test(v)) return ctx.reply("❌ كود اللون غير صحيح. مثال: #7C4DFF", true);
      c.color = `#${v.replace(/^#/, "").toLowerCase()}`;
    }
    await ctx.update(studioView(ctx, t, s));
  });

  // ─────────── الأوامر ───────────
  const kindOpt = () => o.choice("النوع", "النوع", [["ترحيب", "welcome"], ["مغادرة", "goodbye"]], { required: false });
  bot.command({
    name: "الترحيب", description: "إعداد الترحيب والمغادرة", perms: P.ManageGuild,
    options: [
      o.sub("اعداد", "افتح استوديو تصميم رسالة الترحيب أو المغادرة", [kindOpt()]),
      o.sub("تجربة", "أرسل رسالة تجريبية في روم الترحيب", [kindOpt()]),
      o.sub("ايقاف", "إيقاف رسالة الترحيب أو المغادرة", [kindOpt()]),
      o.sub("معلومات", "عرض الإعدادات الحالية"),
    ],
    run: async (ctx) => {
      const gid = ctx.guildId;
      if (!gid) return ctx.fail("هذا الأمر داخل السيرفر فقط.");
      const kind: Kind = ctx.str("النوع") === "goodbye" ? "goodbye" : "welcome";
      if (ctx.sub !== "معلومات" && !ctx.can(P.ManageGuild)) return ctx.reply("❌ ما عندك صلاحية لاستخدام هذا.", true);
      switch (ctx.sub) {
        case "اعداد": {
          const cur = getCfg(gid, kind) ?? {};
          const cfg = { ...defaults(), ...Object.fromEntries(Object.entries(cur).filter(([, v]) => v !== null && v !== undefined)) } as WCfg;
          if (cfg.channel_id) cfg.channel_id = String(cfg.channel_id);
          const t = token();
          const s: Studio = { owner: ctx.user.id, gid, kind, cfg };
          studios.set(t, s);
          return ctx.reply(studioView(ctx, t, s), true);
        }
        case "تجربة": {
          const c = getCfg(gid, kind);
          const ch = c ? textChannel(c.channel_id) : undefined;
          if (!c || !ch) return ctx.reply(NO_CFG, true);
          await ctx.defer(true);
          await bot.send(ch.id, compose(me(ctx), gid, kind, c));
          return ctx.edit(`📨 أُرسلت رسالة تجريبية إلى ${mention.channel(ch.id)}.`);
        }
        case "ايقاف":
          sql.run("UPDATE welcome_settings SET status = 0 WHERE guild_id = ? AND type = ?", gid, kind);
          return ctx.reply(`تم إيقاف رسالة **${KIND_LABEL[kind]}**.`, true);
        case "معلومات": {
          const fields = KINDS.map((k) => {
            const c = getCfg(gid, k);
            if (!c) return field(KIND_LABEL[k], `\`${NO_CFG}\``);
            const ch = textChannel(c.channel_id);
            const style = STYLES[c.card_style || "royal"]?.label ?? c.card_style;
            return field(KIND_LABEL[k], `**الروم:** ${ch ? mention.channel(ch.id) : "—"}\n**البطاقة:** ${c.card ? "✅" : "❌"} · \`${style}\`\n**الحالة:** ${c.status !== 0 ? "مفعّل" : "معطّل"}`);
          });
          return ctx.reply({ embeds: [embed({ title: `${E("welcome")} إعدادات الترحيب`, color: BRAND, fields })] }, true);
        }
      }
    },
  });
}

/** للاختبارات. */
export const _test = { sql, getCfg, saveCfg, defaults, accentOf };
