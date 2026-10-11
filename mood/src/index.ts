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
import { arabicTime } from "./time.ts";

const log = createLogger();

async function main(): Promise<void> {
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
    log.info(`🗄️ قاعدة البيانات: ${detectKind(config.databaseUrl)}${config.databaseUrl ? ` (${redact(config.databaseUrl)})` : ` (${join(config.dataDir, "mood.db")})`}`);
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
      log.warn(`🌐 ما قدرت أوصل لديسكورد (${(e as Error).message}) — بحاول مرة ثانية بعد ${wait} ثانية`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }

  const ai = new AI({
    provider: config.aiProvider, apiKey: config.aiKey, model: config.aiModel, baseUrl: config.aiBaseUrl,
    appUrl: config.appUrl, appName: config.appName, logger: log.child("ai"),
  });
  const app = new MoodApp({ config, db, discord, ai, log });
  for (const uid of config.targetIds) await db.ensureUser(uid);

  await registerCommands(app).catch((e) => log.error("command registration failed:", (e as Error).message));
  await app.emojis.sync(discord, log.child("emoji"));

  const presence = {
    since: null,
    afk: false,
    status: "online",
    activities: [{ type: ActivityType.Custom, name: "Custom Status", state: config.statusText }],
  };
  const gateway = new Gateway({ token: config.token, intents: Intents.DirectMessages, presence, logger: log.child("gateway"), url: config.gatewayUrl });
  const scheduler = new Scheduler(app);

  gateway.on("READY", (d: { user: { id: string; username: string } }) => {
    discord.user = d.user as never;
    log.info(`✅ ${d.user.username} شغّال | السؤال اليومي ${arabicTime(config.checkinMinutes)} (${config.timezone}) | AI: ${ai.label} | DB: ${db.kind} | ${config.targetIds.length} شخص`);
    scheduler.start();
  });
  gateway.on("INTERACTION_CREATE", (i: APIInteraction) => void handleInteraction(app, i));
  gateway.on("MESSAGE_CREATE", (m: APIMessage & { guild_id?: string }) => {
    if (!m.guild_id) void onDirectMessage(app, m).catch((e) => log.error("DM handler failed:", e));
  });
  gateway.on("fatal", (code: number) => {
    log.error(code === 4004 ? "❌ التوكن رفضه ديسكورد (4004)" : code === 4014 ? "❌ intents غير مسموحة (4014)" : `❌ خطأ اتصال قاتل ${code}`);
    shutdown(1);
  });
  gateway.connect();

  let stopping = false;
  function shutdown(code = 0): void {
    if (stopping) return;
    stopping = true;
    log.info("🛑 إيقاف البوت…");
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
