/**
 * المجدول: يشيّك كل 30 ثانية (بتوقيت كل شخص):
 *  - السؤال اليومي (ولو البوت كان طافي وقت السؤال، يرسله أول ما يشتغل بنفس اليوم)
 *  - التذكير والتأجيل
 *  - التقرير الأسبوعي والشهري
 *  - النسخة الاحتياطية اليومية
 * الأخطاء ما توقف شي: كل مهمة لها إعادة محاولة بـ backoff.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MoodApp } from "./app.ts";
import { sendCheckin } from "./features/checkin.ts";
import { sendMonthly, sendWeekly } from "./features/reports.ts";
import { isoWeekKey, zoned } from "./time.ts";

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
      for (const uid of this.app.config.targetIds) await this.tickUser(uid);
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
    const u = app.user(uid);
    const z = app.zonedNow(u);
    const cm = app.checkinMinutes(u);
    const loggedToday = Boolean(db.getEntry(uid, z.day));

    if (!app.isPaused(u, z.day)) {
      // 1) السؤال اليومي
      if (u.last_prompt_day !== z.day && z.minutes >= cm) {
        if (loggedToday) db.updateUser(uid, { last_prompt_day: z.day });
        else await this.guarded(`checkin:${uid}`, () => sendCheckin(app, uid));
      }

      // 2) التأجيل "ذكّرني بعد ساعة"
      const snooze = db.getMeta(`snooze:${uid}`);
      if (snooze && new Date(snooze).getTime() <= app.now().getTime()) {
        db.setMeta(`snooze:${uid}`, "");
        if (!loggedToday) await this.guarded(`snooze:${uid}`, () => sendCheckin(app, uid, { reminder: true }));
      }

      // 3) التذكير التلقائي
      const rh = app.reminderHours(u);
      const fresh = app.user(uid);
      if (rh > 0 && !loggedToday && fresh.last_prompt_day === z.day && fresh.last_reminder_day !== z.day && z.minutes >= cm + rh * 60 && !snooze) {
        await this.guarded(`reminder:${uid}`, () => sendCheckin(app, uid, { reminder: true }));
      }
    }

    // 4) التقرير الأسبوعي
    if (z.weekday === config.weeklyReportDay && z.minutes >= config.weeklyReportMinutes) {
      const key = `weekly:${uid}:${isoWeekKey(z.day)}`;
      if (!db.getMeta(key) && (await this.guarded(key, () => sendWeekly(app, uid)))) db.setMeta(key, new Date().toISOString());
    }

    // 5) التقرير الشهري (أول يوم بالشهر عن الشهر اللي راح)
    if (config.monthlyReport && z.day.endsWith("-01") && z.minutes >= config.weeklyReportMinutes) {
      const key = `monthly:${uid}:${z.day.slice(0, 7)}`;
      if (!db.getMeta(key) && (await this.guarded(key, () => sendMonthly(app, uid)))) db.setMeta(key, new Date().toISOString());
    }
  }

  private async tickGlobal(): Promise<void> {
    const { app } = this;
    if (app.config.backupKeep <= 0) return;
    const z = zoned(app.now(), app.config.timezone);
    const key = `backup:${z.day}`;
    if (z.minutes >= 4 * 60 && !app.db.getMeta(key)) {
      const ok = await this.guarded(key, async () => {
        const file = app.db.backup(join(app.dataDir, "backups"), z.day, app.config.backupKeep);
        app.log.info(`backup saved: ${file}`);
      });
      if (ok) app.db.setMeta(key, new Date().toISOString());
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
