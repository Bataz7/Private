/**
 * الردود التلقائية لكل سيرفر — auto_responses.json
 * الشكل: { guild_id: { keyword: { response, match_type: "contains"|"exact", mention: "true"|"false" } } }
 * لوحة التحكم تكتب في نفس الملف، فنعيد قراءته إذا تغيّر (فحص التغيير كل بضع ثواني فقط).
 */
import type { Bot } from "../discord/client.ts";
import { P } from "../discord/constants.ts";
import { JsonStore } from "../core/db.ts";
import { o } from "../core/opts.ts";
import { mention } from "../core/ui.ts";

interface Resp { response: string; match_type?: string; mention?: string }
type Data = Record<string, Record<string, Resp>>;

const store = new JsonStore<Data>("auto_responses.json");

/** الشكل القديم: {keyword: {response, match_type, mention}} بدون سيرفر. */
const isLegacy = (d: Record<string, any>) =>
  Object.values(d).some((v) => v && typeof v === "object" && "response" in v && "match_type" in v);

let cached: Data = {};
let checkedAt = 0;
let legacy: Record<string, Resp> | null = null;

/** البيانات الحالية (يفحص الملف على القرص بحد أقصى مرة كل 3 ثواني). */
function data(force = false): Data {
  if (force || Date.now() - checkedAt > 3000) {
    checkedAt = Date.now();
    const raw = store.get();
    if (isLegacy(raw)) {
      legacy = raw as unknown as Record<string, Resp>;
      cached = {};
    } else cached = raw;
  }
  return cached;
}

function save(d: Data) {
  store.save(d);
  cached = d;
  checkedAt = Date.now();
}

const MATCH: [string, string][] = [["تتضمن", "contains"], ["مطابقة تماماً", "exact"]];
const YES_NO: [string, string][] = [["نعم", "true"], ["لا", "false"]];

export default function setup(bot: Bot): void {
  // ترحيل الردود القديمة (كانت تشتغل بكل السيرفرات): ننسخها لكل سيرفر موجود فيه البوت
  bot.on("ready", () => {
    data(true);
    if (!legacy) return;
    const out: Data = {};
    for (const gid of bot.cache.guilds.keys()) out[gid] = { ...legacy };
    legacy = null;
    save(out);
  });

  const guildMap = (d: Data, gid: string) => (d[gid] ??= {});

  bot.command({
    name: "اضافة-رد", description: "إضافة رد تلقائي جديد", perms: P.Administrator,
    options: [
      o.str("الكلمة", "الكلمة المفتاحية"), o.str("الرد", "الرد"),
      o.choice("نوع_المطابقة", "نوع المطابقة", MATCH), o.choice("منشن_العضو", "منشن العضو", YES_NO),
    ],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("هذا الأمر للأدمن فقط.");
      const keyword = ctx.str("الكلمة")!;
      const d = data(true);
      guildMap(d, ctx.guildId!)[keyword.toLowerCase().trim()] = {
        response: ctx.str("الرد")!, match_type: ctx.str("نوع_المطابقة")!, mention: ctx.str("منشن_العضو")!,
      };
      save(d);
      await ctx.reply(`✅ تم إضافة الرد للكلمة: \`${keyword}\` في هذا السيرفر بنجاح!`, true);
    },
  });

  bot.command({
    name: "تعديل-رد", description: "تعديل رد تلقائي موجود", perms: P.Administrator,
    options: [
      o.str("الكلمة", "الكلمة المفتاحية الموجودة"), o.str("الرد_الجديد", "الرد الجديد"),
      o.choice("نوع_المطابقة", "نوع المطابقة", MATCH), o.choice("منشن_العضو", "منشن العضو", YES_NO),
    ],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("هذا الأمر للأدمن فقط.");
      const keyword = ctx.str("الكلمة")!;
      const d = data(true);
      const rs = guildMap(d, ctx.guildId!);
      const key = keyword.toLowerCase().trim();
      if (!(key in rs)) return ctx.reply(`❌ الكلمة \`${keyword}\` غير مسجلة في هذا السيرفر!`, true);
      rs[key] = { response: ctx.str("الرد_الجديد")!, match_type: ctx.str("نوع_المطابقة")!, mention: ctx.str("منشن_العضو")! };
      save(d);
      await ctx.reply(`✅ تم تعديل الرد للكلمة: \`${keyword}\` بنجاح!`, true);
    },
  });

  bot.command({
    name: "حذف-رد", description: "حذف رد تلقائي", perms: P.Administrator,
    options: [o.str("الكلمة", "الكلمة المراد حذفها")],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("هذا الأمر للأدمن فقط.");
      const keyword = ctx.str("الكلمة")!;
      const d = data(true);
      const rs = guildMap(d, ctx.guildId!);
      const key = keyword.toLowerCase().trim();
      if (!(key in rs)) return ctx.reply(`❌ الكلمة \`${keyword}\` غير موجودة في هذا السيرفر!`, true);
      delete rs[key];
      save(d);
      await ctx.reply(`🗑️ تم حذف الرد للكلمة: \`${keyword}\` بنجاح!`, true);
    },
  });

  bot.on("MESSAGE_CREATE", async (d) => {
    if (!d.guild_id || d.author?.bot || d.webhook_id) return;
    const rs = data()[d.guild_id]; // ردود هذا السيرفر فقط
    if (!rs) return;
    const content = String(d.content ?? "").toLowerCase();
    if (!content) return;
    let words: string[] | null = null;
    for (const [keyword, r] of Object.entries(rs)) {
      if (!r || typeof r !== "object") continue;
      let matched: boolean;
      if (r.match_type === "exact") matched = content === keyword || (words ??= content.split(/\s+/).filter(Boolean)).includes(keyword);
      else matched = content.includes(keyword);
      if (!matched) continue;
      const text = r.mention === "true" ? `${mention.user(d.author.id)} ${r.response}` : String(r.response ?? "");
      await bot.trySend(d.channel_id, { content: text, allowed_mentions: { parse: ["users", "roles", "everyone"] } });
      break;
    }
  });
}
