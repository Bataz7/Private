/**
 * الاختصارات الإدارية — shortcuts.db
 * أول كلمة في الرسالة (بدون !/.#) لو كانت اختصار مفعّل تنفذ عمليته: باند، طرد، تايم أوت، مسح، تحذير، فك باند، رتبة، تغيير اسم.
 * الاختصارات لكل سيرفر في كاش 30 ثانية (لوحة التحكم تعدّل القاعدة مباشرة).
 */
import type { Bot } from "../discord/client.ts";
import type { CMember } from "../discord/cache.ts";
import { P } from "../discord/constants.ts";
import { db, TTL } from "../core/db.ts";
import { log } from "../core/log.ts";
import { o } from "../core/opts.ts";
import { embed, mention } from "../core/ui.ts";
import { asciiDigits, isDigits, purge } from "./shorts.ts";

const ON = "مفعّل";

const ACTIONS: Record<string, string> = {
  ban: "🔨 باند", kick: "👢 طرد", timeout: "⏳ تايم أوت", untimeout: "⏱️ إزالة تايم أوت", clear: "🗑️ مسح رسائل",
  warn: "⚠️ تحذير", unban: "🔓 فك باند", toggle_role: "🏷️ إعطاء/سحب رتبة", nickname: "✏️ تغيير اسم عضو",
};
const REQUIRED: Record<string, bigint> = {
  ban: P.BanMembers, kick: P.KickMembers, timeout: P.ModerateMembers, untimeout: P.ModerateMembers, clear: P.ManageMessages,
  warn: P.ModerateMembers, unban: P.BanMembers, toggle_role: P.ManageRoles, nickname: P.ManageNicknames,
};

const sql = db("shortcuts.db");
sql.exec(`
CREATE TABLE IF NOT EXISTS server_shortcuts (
    guild_id INTEGER,
    shortcut_name TEXT,
    target_command TEXT,
    status TEXT DEFAULT 'مفعّل',
    options TEXT DEFAULT '{}',
    PRIMARY KEY (guild_id, shortcut_name)
)`);
sql.addColumn("server_shortcuts", "options", "TEXT DEFAULT '{}'");
// تحويل الاختصارات القديمة الخاصة بالرتب إلى نظام التبديل الجديد.
sql.run("UPDATE server_shortcuts SET target_command='toggle_role' WHERE target_command IN ('add_role','remove_role')");
sql.exec(`CREATE TABLE IF NOT EXISTS shortcut_warns (
                guild_id INTEGER, user_id INTEGER, count INTEGER DEFAULT 0,
                PRIMARY KEY(guild_id,user_id))`);

interface Shortcut { target: string; status: string; options: string }
const cache = new TTL<Map<string, Shortcut>>(30_000, 1000);

function shortcuts(gid: string): Map<string, Shortcut> {
  let m = cache.get(gid);
  if (!m) {
    m = new Map();
    for (const r of sql.all<{ shortcut_name: string; target_command: string; status: string; options: string }>(
      "SELECT shortcut_name, target_command, status, options FROM server_shortcuts WHERE guild_id = ?", gid)) {
      m.set(String(r.shortcut_name), { target: String(r.target_command ?? ""), status: String(r.status ?? ""), options: r.options ?? "{}" });
    }
    cache.set(gid, m);
  }
  return m;
}

