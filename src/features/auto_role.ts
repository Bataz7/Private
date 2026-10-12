/**
 * الرتبة التلقائية — تُعطى لكل عضو جديد عند دخوله السيرفر (autorole.db).
 */
import type { Bot } from "../discord/client.ts";
import { P } from "../discord/constants.ts";
import { db } from "../core/db.ts";
import { log } from "../core/log.ts";
import { o } from "../core/opts.ts";

const sql = db("autorole.db");
sql.exec(`
CREATE TABLE IF NOT EXISTS auto_roles (
    guild_id INTEGER PRIMARY KEY,
    role_id INTEGER
)`);

export default function setup(bot: Bot): void {
  bot.on("GUILD_MEMBER_ADD", async (d) => {
    const gid: string = d.guild_id;
    const rid = sql.value<string | number>("SELECT role_id FROM auto_roles WHERE guild_id = ?", gid);
    if (!rid || !bot.role(gid, String(rid))) return;
    await bot.addRole(gid, d.user.id, String(rid), "التسجيل التلقائي للرتبة عند الانضمام")
      .catch((e) => log.debug("auto_role", `${gid}: ${(e as Error).message}`));
  });

  bot.command({
    name: "تعيين-رتبة-تلقائية", description: "تحديد الرتبة التلقائية التي تُعطى للأعضاء عند انضمامهم", perms: P.Administrator,
    options: [o.role("الرتبة", "اختر الرتبة التلقائية")],
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("هذا الأمر للأدمن فقط.");
      const gid = ctx.guildId!;
      const role = ctx.roleOpt("الرتبة");
      if (!role) return ctx.fail("الرتبة غير موجودة.");
      const me = await bot.me(gid);
      if (!me || role.position >= bot.topPosition(gid, me.roles)) {
        return ctx.reply("❌ لا يمكنني اختيار هذه الرتبة لأنها أعلى من رتبتي أو تساويها!", true);
      }
      sql.run(
        `INSERT INTO auto_roles (guild_id, role_id) VALUES (?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET role_id = excluded.role_id`, gid, role.id);
      await ctx.reply(`✅ تم تحديد رتبة التلقائية بنجاح: **${role.name}**`, true);
    },
  });

  bot.command({
    name: "ازالة-رتبة-تلقائية", description: "إيقاف وإزالة الرتبة التلقائية للانضمام", perms: P.Administrator,
    run: async (ctx) => {
      if (!ctx.isAdmin) return ctx.fail("هذا الأمر للأدمن فقط.");
      sql.run("DELETE FROM auto_roles WHERE guild_id = ?", ctx.guildId!);
      await ctx.reply("🗑️ تم تعطيل وإزالة نظام الرتبة التلقائية بنجاح.", true);
    },
  });
}
