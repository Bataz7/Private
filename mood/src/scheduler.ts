/**
 * المجدول: يشيّك كل 30 ثانية (بتوقيت كل شخص):
 *  - السؤال اليومي (ولو البوت كان طافي وقت السؤال، يرسله أول ما يشتغل بنفس اليوم)
 *  - التأجيل "ذكّرني بعد ساعة" والتذكير التلقائي — لنفس يوم السؤال حتى لو عدّى منتصف الليل
 *  - التقرير الأسبوعي والشهري
 *  - النسخة الاحتياطية اليومية
 * الأخطاء ما توقف شي: كل مهمة لها إعادة محاولة بـ backoff.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MoodApp } from "./app.ts";
import { parseSnooze, sendCheckin } from "./features/checkin.ts";
import { sendMonthly, sendWeekly } from "./features/reports.ts";
import { diffDays, isoWeekKey, zoned } from "./time.ts";

const MIN = 60_000;

export class Scheduler {
  private readonly app: MoodApp;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** مفتاح المهمة ← وقت المحاولة الجاية بعد فشل */
  private readonly backoff = new Map<string, { next: number; fails: number }>();
  lastTick = 0;

  constructor(app: MoodApp, intervalMs = 30_000) {
    this.app = app;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** يشغّل المهمة لو مو في فترة انتظار بعد فشل. يرجع true لو نجحت. */
  private async guarded(key: string, fn: () => Promise<unknown>): Promise<boolean> {
    const now = this.app.now().getTime();
    const b = this.backoff.get(key);
    if (b && b.next > now) return false;
    try {
      await fn();
      this.backoff.delete(key);
      return true;
    } catch (e) {
      const fails = (b?.fails ?? 0) + 1;
      const wait = Math.min(5 * MIN * 2 ** (fails - 1), 60 * MIN);
      this.backoff.set(key, { next: now + wait, fails });
      this.app.log.error(`task ${key} failed (#${fails}), retry in ${wait / MIN}m:`, (e as Error).message);
      return false;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const uid of this.app.config.targetIds) {
        try {
          await this.tickUser(uid);
        } catch (e) {
          this.app.log.error(`scheduler failed for ${uid}:`, (e as Error).message);
        }
      }
      await this.tickGlobal();
      this.lastTick = Date.now();
      this.heartbeat();
    } catch (e) {
      this.app.log.error("scheduler tick crashed:", e);
    } finally {
      this.running = false;
    }
  }

  private async tickUser(uid: string): Promise<void> {
    const { app } = this;
    const { db, config } = app;
    const now = app.now().getTime();
    const u = await app.user(uid);
    const z = app.zonedFor(u);
    const cm = app.checkinMinutes(u);

    if (!app.isPaused(u, z.day)) {
      // 1) السؤال اليومي
      if (u.last_prompt_day !== z.day && z.minutes >= cm) {
        if (await db.getEntry(uid, z.day)) await db.updateUser(uid, { last_prompt_day: z.day, last_prompt_at: new Date(now).toISOString() });
        else await this.guarded(`checkin:${uid}`, () => sendCheckin(app, uid, { day: z.day }));
      }

      // 2) "ذكّرني بعد ساعة" — لنفس اليوم المحفوظ، ونمسحه بس بعد ما ينجح الإرسال
      const snooze = parseSnooze(await db.getMeta(`snooze:${uid}`));
      if (snooze && snooze.at <= now) {
        const stillOpen = !(await db.getEntry(uid, snooze.day)) && diffDays(z.day, snooze.day) <= 1;
        if (!stillOpen) await db.setMeta(`snooze:${uid}`, "");
        else if (await this.guarded(`snooze:${uid}`, () => sendCheckin(app, uid, { day: snooze.day, reminder: true }))) await db.setMeta(`snooze:${uid}`, "");
      }

      // 3) التذكير التلقائي: بعد N ساعة من وقت إرسال السؤال (يشتغل حتى لو عدّى منتصف الليل)
      const fresh = await app.user(uid);
      const rh = app.reminderHours(fresh);
      const day = fresh.last_prompt_day;
      const promptedAt = fresh.last_prompt_at ? Date.parse(fresh.last_prompt_at) : NaN;
      if (rh > 0 && day && !snooze && fresh.last_reminder_day !== day && Number.isFinite(promptedAt) &&
          now - promptedAt >= rh * 3_600_000 && diffDays(z.day, day) <= 1 && !(await db.getEntry(uid, day))) {
        await this.guarded(`reminder:${uid}`, () => sendCheckin(app, uid, { day, reminder: true }));
      }
    }

    // 4) التقرير الأسبوعي
    if (z.weekday === config.weeklyReportDay && z.minutes >= config.weeklyReportMinutes) {
      const key = `weekly:${uid}:${isoWeekKey(z.day)}`;
      if (!(await db.getMeta(key)) && (await this.guarded(key, () => sendWeekly(app, uid)))) await db.setMeta(key, new Date().toISOString());
    }

    // 5) التقرير الشهري (أول يوم بالشهر عن الشهر اللي راح)
    if (config.monthlyReport && z.day.endsWith("-01") && z.minutes >= config.weeklyReportMinutes) {
      const key = `monthly:${uid}:${z.day.slice(0, 7)}`;
      if (!(await db.getMeta(key)) && (await this.guarded(key, () => sendMonthly(app, uid)))) await db.setMeta(key, new Date().toISOString());
    }
  }

  private async tickGlobal(): Promise<void> {
    const { app } = this;
    if (app.config.backupKeep <= 0) return;
    const z = zoned(app.now(), app.config.timezone);
    const key = `backup:${z.day}`;
    if (z.minutes >= 4 * 60 && !(await app.db.getMeta(key))) {
      const ok = await this.guarded(key, async () => {
        const file = await app.db.backup(join(app.dataDir, "backups"), z.day, app.config.backupKeep);
        app.log.info(`backup saved: ${file}`);
      });
      if (ok) await app.db.setMeta(key, new Date().toISOString());
    }
  }

  /** ملف نبض لفحص الصحة (Docker HEALTHCHECK). */
  private heartbeat(): void {
    try {
      writeFileSync(join(this.app.dataDir, ".heartbeat"), String(Date.now()));
    } catch {
      /* ignore */
    }
  }
}
