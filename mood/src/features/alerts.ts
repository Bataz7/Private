/** شبكة الأمان: رسالة دعم عند الكلام المقلق + تنبيه المالك عند تدهور المزاج. */
import type { MoodApp } from "../app.ts";
import { isOwner } from "../config.ts";
import { addDays, diffDays } from "../time.ts";

export async function sendSafety(app: MoodApp, uid: string, source: "entry" | "chat"): Promise<void> {
  const t = await app.t(uid);
  await app.dm(uid, { embeds: [{ color: 0xf5b935, description: app.config.safetyMessage || t.safety }] });
  if (!app.config.alerts || isOwner(app.config, uid)) return;
  // تنبيه واحد كل 6 ساعات بالكثير
  const key = `risk:${uid}:${Math.floor(app.now().getTime() / (6 * 3_600_000))}`;
  if (!(await app.db.once(key))) return;
  const name = await app.name(uid);
  app.log.warn(`risk phrase detected for ${uid} (${source})`);
  await app.notifyOwners((tt) => ({ embeds: [{ color: 0xd03b3b, title: tt.riskTitle, description: tt.riskBody(name) }] }), uid);
}

/** لو آخر N أيام مسجلة ورا بعض كلها سيئة (≤ 2) نرسل تنبيه للمالك مرة وحدة لكل موجة. */
export async function checkLowMood(app: MoodApp, uid: string): Promise<boolean> {
  const n = app.config.lowMoodAlertDays;
  if (!app.config.alerts || isOwner(app.config, uid)) return false;
  const today = await app.today(uid);
  const recent = (await app.db.entriesBetween(uid, addDays(today, -(n + 1)), today)).slice(-n);
  if (recent.length < n) return false;
  for (let k = 1; k < recent.length; k++) if (diffDays(recent[k]!.day, recent[k - 1]!.day) !== 1) return false;
  if (!recent.every((e) => e.mood <= 2)) return false;
  // نتأكد إن الموجة جديدة (اليوم اللي قبلها مو سيء) عشان ما نكرر التنبيه كل يوم
  const before = await app.db.getEntry(uid, addDays(recent[0]!.day, -1));
  if (before && before.mood <= 2) return false;
  if (!(await app.db.once(`lowmood:${uid}:${recent[0]!.day}`))) return false;
  const name = await app.name(uid);
  await app.notifyOwners((tt) => ({ embeds: [{ color: 0xec835a, title: tt.lowTitle, description: tt.lowBody(name, n) }] }), uid);
  return true;
}
