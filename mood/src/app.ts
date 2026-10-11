/** قلب البوت: يجمع الخدمات (قاعدة البيانات، ديسكورد، AI) ودوال مشتركة. */
import { join } from "node:path";
import { achievementByCode, evaluate, type AchievementDef } from "./achievements.ts";
import type { AI } from "./ai.ts";
import { isOwner, type Config } from "./config.ts";
import type { DiscordClient, MessagePayload } from "./discord/api.ts";
import { ErrorCode } from "./discord/constants.ts";
import { DiscordAPIError, type FileUpload } from "./discord/rest.ts";
import { EmojiStore } from "./emojis.ts";
import { isLang, L, type Lang, type Messages } from "./i18n.ts";
import type { Logger } from "./log.ts";
import { mood } from "./moods.ts";
import { bestStreak, currentStreak } from "./stats.ts";
import type { Store, UserRow } from "./store/types.ts";
import { addDays, zoned, type ZonedNow } from "./time.ts";

export interface AppDeps {
  config: Config;
  db: Store;
  discord: DiscordClient;
  ai: AI;
  log: Logger;
  now?: () => Date;
  emojis?: EmojiStore;
}

export class MoodApp {
  readonly config: Config;
  readonly db: Store;
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

  // ─────────── إعدادات المستخدم ───────────

  user(uid: string): Promise<UserRow> {
    return this.db.ensureUser(uid);
  }

  langOf(u: UserRow): Lang {
    return isLang(u.lang) ? u.lang : this.config.defaultLang;
  }

  async lang(uid: string): Promise<Lang> {
    return this.langOf(await this.user(uid));
  }

  /** القاموس بلغة المستخدم */
  async t(uid: string): Promise<Messages> {
    return L(await this.lang(uid));
  }

  tzOf(u: UserRow): string {
    return u.timezone || this.config.timezone;
  }

  checkinMinutes(u: UserRow): number {
    return u.checkin_minutes ?? this.config.checkinMinutes;
  }

  reminderHours(u: UserRow): number {
    return u.reminder_hours ?? this.config.reminderHours;
  }

  zonedFor(u: UserRow): ZonedNow {
    return zoned(this.now(), this.tzOf(u));
  }

  async today(uid: string): Promise<string> {
    return this.zonedFor(await this.user(uid)).day;
  }

  isPaused(u: UserRow, day: string): boolean {
    return Boolean(u.paused_until && day <= u.paused_until);
  }

  async name(uid: string): Promise<string> {
    const n = await this.discord.displayName(uid);
    return n ?? L(await this.lang(uid)).someone;
  }

  moodEmoji(v: number): string {
    return this.emojis.t(mood(v).key);
  }

  // ─────────── السلاسل والإنجازات ───────────

  async streaks(uid: string): Promise<{ streak: number; best: number }> {
    const days = await this.db.allDays(uid);
    return { streak: currentStreak(days, await this.today(uid)), best: bestStreak(days) };
  }

  /** يفحص الإنجازات ويرجع الجديدة فقط. */
  async checkAchievements(uid: string): Promise<AchievementDef[]> {
    const { streak, best } = await this.streaks(uid);
    const all = evaluate({ entries: await this.db.allEntries(uid), streak, bestStreak: best });
    const fresh: AchievementDef[] = [];
    for (const a of all) if (await this.db.unlock(uid, a.code)) fresh.push(a);
    return fresh;
  }

  async unlocked(uid: string): Promise<string[]> {
    return (await this.db.achievements(uid)).map((a) => a.code).filter((c) => achievementByCode(c));
  }

  // ─────────── الإرسال ───────────

  /** يرسل خاص. يرجع null لو المستخدم قافل الخاص (ونعلّم عليه عشان ما نزعجه بالمحاولات). */
  async dm(uid: string, payload: MessagePayload, files?: FileUpload[]) {
    try {
      const msg = await this.discord.sendDM(uid, payload, files);
      if ((await this.user(uid)).dm_failed) await this.db.updateUser(uid, { dm_failed: 0 });
      return msg;
    } catch (e) {
      if (e instanceof DiscordAPIError && (e.code === ErrorCode.CannotSendToUser || e.status === 403)) {
        this.log.warn(`cannot DM ${uid} (DMs closed or no shared server)`);
        const first = !(await this.user(uid)).dm_failed;
        await this.db.updateUser(uid, { dm_failed: 1 });
        if (first) await this.notifyOwners((t) => ({ content: t.dmClosed(uid) }), uid);
        return null;
      }
      throw e;
    }
  }

  /** يرسل لكل الملاك (ما عدا except) — كل مالك بلغته. */
  async notifyOwners(build: MessagePayload | ((t: Messages, lang: Lang) => MessagePayload), except?: string, files?: FileUpload[]): Promise<void> {
    for (const oid of this.config.ownerIds) {
      if (oid === except) continue;
      try {
        const lang = await this.lang(oid);
        const payload = typeof build === "function" ? build(L(lang), lang) : build;
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
  async range(uid: string, days: number): Promise<{ start: string; end: string }> {
    const end = await this.today(uid);
    return { start: addDays(end, -(days - 1)), end };
  }
}