const clean = (s: string) => s.trim().toLowerCase().replace(/^[!/.#]+/, "");

export default function setup(bot: Bot): void {
  /** المستهدف: أول منشن، أو آيدي، وإذا ما تحدد أحد يعتبر الكاتب نفسه. */
  async function target(gid: string, author: CMember, firstMention: string | undefined, value: string): Promise<CMember | null> {
    if (firstMention) return bot.member(gid, firstMention);
    const raw = value.trim().replace(/^[<@!>]+|[<@!>]+$/g, "");
    if (raw && isDigits(raw)) {
      try {
        return await bot.member(gid, BigInt(asciiDigits(raw)).toString());
      } catch {
        return null;
      }
    }
    return author;
  }

  async function execute(d: any, author: CMember, action: string, options: Record<string, any>, args: string[]): Promise<string> {
    const gid: string = d.guild_id;
    const g = bot.guild(gid);
    const content: string = d.content ?? "";
    const mentionIds = [...content.matchAll(/<@!?(\d{15,25})>/g)].map((m) => m[1]!);
    const firstMention = mentionIds[0] ?? (d.mentions?.[0]?.id as string | undefined);
    const hasMentions = !!firstMention;

    // كل الاختصارات الإدارية تحتاج صلاحية مناسبة.
    const need = REQUIRED[action];
    if (need && (bot.basePerms(gid, author.roles, author.id) & need) !== need) return "❌ ما عندك الصلاحية المطلوبة لهذا الاختصار.";

    let reason = args.length > 1 ? args.slice(1).join(" ").trim() : "اختصار إداري";
    if (options.reason_required && args.length < 2 && !hasMentions) return "❌ لازم تحدد السبب بعد العضو.";

    if (action === "clear") {
      const raw = args.find(isDigits);
      if (!raw) return "❌ اكتب عدد الرسائل بعد الاختصار، مثال: `مسح 70`";
      const amount = Math.max(1, Math.min(Number.parseInt(asciiDigits(raw), 10), 100));
      const n = await purge(bot, d.channel_id, amount + 1, reason);
      return `🗑️ تم مسح ${Math.max(0, n - 1)} رسالة.`;
    }

    if (action === "unban") {
      const raw = args[0]?.trim() ?? "";
      if (!isDigits(raw)) return "❌ لفك الباند اكتب آيدي العضو بعد الاختصار.";
      const id = BigInt(asciiDigits(raw)).toString();
      const user = await bot.userById(id);
      if (!user) return "❌ العضو غير موجود في قائمة الباند.";
      try {
        await bot.unban(gid, id, reason);
      } catch (e) {
        if ((e as any).status === 404) return "❌ العضو غير موجود في قائمة الباند.";
        throw e;
      }
      return `🔓 تم فك الباند عن **${user.username}**.`;
    }

    // تحديد المستهدف (إذا لم يتم منشن أحد، يتم اختيار الكاتب تلقائياً)
    const targetArg = action === "timeout" ? args.find((x) => !isDigits(x)) ?? "" : args[0] ?? "";
    const t = await target(gid, author, firstMention, targetArg);
    if (!t) return "❌ لم يتم العثور على العضو.";

    // السماح بتنفيذ الإجراء على النفس (إلا للباند والطرد والتايم أوت)
    if (t.id === author.id && ["ban", "kick", "timeout"].includes(action)) return "❌ ما تقدر تطرد أو تبند أو تعطي تايم أوت لنفسك.";

    if (t.id !== author.id) {
      const authorIsOwner = g?.ownerId === author.id;
      if (!authorIsOwner && (t.id === g?.ownerId || bot.topPosition(gid, t.roles) >= bot.topPosition(gid, author.roles))) {
        return "❌ ما تقدر تنفذ هذا الإجراء على عضو رتبته مساوية أو أعلى من رتبتك.";
      }
      const me = await bot.me(gid);
      if (me && bot.topPosition(gid, t.roles) >= bot.topPosition(gid, me.roles)) return "❌ رتبة البوت أقل من رتبة العضو المستهدف.";
    }

    switch (action) {
      case "ban":
        await bot.ban(gid, t.id, reason, 0);
        return `🔨 تم تبنيد ${mention.user(t.id)}.`;
      case "kick":
        await bot.kick(gid, t.id, reason);
        return `👢 تم طرد ${mention.user(t.id)}.`;
      case "timeout": {
        const raw = args.find(isDigits) ?? "10";
        const minutes = Math.max(1, Math.min(Number.parseInt(asciiDigits(raw), 10), 40320));
        await bot.timeout(gid, t.id, minutes * 60, reason);
        return `⏳ تم إعطاء ${mention.user(t.id)} تايم أوت لمدة **${minutes} دقيقة**.`;
      }
      case "untimeout":
        await bot.timeout(gid, t.id, null, reason);
        return `⏱️ تم إزالة التايم أوت عن ${mention.user(t.id)}.`;
      case "warn": {
        const count = sql.value<number>(
          `INSERT INTO shortcut_warns(guild_id,user_id,count) VALUES(?,?,1)
           ON CONFLICT(guild_id,user_id) DO UPDATE SET count=count+1 RETURNING count`, gid, t.id) ?? 1;
        return `⚠️ تم تحذير ${mention.user(t.id)}. عدد التحذيرات: **${count}**`;
      }
      case "nickname": {
        const newName = (hasMentions ? args.slice(1) : args).join(" ").trim();
        if (!newName) return "❌ اكتب الاسم الجديد بعد الاختصار.";
        if (newName.length > 32) return "❌ اسم العضو لازم يكون 32 حرف أو أقل.";
        await bot.setNick(gid, t.id, newName, "اختصار تغيير اسم عضو");
        return `✏️ تم تغيير اسم ${mention.user(t.id)} إلى **${newName.replace(/([*_`~|\\>])/g, "\\$1")}**.`;
      }
      case "toggle_role": {
        // 1. منشن الرتبة مباشرة  2. آيدي الرتبة مكتوب بالنص
        let roleId = /<@&(\d{15,25})>/.exec(content)?.[1] ?? (d.mention_roles?.[0] as string | undefined);
        if (roleId && !bot.role(gid, roleId)) roleId = undefined;
        if (!roleId) {
          for (const a of args) {
            const c = a.trim().replace(/^[<@&]+|>+$/g, "");
            if (isDigits(c) && bot.role(gid, asciiDigits(c))) {
              roleId = asciiDigits(c);
              break;
            }
          }
        }
        if (!roleId) return "❌ اكتب منشن الرتبة أو اكتب آيدي الرتبة بشكل صحيح، مثال: `رتب @الرتبة` أو `رتب 123456789`";
        reason = "اختصار إعطاء/سحب رتبة";
        const me = await bot.me(gid);
        if (!me || bot.role(gid, roleId)!.position >= bot.topPosition(gid, me.roles)) return "❌ رتبة البوت أقل من الرتبة المحددة.";
        if (t.roles.includes(roleId)) {
          await bot.removeRole(gid, t.id, roleId, reason);
          return `🏷️ تم سحب ${mention.role(roleId)} من ${mention.user(t.id)}.`;
        }
        await bot.addRole(gid, t.id, roleId, reason);
        return `🏷️ تم إعطاء ${mention.role(roleId)} إلى ${mention.user(t.id)}.`;
      }
    }
    return "❌ نوع الاختصار غير معروف.";
  }

  bot.on("MESSAGE_CREATE", async (d) => {
    if (!d.guild_id || d.author?.bot || d.webhook_id) return;
    const words = String(d.content ?? "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return;
    const list = shortcuts(d.guild_id);
    if (!list.size) return;
    const sc = list.get(clean(words[0]!));
    if (!sc || sc.status !== ON) return;
    const author = await bot.member(d.guild_id, d.author.id);
    if (!author) return;
    let options: Record<string, any> = {};
    try {
      const v = JSON.parse(sc.options || "{}");
      if (v && typeof v === "object") options = v;
    } catch {}
    const action = sc.target.toLowerCase();
    let result: string;
    try {
      result = await execute(d, author, action, options, words.slice(1));
    } catch (e) {
      log.debug("shortcuts", `${action}: ${(e as Error).message}`);
      result = "❌ تعذر تنفيذ الاختصار، تأكد من صلاحيات البوت ورتبته.";
    }
    // رسالة "مسح" نفسها تنحذف، فالرد يروح للروم بدون ربط
    const msg = await bot.trySend(d.channel_id, {
      content: result,
      message_reference: { message_id: d.id, fail_if_not_exists: false },
    } as any);
    if (msg) setTimeout(() => void bot.deleteMessage(d.channel_id, msg.id), 8000).unref();
  });

  // ─────────── الأوامر ───────────
  bot.command({
    name: "اضافة-اختصار", description: "إضافة اختصار إداري جديد", perms: P.ManageGuild,
    options: [o.str("الاختصار", "اسم الاختصار"), o.choice("نوع_الامر", "نوع الأمر", Object.entries(ACTIONS).map(([k, v]) => [v, k] as [string, string]))],
    run: async (ctx) => {
      if (!ctx.can(P.ManageGuild)) return ctx.fail("ما عندك صلاحية إدارة السيرفر.");
      const name = clean(ctx.str("الاختصار")!);
      const tgt = ctx.str("نوع_الامر")!.trim().toLowerCase();
      if (!(tgt in ACTIONS)) return ctx.reply("❌ نوع الأمر غير مدعوم.", true);
      sql.run(`INSERT INTO server_shortcuts(guild_id,shortcut_name,target_command,status,options)
        VALUES(?,?,?,?,?) ON CONFLICT(guild_id,shortcut_name) DO UPDATE SET target_command=excluded.target_command,status=excluded.status`,
        ctx.guildId!, name, tgt, ON, "{}");
      cache.delete(ctx.guildId!);
      await ctx.reply(`✅ تم حفظ \`${name}\` → ${ACTIONS[tgt]}`, true);
    },
  });

  bot.command({
    name: "حذف-اختصار", description: "حذف اختصار موجود", perms: P.ManageGuild,
    options: [o.str("الاختصار", "اسم الاختصار المراد حذفه")],
    run: async (ctx) => {
      if (!ctx.can(P.ManageGuild)) return ctx.fail("ما عندك صلاحية إدارة السيرفر.");
      const name = clean(ctx.str("الاختصار")!);
      sql.run("DELETE FROM server_shortcuts WHERE guild_id=? AND shortcut_name=?", ctx.guildId!, name);
      cache.delete(ctx.guildId!);
      await ctx.reply(`🗑️ تم حذف \`${name}\`.`, true);
    },
  });

  bot.command({
    name: "الاختصارات", description: "عرض اختصارات السيرفر", perms: P.ManageGuild,
    run: async (ctx) => {
      if (!ctx.can(P.ManageGuild)) return ctx.fail("ما عندك صلاحية إدارة السيرفر.");
      const rows = sql.all<{ shortcut_name: string; target_command: string; status: string }>(
        "SELECT shortcut_name,target_command,status FROM server_shortcuts WHERE guild_id=? ORDER BY shortcut_name", ctx.guildId!);
      if (!rows.length) return ctx.reply("❌ لا توجد اختصارات.", true);
      const desc = rows.map((r) => `• \`${r.shortcut_name}\` → ${ACTIONS[r.target_command] ?? r.target_command} — ${r.status}`).join("\n");
      await ctx.reply({ embeds: [embed({ title: "⚡ اختصارات السيرفر", description: desc, color: 0x3498db, now: false })] }, true);
    },
  });
}
