/** قلب البوت: يجمع الخدمات (قاعدة البيانات، ديسكورد، AI) ودوال مشتركة. */
import { join } from "node:path";
import { evaluate, type AchievementDef, achievementByCode } from "./achievements.ts";
import type { AI } from "./ai.ts";
import { isOwner, type Config } from "./config.ts";
import type { MoodDB, UserRow } from "./db.ts";
import type { DiscordClient, MessagePayload } from "./discord/api.ts";
import { DiscordAPIError, type FileUpload } from "./discord/rest.ts";
import { ErrorCode } from "./discord/constants.ts";
import { EmojiStore } from "./emojis.ts";
import type { Logger } from "./log.ts";
import { MOODS } from "./moods.ts";
import { bestStreak, currentStreak } from "./stats.ts";
import { addDays, zoned, type ZonedNow } from "./time.ts";

export interface AppDeps {
  config: Config;
  db: MoodDB;
  discord: DiscordClient;
  ai: AI;
  log: Logger;
  now?: () => Date;
  emojis?: EmojiStore;
}

export class MoodApp {
  readonly config: Config;
  readonly db: MoodDB;
  readonly discord: DiscordClient;
  readonly ai: AI;
  readonly log: Logger;
  readonly emojis: EmojiStore;
  readonly now: () => Date;
  readonly startedAt = Date.now();

  constructor(d: AppDeps) {
    this.config = d.config;
    this.db = d.db;
    this.discord = d.discord;
    this.ai = d.ai;
    this.log = d.log;
    this.emojis = d.emojis ?? new EmojiStore();
    this.now = d.now ?? (() => new Date());
  }

  get dataDir(): string {
    return this.config.dataDir;
  }

  get reportsDir(): string {
    return join(this.config.dataDir, "reports");
  }

  // ─────────── إعدادات المستخدم (من قاعدة البيانات أو الافتراضي) ───────────

  user(uid: string): UserRow {
    return this.db.ensureUser(uid);
  }

  tz(uid: string | UserRow): string {
    const u = typeof uid === "string" ? this.user(uid) : uid;
    return u.timezone || this.config.timezone;
  }

  checkinMinutes(u: UserRow): number {
    return u.checkin_minutes ?? this.config.checkinMinutes;
  }

  reminderHours(u: UserRow): number {
    return u.reminder_hours ?? this.config.reminderHours;
  }

  zonedNow(uid: string | UserRow): ZonedNow {
    return zoned(this.now(), this.tz(uid));
  }

  today(uid: string): string {
    return this.zonedNow(uid).day;
  }

  isPaused(u: UserRow, day: string): boolean {
    return Boolean(u.paused_until && day <= u.paused_until);
  }

  name(uid: string): Promise<string> {
    return this.discord.displayName(uid);
  }

  moodEmoji(v: number): string {
    const m = MOODS.find((x) => x.value === Math.max(1, Math.min(5, Math.round(v))))!;
    return this.emojis.t(m.key);
  }

  // ─────────── السلاسل والإنجازات ───────────

  streaks(uid: string): { streak: number; best: number } {
    const days = this.db.allDays(uid);
    return { streak: currentStreak(days, this.today(uid)), best: bestStreak(days) };
  }

  /** يفحص الإنجازات ويرجع الجديدة فقط. */
  checkAchievements(uid: string): AchievementDef[] {
    const { streak, best } = this.streaks(uid);
    const all = evaluate({ entries: this.db.allEntries(uid), streak, bestStreak: best });
    return all.filter((a) => this.db.unlock(uid, a.code));
  }

  unlocked(uid: string): string[] {
    return this.db.achievements(uid).map((a) => a.code).filter((c) => achievementByCode(c));
  }

  // ─────────── الإرسال ───────────

  /** يرسل خاص. يرجع null لو المستخدم قافل الخاص (ونعلّم عليه عشان ما نزعجه بالمحاولات). */
  async dm(uid: string, payload: MessagePayload, files?: FileUpload[]) {
    try {
      const msg = await this.discord.sendDM(uid, payload, files);
      if (this.user(uid).dm_failed) this.db.updateUser(uid, { dm_failed: 0 });
      return msg;
    } catch (e) {
      if (e instanceof DiscordAPIError && (e.code === ErrorCode.CannotSendToUser || e.status === 403)) {
        this.log.warn(`cannot DM ${uid} (DMs closed or no shared server)`);
        const first = !this.user(uid).dm_failed;
        this.db.updateUser(uid, { dm_failed: 1 });
        if (first) await this.notifyOwners({ content: `⚠️ ما قدرت أرسل رسالة خاصة لـ <@${uid}>. تأكد إنه في سيرفر مع البوت أو مثبّت البوت عنده، وإن الخاص مفتوح.` }, uid);
        return null;
      }
      throw e;
    }
  }

  /** يرسل لكل الملاك (ما عدا except). */
  async notifyOwners(payload: MessagePayload, except?: string, files?: FileUpload[]): Promise<void> {
    for (const oid of this.config.ownerIds) {
      if (oid === except) continue;
      try {
        await this.discord.sendDM(oid, payload, files);
      } catch (e) {
        this.log.warn(`could not notify owner ${oid}:`, (e as Error).message);
      }
    }
  }

  canView(viewer: string, target: string): boolean {
    return viewer === target || isOwner(this.config, viewer);
  }

  /** آخر N يوم لين اليوم. */
  range(uid: string, days: number): { start: string; end: string } {
    const end = this.today(uid);
    return { start: addDays(end, -(days - 1)), end };
  }
}
