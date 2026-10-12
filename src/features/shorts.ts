/**
 * أوامر نصية مختصرة بالبادئة "!": رتب، قفل، فتح، حذف، باند، تايم.
 * تُقرأ من MESSAGE_CREATE (نص الرسالة) — نفس الصيغ والرسائل القديمة.
 */
import type { Bot } from "../discord/client.ts";
import { toMember, type CMember, type CRole } from "../discord/cache.ts";
import { P } from "../discord/constants.ts";
import { log } from "../core/log.ts";
import { mention } from "../core/ui.ts";

const PREFIX = "!";

/** يحوّل الأرقام العربية/الفارسية لأرقام إنجليزية (Python كان يقبلها). */
export const asciiDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0));
export const isDigits = (s: string) => /^[0-9٠-٩۰-۹]+$/.test(s);

const DAY14 = 14 * 86400_000 - 60_000;
const snowflakeTime = (id: string) => Number((BigInt(id) >> 22n) + 1420070400000n);

/**
 * يحذف آخر `limit` رسالة في الروم (مثل channel.purge) صفحة صفحة بدون تخزين كل شي.
 * الرسائل الأحدث من 14 يوم تنحذف جماعياً، والأقدم وحدة وحدة. يرجع عدد المحذوف.
 */
export async function purge(bot: Bot, channelId: string, limit: number, reason?: string): Promise<number> {
  let remaining = limit;
  let before: string | undefined;
  let deleted = 0;
  while (remaining > 0) {
    const page: any[] = await bot.rest.get(`/channels/${channelId}/messages`, { query: { limit: Math.min(100, remaining), before } });
    if (!page.length) break;
    remaining -= page.length;
    before = page[page.length - 1].id;
    const cutoff = Date.now() - DAY14;
    const fresh = page.filter((m) => snowflakeTime(m.id) > cutoff).map((m) => m.id as string);
    const old = page.filter((m) => snowflakeTime(m.id) <= cutoff).map((m) => m.id as string);
    if (fresh.length >= 2) {
      await bot.rest.post(`/channels/${channelId}/messages/bulk-delete`, { body: { messages: fresh }, reason });
      deleted += fresh.length;
    } else old.unshift(...fresh);
    for (const id of old) {
      try {
        await bot.rest.delete(`/channels/${channelId}/messages/${id}`, { reason });
        deleted++;
      } catch {}
    }
    if (page.length < 100) break;
  }
  return deleted;
}

/** يقسم النص لكلمات مع دعم "علامات التنصيص" (مثل discord.py). */
function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (let m = re.exec(s); m; m = re.exec(s)) out.push(m[1] ?? m[2]!);
  return out;
}

class BadArgument extends Error {}
class MissingArgument extends Error {}

