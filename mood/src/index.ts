/**
 * Mood Bot 🌈 — نقطة التشغيل.
 *   npm start
 */
import { join } from "node:path";
import type { APIInteraction, APIMessage } from "discord-api-types/v10";
import { AI } from "./ai.ts";
import { MoodApp } from "./app.ts";
import { registerCommands } from "./commands.ts";
import { ConfigError, loadConfig, loadEnvFile } from "./config.ts";
import { DiscordClient } from "./discord/api.ts";
import { ActivityType, Intents } from "./discord/constants.ts";
import { Gateway } from "./discord/gateway.ts";
import { DiscordAPIError, REST } from "./discord/rest.ts";
import { onDirectMessage } from "./features/companion.ts";
import { createLogger, setLogLevel } from "./log.ts";
import { handleInteraction } from "./router.ts";
import { Scheduler } from "./scheduler.ts";
import { createStore, detectKind, redact, StoreError, type Store } from "./store/index.ts";
import { box, logo, memory, memoryBar, memoryLine, mb, STATUSES, uptime } from "./system.ts";
import { formatMinutes, localTime } from "./time.ts";
import { color } from "./log.ts";

const log = createLogger();

async function main(): Promise<void> {
  console.log(`\n${logo()}\n${color.gray("  How was your day? · daily mood check-ins for Discord")}\n`);
  loadEnvFile();
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      log.error(`❌ ${e.message}\n   انسخ .env.example إلى .env وعبّي القيم (التفاصيل في README.md)`);
      process.exit(1);
    }
    throw e;
  }
  setLogLevel(config.logLevel);

  let db: Store;
  try {
    db = await createStore(config.databaseUrl, config.dataDir);
    log.info(`${color.green("✓")} database  ${color.bold(detectKind(config.databaseUrl))} ${color.gray(config.databaseUrl ? redact(config.databaseUrl) : join(config.dataDir, "mood.db"))}`);
  } catch (e) {
    log.error(e instanceof StoreError ? `❌ ${e.message}` : `❌ ما قدرت أتصل بقاعدة البيانات: ${(e as Error).message}`);
    process.exit(1);
  }
  const rest = new REST(config.token, { logger: log.child("rest"), baseUrl: config.apiUrl });
  const discord = new DiscordClient(rest);
  // نحاول نوصل لديسكورد — لو النت فاصل نعيد المحاولة بدل ما نطفي
  for (let attempt = 1; ; attempt++) {
    try {
      await discord.init();
      break;
    } catch (e) {
      if (e instanceof DiscordAPIError && e.status === 401) {
        log.error("❌ توكن البوت غلط (401). انسخ التوكن من جديد من Discord Developer Portal ← Bot ← Reset Token");
        process.exit(1);
      }
      const wait = Math.min(5 * attempt, 60);
      log.warn(`can't reach Discord (${(e as Error).message}) — retrying in ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }

  const ai = new AI({
    provider: config.aiProvider, apiKey: config.aiKey, model: config.aiModel, baseUrl: config.aiBaseUrl,
    appUrl: config.appUrl, appName: config.appName, logger: log.child("ai"),
  });
  const app = new MoodApp({ config, db, discord, ai, log });
  for (const uid of config.targetIds) await db.ensureUser(uid);

  log.info(`${color.green("✓")} discord   ${color.gray(`application ${discord.applicationId}`)}`);
  await registerCommands(app).catch((e) => log.error("command registration failed:", (e as Error).message));
  await app.emojis.sync(discord, log.child("emoji"));

  // الحالة: ثابتة لو STATUS_TEXT موجود، وإلا تتبدل بين حالات إنجليزية
  let statusIndex = 0;
  const statusNow = () => config.statusText || STATUSES[statusIndex % STATUSES.length]!;
  const presenceFor = (state: string) => ({
    since: null,
    afk: false,
    status: "online",
    activities: [{ type: ActivityType.Custom, name: "Custom Status", state }],
  });
  const presence = presenceFor(statusNow());
  const gateway = new Gateway({ token: config.token, intents: Intents.DirectMessages, presence, logger: log.child("gateway"), url: config.gatewayUrl });
  const scheduler = new Scheduler(app);

  let readyOnce = false;
  gateway.on("READY", (d: { user: { id: string; username: string } }) => {
    discord.user = d.user as never;
    scheduler.start();
    if (readyOnce) return log.info(`${color.green("✓")} reconnected as ${d.user.username}`);
    readyOnce = true;
    const m = memory();
    const reminder = config.reminderHours > 0 ? `after ${config.reminderHours}h` : "off";
    console.log("\n" + box(`${color.bold(color.pink("Mood Bot"))} ${color.gray("v3")}  ${color.green("● online")}`, [
      ["Bot", `${color.bold(d.user.username)} ${color.gray(`(${d.user.id})`)}`],
      ["Tracking", `${config.targetIds.length} ${config.targetIds.length === 1 ? "person" : "people"}  ${color.gray(`owners: ${config.ownerIds.length || "auto"}`)}`],
      ["Check-in", `${formatMinutes(config.checkinMinutes)} ${color.gray(`(${localTime(config.checkinMinutes, "en")}, ${config.timezone})`)}`],
      ["Reminder", reminder],
      ["Reports", `weekly ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][config.weeklyReportDay]} ${formatMinutes(config.weeklyReportMinutes)}${config.monthlyReport ? " + monthly" : ""}`],
      ["Language", config.defaultLang === "ar" ? "Arabic (default) + English" : "English (default) + Arabic"],
      ["AI", ai.enabled ? color.green(ai.label) : color.yellow("off (local replies)")],
      ["Database", `${db.kind}`],
      ["Emojis", `${app.emojis.count} custom`],
      ["Status", config.statusText ? `"${config.statusText}"` : `rotating ${STATUSES.length} statuses every ${config.statusRotateMinutes}m`],
      ["Memory", `${memoryBar(m.rss)} ${mb(m.rss)} ${color.gray(`heap ${mb(m.heapUsed)}`)}`],
      ["Runtime", `Node ${process.versions.node} ${color.gray(`· pid ${process.pid}`)}`],
    ], color.gray("Ctrl+C to stop")) + "\n");
  });
  gateway.on("INTERACTION_CREATE", (i: APIInteraction) => void handleInteraction(app, i));
  gateway.on("MESSAGE_CREATE", (m: APIMessage & { guild_id?: string }) => {
    if (!m.guild_id) void onDirectMessage(app, m).catch((e) => log.error("DM handler failed:", e));
  });
  gateway.on("fatal", (code: number) => {
    log.error(code === 4004 ? "Discord rejected the token (4004) — reset it in the Developer Portal" : code === 4014 ? "disallowed intents (4014)" : `fatal gateway error ${code}`);
    shutdown(1);
  });
  gateway.connect();

  // تبديل الحالة كل كم دقيقة
  const statusTimer = config.statusText ? null : setInterval(() => {
    statusIndex++;
    gateway.updatePresence(presenceFor(statusNow()));
  }, config.statusRotateMinutes * 60_000);
  statusTimer?.unref();

  // ملخص دوري في الترمنال: وقت التشغيل + الرام + البنق
  const statsTimer = config.statsMinutes > 0 ? setInterval(() => {
    log.info(`${color.pink("♥")} up ${uptime(Date.now() - app.startedAt)} · ${memoryLine()} · ping ${gateway.ping >= 0 ? `${gateway.ping}ms` : "—"}`);
  }, config.statsMinutes * 60_000) : null;
  statsTimer?.unref();

  let stopping = false;
  function shutdown(code = 0): void {
    if (stopping) return;
    stopping = true;
    log.info(`stopping… ${color.gray(`(up ${uptime(Date.now() - app.startedAt)}, ${mb(memory().rss)} RAM)`)}`);
    scheduler.stop();
    gateway.destroy();
    void db.close().catch(() => undefined).finally(() => setTimeout(() => process.exit(code), 200).unref());
  }
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  process.on("unhandledRejection", (r) => log.error("unhandled rejection:", r));
  process.on("uncaughtException", (e) => {
    log.error("uncaught exception:", e);
    shutdown(1);
  });
}

main().catch((e) => {
  log.error("startup failed:", e);
  process.exit(1);
});
