/** شبكة الأمان: رسالة دعم عند الكلام المقلق + تنبيه المالك عند تدهور المزاج. */
import type { MoodApp } from "../app.ts";
import { isOwner } from "../config.ts";
import { addDays, diffDays } from "../time.ts";

export async function sendSafety(app: MoodApp, uid: string, source: "entry" | "chat"): Promise<void> {
  await app.dm(uid, { embeds: [{ color: 0xf5b935, description: app.config.safetyMessage }] });
  if (!app.config.alerts || isOwner(app.config, uid)) return;
  // تنبيه واحد كل 6 ساعات بالكثير
  const key = `risk:${uid}:${Math.floor(app.now().getTime() / (6 * 3_600_000))}`;
  if (!app.db.once(key)) return;
  const name = await app.name(uid);
  app.log.warn(`risk phrase detected for ${uid} (${source})`);
  await app.notifyOwners({
    embeds: [{
      color: 0xd03b3b,
      title: "⚠️ تنبيه مهم",
      description: `**${name}** كتب كلام ممكن يدل إنه يمر بوقت صعب جداً.\nحاول تكلمه أو تطمّن عليه الحين 💛\n-# البوت أرسل له أرقام المساعدة. هذا تنبيه آلي وممكن يكون غلط.`,
    }],
  }, uid);
}

/** لو آخر N أيام مسجلة ورا بعض كلها سيئة (≤ 2) نرسل تنبيه للمالك مرة وحدة لكل موجة. */
export async function checkLowMood(app: MoodApp, uid: string): Promise<boolean> {
  const n = app.config.lowMoodAlertDays;
  if (!app.config.alerts || isOwner(app.config, uid)) return false;
  const today = app.today(uid);
  const recent = app.db.entriesBetween(uid, addDays(today, -(n + 1)), today).slice(-n);
  if (recent.length < n) return false;
  for (let k = 1; k < recent.length; k++) if (diffDays(recent[k]!.day, recent[k - 1]!.day) !== 1) return false;
  if (!recent.every((e) => e.mood <= 2)) return false;
  // نتأكد إن الموجة جديدة (اليوم اللي قبلها مو سيء) عشان ما نكرر التنبيه كل يوم
  const before = app.db.getEntry(uid, addDays(recent[0]!.day, -1));
  if (before && before.mood <= 2) return false;
  if (!app.db.once(`lowmood:${uid}:${recent[0]!.day}`)) return false;
  const name = await app.name(uid);
  await app.notifyOwners({
    embeds: [{
      color: 0xec835a,
      title: "💛 تنبيه مزاج",
      description: `مزاج **${name}** كان سيء ${n} أيام ورا بعض.\nيمكن يحتاج سوالف أو طلعة أو مجرد سؤال "وش فيك؟" 🫂`,
    }],
  }, uid);
  return true;
}
