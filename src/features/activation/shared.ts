/**
 * أدوات مشتركة بين أنظمة التفعيل والهوية والتقديمات:
 * - waitForMessage: بديل bot.wait_for("message") في بايثون (ينتظر رسالة عضو في روم أو في الخاص).
 * - أسئلة الخاص: قفل بسيط عشان العضو ما يفتح أكثر من استبيان بالخاص بنفس الوقت (الإجابات تختلط).
 * - cleanEmbed: نسخة نظيفة من إيمبد رسالة (لتعديلها وإعادة إرسالها).
 */
import type { Bot } from "../../discord/client.ts";
import type { Embed, Field } from "../../core/ui.ts";

interface Waiter { resolve: (m: any | null) => void; timer: ReturnType<typeof setTimeout> }

/** المفتاح: "dm:<user>" للخاص أو "<channel>:<user>" لروم في سيرفر. يحذف نفسه عند الرد أو انتهاء المهلة. */
const waiters = new Map<string, Waiter[]>();
const hooked = new WeakSet<Bot>();

function hook(bot: Bot): void {
  if (hooked.has(bot)) return;
  hooked.add(bot);
  bot.on("MESSAGE_CREATE", (d) => {
    if (!d?.author || d.author.bot || !waiters.size) return;
    const key = d.guild_id ? `${d.channel_id}:${d.author.id}` : `dm:${d.author.id}`;
    const list = waiters.get(key);
    if (!list) return;
    waiters.delete(key);
    for (const w of list) {
      clearTimeout(w.timer);
      w.resolve(d);
    }
  });
}

/** ينتظر رسالة من العضو (في الخاص لو channelId = null). يرجع الرسالة الخام أو null لو انتهت المهلة. */
export function waitForMessage(bot: Bot, userId: string, channelId: string | null, ms: number): Promise<any | null> {
  hook(bot);
  const key = channelId ? `${channelId}:${userId}` : `dm:${userId}`;
  return new Promise((resolve) => {
    const w: Waiter = {
      resolve,
      timer: setTimeout(() => {
        const list = waiters.get(key);
        if (list) {
          const rest = list.filter((x) => x !== w);
          if (rest.length) waiters.set(key, rest);
          else waiters.delete(key);
        }
        resolve(null);
      }, ms),
    };
    w.timer.unref?.();
    const list = waiters.get(key);
    if (list) list.push(w);
    else waiters.set(key, [w]);
  });
}

/** يجب تسجيله في setup (قبل ما توصل أي رسالة). */
export function setupWaiters(bot: Bot): void {
  hook(bot);
}

// ─────────── قفل أسئلة الخاص ───────────
const dmFlows = new Set<string>();
/** يرجع false لو العضو عنده أسئلة جارية في الخاص. */
export function beginDmFlow(userId: string): boolean {
  if (dmFlows.has(userId)) return false;
  dmFlows.add(userId);
  return true;
}
export function endDmFlow(userId: string): void {
  dmFlows.delete(userId);
}

// ─────────── الإيمبد ───────────
/** ينسخ الحقول المسموح إرسالها فقط من إيمبد رسالة خام. */
export function cleanEmbed(raw: any): Embed {
  const e: Embed = {};
  if (!raw) return e;
  if (raw.title) e.title = raw.title;
  if (raw.description) e.description = raw.description;
  if (raw.url) e.url = raw.url;
  if (raw.color !== undefined && raw.color !== null) e.color = raw.color;
  if (raw.timestamp) e.timestamp = raw.timestamp;
  if (raw.author?.name) e.author = { name: raw.author.name, icon_url: raw.author.icon_url || undefined, url: raw.author.url || undefined };
  if (raw.footer?.text) e.footer = { text: raw.footer.text, icon_url: raw.footer.icon_url || undefined };
  if (raw.thumbnail?.url) e.thumbnail = { url: raw.thumbnail.url };
  if (raw.image?.url) e.image = { url: raw.image.url };
  if (Array.isArray(raw.fields) && raw.fields.length) e.fields = raw.fields.map((f: any): Field => ({ name: f.name, value: f.value, inline: !!f.inline }));
  return e;
}

/** آيدي عشوائي قصير (للحالة المؤقتة في custom_id). */
export const token = (n = 12) => crypto.randomUUID().replace(/-/g, "").slice(0, n);