export default function setup(bot: Bot): void {
  /** MemberConverter: منشن، آيدي، أو الاسم. */
  async function memberArg(gid: string, arg: string | undefined): Promise<CMember> {
    if (arg === undefined) throw new MissingArgument();
    const id = /^<@!?(\d{15,25})>$/.exec(arg)?.[1] ?? (/^\d{15,25}$/.test(arg) ? arg : null);
    if (id) {
      const m = await bot.member(gid, id);
      if (m) return m;
      throw new BadArgument();
    }
    const name = arg.replace(/#\d{4}$/, "");
    try {
      const res: any[] = await bot.rest.get(`/guilds/${gid}/members/search`, { query: { query: name.slice(0, 100), limit: 10 } });
      const hit = res.find((m) => m.user.username === name || m.nick === name || m.user.global_name === name);
      if (hit) return bot.cache.putMember(toMember(gid, hit));
    } catch {}
    throw new BadArgument();
  }

  /** RoleConverter: منشن، آيدي، أو الاسم بالضبط. */
  function roleArg(gid: string, arg: string | undefined): CRole {
    if (arg === undefined) throw new MissingArgument();
    const id = /^<@&(\d{15,25})>$/.exec(arg)?.[1] ?? (/^\d{15,25}$/.test(arg) ? arg : null);
    const g = bot.guild(gid);
    const r = id ? g?.roles.get(id) : [...(g?.roles.values() ?? [])].find((x) => x.name === arg);
    if (!r) throw new BadArgument();
    return r;
  }

  const authorTag = (d: any) => (d.author.discriminator && d.author.discriminator !== "0" ? `${d.author.username}#${d.author.discriminator}` : d.author.username);

  bot.on("MESSAGE_CREATE", async (d) => {
    if (!d.guild_id || d.author?.bot || d.webhook_id) return;
    const content: string = d.content ?? "";
    if (!content.startsWith(PREFIX)) return;
    const body = content.slice(PREFIX.length);
    const name = /^\S+/.exec(body)?.[0];
    if (!name || !["رتب", "قفل", "فتح", "حذف", "باند", "تايم"].includes(name)) return;
    const rest = body.slice(name.length).trim();
    const args = tokenize(rest);

    const gid: string = d.guild_id;
    const ch: string = d.channel_id;
    const author = bot.cache.member(gid, d.author.id) ?? (await bot.member(gid, d.author.id));
    if (!author) return;
    const perms = bot.channelPerms(gid, ch, author.roles, author.id);
    const has = (p: bigint) => (perms & P.Administrator) === P.Administrator || (perms & p) === p;
    const say = (text: string) => bot.trySend(ch, { content: text });
    const g = bot.guild(gid);
    const isOwner = g?.ownerId === author.id;
    const myTop = async () => {
      const me = await bot.me(gid);
      return me ? bot.topPosition(gid, me.roles) : 0;
    };

    try {
      switch (name) {
        // 1. إعطاء أو إزالة رتبة (!رتب @عضو @الرتبة)
        case "رتب": {
          if (!has(P.ManageRoles)) return void (await say("❌ عذراً، أنت لا تملك صلاحية `إدارة الرتب` لاستخدام هذا الأمر!"));
          try {
            const member = await memberArg(gid, args[0]);
            const role = roleArg(gid, args[1]);
            if ((await myTop()) <= role.position) return void (await say("❌ عذراً، لا يمكنني إعطاء هذه الرتبة لأنها أعلى من رتبتي أو مساوية لها!"));
            const reason = `بواسطة الأمر من قبل ${authorTag(d)}`;
            if (member.roles.includes(role.id)) {
              await bot.removeRole(gid, member.id, role.id, reason);
              await say(`✅ تم إزالة رتبة ${mention.role(role.id)} من العضو ${mention.user(member.id)}`);
            } else {
              await bot.addRole(gid, member.id, role.id, reason);
              await say(`✅ تم إعطاء رتبة ${mention.role(role.id)} للعضو ${mention.user(member.id)}`);
            }
          } catch (e) {
            if (e instanceof BadArgument) await say("❌ الاستخدام الخاطئ للأمر! الصيغة الصحيحة: `!رتب @عضو @الرتبة`");
            else await say("❌ حدث خطأ أثناء تنفيذ الأمر. تأكد من منشن العضو والرتبة بشكل صحيح.");
          }
          return;
        }

        // 2-3. قفل وفتح الروم (يعدّل صلاحية الكتابة لـ @everyone ويحافظ على باقي الصلاحيات)
        case "قفل":
        case "فتح": {
          const lock = name === "قفل";
          if (!has(P.ManageChannels)) return void (await say(`❌ عذراً، لا تملك صلاحية \`إدارة الرومات\` ل${lock ? "قفل" : "فتح"} الروم!`));
          const ow = bot.channel(ch)?.overwrites.find((x) => x.id === gid);
          let allow = ow?.allow ?? 0n;
          let deny = ow?.deny ?? 0n;
          if (lock) {
            allow &= ~P.SendMessages;
            deny |= P.SendMessages;
          } else {
            deny &= ~P.SendMessages;
            allow |= P.SendMessages;
          }
          try {
            await bot.rest.put(`/channels/${ch}/permissions/${gid}`, { body: { type: 0, allow: String(allow), deny: String(deny) } });
          } catch (e) {
            log.debug("shorts", `lock ${ch}: ${(e as Error).message}`);
            return;
          }
          await say(lock ? "🔒 تم قفل الروم بنجاح، لا يمكن للأعضاء الكتابة الآن." : "🔓 تم فتح الروم بنجاح، يمكن للأعضاء الكتابة الآن.");
          return;
        }

        // 4. حذف الرسائل (!حذف 50)
        case "حذف": {
          if (!has(P.ManageMessages)) return void (await say("❌ عذراً، لا تملك صلاحية `إدارة الرسائل` لحذف الرسائل!"));
          if (!args[0]) return void (await say("❌ يرجى تحديد عدد الرسائل المراد حذفها! (مثال: `!حذف 50`)"));
          if (!/^[+-]?[0-9٠-٩۰-۹]+$/.test(args[0])) return; // BadArgument: نفس القديم بدون رد
          const amount = Number.parseInt(asciiDigits(args[0]), 10);
          if (amount <= 0) return void (await say("❌ يرجى تحديد عدد أكبر من الصفر للحذف!"));
          await bot.deleteMessage(ch, d.id);
          const n = await purge(bot, ch, amount, `!حذف بواسطة ${authorTag(d)}`);
          const msg = await say(`🗑️ تم حذف \`${n}\` رسالة بنجاح.`);
          if (msg) setTimeout(() => void bot.deleteMessage(ch, msg.id), 3000).unref();
          return;
        }

        // 5. تبنيد عضو (!باند @عضو السبب)
        case "باند": {
          if (!has(P.BanMembers)) return void (await say("❌ عذراً، لا تملك صلاحية `حظر الأعضاء` لتبنيد الأعضاء!"));
          if (!args[0]) return void (await say("❌ يرجى منشن العضو المراد تبنيده! (مثال: `!باند @عضو السبب`)"));
          let member: CMember;
          try {
            member = await memberArg(gid, args[0]);
          } catch {
            return;
          }
          if (bot.topPosition(gid, author.roles) <= bot.topPosition(gid, member.roles) && !isOwner) {
            return void (await say("❌ لا يمكنك تبنيد هذا العضو لأن رتبته مساوية أو أعلى من رتبتك!"));
          }
          const reason = rest.slice(rest.indexOf(args[0]) + args[0].length).trim() || "لم يُذكر سبب";
          try {
            await bot.ban(gid, member.id, `بواسطة: ${authorTag(d)} | السبب: ${reason}`.slice(0, 512), 86400);
            await say(`🔨 تم حظر العضو ${mention.user(member.id)} من السيرفر بنجاح. السبب: \`${reason}\``);
          } catch (e) {
            await say(`❌ حدث خطأ أثناء محاولة تبنيد العضو: ${(e as Error).message}`);
          }
          return;
        }

        // 6. تايم أوت (!تايم @عضو 1h أو 1d أو 1m أو 1w)
        case "تايم": {
          if (!has(P.ModerateMembers)) return void (await say("❌ عذراً، لا تملك صلاحية `تقييد الأعضاء` لإعطاء التايم أوت!"));
          if (args.length < 2) return void (await say("❌ الاستخدام الخاطئ! (مثال: `!تايم @عضو 1h`)"));
          let member: CMember;
          try {
            member = await memberArg(gid, args[0]);
          } catch {
            return;
          }
          if (bot.topPosition(gid, author.roles) <= bot.topPosition(gid, member.roles) && !isOwner) {
            return void (await say("❌ لا يمكنك إعطاء تايم أوت لهذا العضو لأن رتبته مساوية أو أعلى من رتبتك!"));
          }
          const duration = args[1]!;
          const m = /^(\d+)([smhdw])$/.exec(asciiDigits(duration.toLowerCase()));
          if (!m) return void (await say("❌ صيغة الوقت غير صحيحة! أمثلة صحيحة: `30m` (دقائق)، `2h` (ساعات)، `1d` (أيام)، `1w` (أسابيع)"));
          const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
          const seconds = Number(m[1]) * mult[m[2]!]!;
          try {
            await bot.timeout(gid, member.id, seconds, `بواسطة: ${authorTag(d)}`);
            await say(`⏳ تم اعطاء تايم أوت للعضو ${mention.user(member.id)} لمدة \`${duration}\` بنجاح.`);
          } catch (e) {
            await say(`❌ حدث خطأ أثناء إعطاء التايم أوت: ${(e as Error).message}`);
          }
          return;
        }
      }
    } catch (e) {
      log.err("shorts", e);
    }
  });
}
