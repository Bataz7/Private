/** الرفيق الذكي: دردشة حرة في الخاص + أمر /talk. */
import type { APIInteraction, APIMessage } from "discord-api-types/v10";
import type { MoodApp } from "../app.ts";
import { isAllowed } from "../config.ts";
import { interactionUser, shouldHide } from "../discord/interaction.ts";
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
  const [name, lang, today] = await Promise.all([app.name(uid), app.lang(uid), app.today(uid)]);
  const recent = await app.db.entriesBetween(uid, addDays(today, -14), today);
  const history = await app.db.recentChat(uid, 16);
  const reply = await app.ai.chat(history, text, recent, name, lang);
  await app.db.addChat(uid, "user", text);
  await app.db.addChat(uid, "assistant", reply);
  return reply;
}

/** رسالة خاصة عادية للبوت. */
export async function onDirectMessage(app: MoodApp, msg: APIMessage): Promise<void> {
  const uid = msg.author.id;
  if (msg.author.bot || !isAllowed(app.config, uid)) return;
  const text = (msg.content ?? "").trim();
  if (!text) return;
  const t = await app.t(uid);

  if (detectRisk(text)) await sendSafety(app, uid, "chat");

  const reference = { message_id: msg.id, fail_if_not_exists: false };
  if (!app.ai.enabled || !app.config.aiChat) {
    // نرد مرة وحدة باليوم عشان ما نزعج
    if (await app.db.once(`dmhint:${uid}:${await app.today(uid)}`)) {
      await app.discord.sendMessage(msg.channel_id, { content: t.dmHint, message_reference: reference });
    }
    return;
  }
  if (!allowChat(uid)) {
    await app.discord.sendMessage(msg.channel_id, { content: t.slowDown, message_reference: reference });
    return;
  }

  await app.discord.typing(msg.channel_id);
  const typingTimer = setInterval(() => void app.discord.typing(msg.channel_id), 8000);
  try {
    const reply = await answer(app, uid, text);
    await app.discord.sendMessage(msg.channel_id, { content: clip(reply, 2000), message_reference: reference });
  } catch (e) {
    app.log.warn("chat failed:", (e as Error).message);
    await app.discord.sendMessage(msg.channel_id, { content: t.chatError, message_reference: reference });
  } finally {
    clearInterval(typingTimer);
  }
}

export async function onTalkCommand(app: MoodApp, i: APIInteraction, message?: string, reset?: boolean) {
  const uid = interactionUser(i).id;
  const t = await app.t(uid);
  if (reset) {
    await app.db.clearChat(uid);
    if (!message) return app.discord.reply(i, { content: t.chatReset }, { ephemeral: true });
  }
  if (!message) return app.discord.reply(i, { content: t.talkNeedMsg }, { ephemeral: true });
  if (!app.ai.enabled) return app.discord.reply(i, { content: t.aiOff }, { ephemeral: true });
  if (!allowChat(uid)) return app.discord.reply(i, { content: t.slowDown }, { ephemeral: true });

  // نأجل الرد أول (لازم خلال 3 ثواني) وبعدين رسالة الأمان
  await app.discord.defer(i, shouldHide(i));
  if (detectRisk(message)) await sendSafety(app, uid, "chat");
  try {
    const reply = await answer(app, uid, message);
    await app.discord.editOriginal(i, {
      embeds: [
        { color: 0x52514e, description: `> ${clip(message, 400).replace(/\n/g, "\n> ")}` },
        { color: ACCENT, description: clip(reply, 4000), footer: { text: t.talkFooter } },
      ],
    });
  } catch (e) {
    app.log.warn("talk failed:", (e as Error).message);
    await app.discord.editOriginal(i, { content: t.chatError });
  }
}
