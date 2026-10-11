/** الرفيق الذكي: دردشة حرة في الخاص + أمر /talk. */
import type { APIInteraction, APIMessage } from "discord-api-types/v10";
import type { MoodApp } from "../app.ts";
import { isAllowed } from "../config.ts";
import { interactionUser } from "../discord/interaction.ts";
import { ACCENT } from "../moods.ts";
import { detectRisk } from "../safety.ts";
import { addDays } from "../time.ts";
import { clip } from "../ui.ts";
import { sendSafety } from "./alerts.ts";

const HOURLY_LIMIT = 40;
const usage = new Map<string, number[]>();

/** حد بسيط للرسائل بالساعة عشان التكلفة ما تفلت. */
export function allowChat(uid: string, now = Date.now()): boolean {
  const recent = (usage.get(uid) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= HOURLY_LIMIT) {
    usage.set(uid, recent);
    return false;
  }
  recent.push(now);
  usage.set(uid, recent);
  return true;
}

async function answer(app: MoodApp, uid: string, text: string): Promise<string> {
  const name = await app.name(uid);
  const today = app.today(uid);
  const recent = app.db.entriesBetween(uid, addDays(today, -14), today);
  const history = app.db.recentChat(uid, 16);
  const reply = await app.ai.chat(history, text, recent, name);
  app.db.addChat(uid, "user", text);
  app.db.addChat(uid, "assistant", reply);
  return reply;
}

/** رسالة خاصة عادية للبوت. */
export async function onDirectMessage(app: MoodApp, msg: APIMessage): Promise<void> {
  const uid = msg.author.id;
  if (msg.author.bot || !isAllowed(app.config, uid)) return;
  const text = (msg.content ?? "").trim();
  if (!text) return;

  if (detectRisk(text)) await sendSafety(app, uid, "chat");

  const reference = { message_id: msg.id, fail_if_not_exists: false };
  if (!app.ai.enabled || !app.config.aiChat) {
    // نرد مرة وحدة باليوم عشان ما نزعج
    if (app.db.once(`dmhint:${uid}:${app.today(uid)}`)) {
      await app.discord.sendMessage(msg.channel_id, {
        content: "هلا 👋 أنا أسأل كل يوم عن يومك. تقدر تسجل الحين بـ `/checkin` أو تشوف تقريرك بـ `/report` 📊",
        message_reference: reference,
      });
    }
    return;
  }
  if (!allowChat(uid)) {
    await app.discord.sendMessage(msg.channel_id, { content: "خلنا ناخذ نفس 😅 كمّل معي بعد شوي.", message_reference: reference });
    return;
  }

  await app.discord.typing(msg.channel_id);
  const typingTimer = setInterval(() => void app.discord.typing(msg.channel_id), 8000);
  try {
    const reply = await answer(app, uid, text);
    await app.discord.sendMessage(msg.channel_id, { content: clip(reply, 2000), message_reference: reference });
  } catch (e) {
    app.log.warn("chat failed:", (e as Error).message);
    await app.discord.sendMessage(msg.channel_id, { content: "آسف، صار عندي لخبطة بسيطة 😵‍💫 جرّب بعد شوي.", message_reference: reference });
  } finally {
    clearInterval(typingTimer);
  }
}

export async function onTalkCommand(app: MoodApp, i: APIInteraction, message?: string, reset?: boolean) {
  const uid = interactionUser(i).id;
  const ephemeral = Boolean(i.guild_id);
  if (reset) {
    app.db.clearChat(uid);
    if (!message) return app.discord.reply(i, { content: "🧹 مسحت ذاكرة الدردشة. نبدأ من جديد!" }, { ephemeral: true });
  }
  if (!message) return app.discord.reply(i, { content: "اكتب رسالتك في `message` 💬 — أو كلمني مباشرة في الخاص." }, { ephemeral: true });
  if (!app.ai.enabled) return app.discord.reply(i, { content: "🤖 الذكاء الاصطناعي مو مفعّل (ANTHROPIC_API_KEY فاضي)." }, { ephemeral: true });
  if (!allowChat(uid)) return app.discord.reply(i, { content: "خلنا ناخذ نفس 😅 جرّب بعد شوي." }, { ephemeral: true });

  if (detectRisk(message)) await sendSafety(app, uid, "chat");
  await app.discord.defer(i, ephemeral);
  try {
    const reply = await answer(app, uid, message);
    await app.discord.editOriginal(i, {
      embeds: [
        { color: 0x52514e, description: `> ${clip(message, 400).replace(/\n/g, "\n> ")}` },
        { color: ACCENT, description: clip(reply, 4000), footer: { text: "💬 تقدر تكمل السالفة في الخاص مباشرة" } },
      ],
    });
  } catch (e) {
    app.log.warn("talk failed:", (e as Error).message);
    await app.discord.editOriginal(i, { content: "آسف، صار عندي لخبطة بسيطة 😵‍💫 جرّب بعد شوي." });
  }
}
