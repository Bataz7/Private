/**
 * ريفايف — نقطة التشغيل.
 *   bun start            (التوكن وباقي الأسرار من .env — انظر .env.example)
 *   bun run build        ← ملف تشغيل واحد ./revive بدون أي مكتبات
 */
import { config, tokenProblem } from "./core/config.ts";
import { closeAll, shrinkAll } from "./core/db.ts";
import { syncEmojis } from "./core/emojis.ts";
import { startJobs } from "./core/jobs.ts";
import { startTrimming } from "./core/trim.ts";
import { log, memoryMB } from "./core/log.ts";
import { Bot } from "./discord/client.ts";
import { Intents } from "./discord/constants.ts";
import { FEATURES } from "./features/index.ts";

const VERSION = "v3.0";
log.banner(VERSION);

const bad = tokenProblem(config.TOKEN);
if (bad) {
  log.error("token", `DISCORD_TOKEN ${bad}`);
  log.info("fix", "put it in .env as  DISCORD_TOKEN=<token>  (no spaces/quotes) or in the host's Variables tab");
  process.exit(1);
}

const intents =
  Intents.Guilds | Intents.GuildMembers | Intents.GuildModeration | Intents.GuildInvites | Intents.GuildVoiceStates |
  Intents.GuildMessages | Intents.GuildMessageReactions | Intents.DirectMessages | Intents.DirectMessageReactions | Intents.MessageContent;

const bot = new Bot(config.TOKEN, intents);

let loaded = 0;
for (const [name, setup] of FEATURES) {
  try {
    setup(bot);
    loaded++;
  } catch (e) {
    log.err(name, e);
  }
}
log.ok("systems", `${loaded}/${FEATURES.length} loaded · ${bot.commands.size} slash commands`);

bot.on("ready", async () => {
  const members = [...bot.cache.guilds.values()].reduce((n, g) => n + g.memberCount, 0);
  log.panel([
    ["Bot", `${bot.user.username} (${bot.user.id})`],
    ["Servers / Members", `${bot.cache.guilds.size.toLocaleString()} / ${members.toLocaleString()}`],
    ["Slash commands", String(bot.commands.size)],
    ["Data folder", config.DATA_DIR],
    ["Memory", `${memoryMB().toFixed(1)} MB`],
    ["Runtime", Bun.version.startsWith("txiki") ? Bun.version : `Bun ${Bun.version}`],
    ["Started in", `${((Date.now() - bot.startedAt) / 1000).toFixed(1)}s`],
  ]);
  startJobs();
  if (config.AUTO_EMOJIS) syncEmojis(bot).then((s) => log.ok("emojis", s)).catch((e) => log.warn("emojis", e.message));
});

// الذاكرة: جمع القمامة دوري + إرجاع صفحات كود Bun غير المستخدمة للنظام (core/trim.ts) = تحت 20 ميقا
setInterval(() => {
  shrinkAll();
  Bun.gc(true);
  { const m = process.memoryUsage(); log.debug("memory", `rss ${memoryMB().toFixed(1)} MB · heap ${(m.heapTotal / 1048576).toFixed(1)} MB`); }
}, Number(process.env.GC_INTERVAL_MS) || 30_000).unref();
startTrimming(60_000);

function shutdown(sig: string) {
  log.info("shutdown", sig);
  bot.gateway.destroy();
  bot.shutdown();
  closeAll();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (e) => log.err("unhandled", e));

bot.start().catch((e) => {
  log.error("login", (e as Error).message);
  if (/401/.test(String((e as Error).message))) log.warn("hint", "the token is invalid — reset it in the Developer Portal");
  process.exit(1);
});
