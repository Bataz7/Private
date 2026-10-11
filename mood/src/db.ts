/** قاعدة البيانات: SQLite المدمجة في Node (node:sqlite) — ملف واحد، بدون مكتبات. */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

export interface Entry {
  user_id: string;
  day: string;
  mood: number;
  energy: number | null;
  sleep: number | null;
  highlight: string;
  problems: string;
  gratitude: string;
  tags: string[];
  ai_reply: string;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  timezone: string | null;
  checkin_minutes: number | null;
  reminder_hours: number | null;
  paused_until: string | null;
  last_prompt_day: string | null;
  last_prompt_channel: string | null;
  last_prompt_message: string | null;
  last_reminder_day: string | null;
  dm_failed: number;
  created_at: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

type EntryInput = Pick<Entry, "user_id" | "day" | "mood"> &
  Partial<Pick<Entry, "energy" | "sleep" | "highlight" | "problems" | "gratitude" | "tags">>;

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    timezone TEXT,
    checkin_minutes INTEGER,
    reminder_hours REAL,
    paused_until TEXT,
    last_prompt_day TEXT,
    last_prompt_channel TEXT,
    last_prompt_message TEXT,
    last_reminder_day TEXT,
    dm_failed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE entries (
    user_id TEXT NOT NULL,
    day TEXT NOT NULL,
    mood INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 5),
    energy INTEGER CHECK (energy IS NULL OR energy BETWEEN 1 AND 10),
    sleep REAL CHECK (sleep IS NULL OR sleep BETWEEN 0 AND 24),
    highlight TEXT NOT NULL DEFAULT '',
    problems TEXT NOT NULL DEFAULT '',
    gratitude TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    ai_reply TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
  );
  CREATE TABLE chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX chat_user ON chat (user_id, id);
  CREATE TABLE achievements (
    user_id TEXT NOT NULL,
    code TEXT NOT NULL,
    unlocked_at TEXT NOT NULL,
    PRIMARY KEY (user_id, code)
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

const nowIso = () => new Date().toISOString();

export class MoodDB {
  readonly db: DatabaseSync;
  private readonly stmts = new Map<string, StatementSync>();

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    const { user_version: v } = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    for (let i = v; i < MIGRATIONS.length; i++) {
      this.tx(() => {
        this.db.exec(MIGRATIONS[i]!);
        this.db.exec(`PRAGMA user_version = ${i + 1}`);
      });
    }
  }

  private q(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  close(): void {
    this.db.close();
  }

  // ─────────── users ───────────

  ensureUser(id: string): UserRow {
    this.q("INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)").run(id, nowIso());
    return this.getUser(id)!;
  }

  getUser(id: string): UserRow | undefined {
    return this.q("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  }

  updateUser(id: string, patch: Partial<Omit<UserRow, "id" | "created_at">>): void {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    this.ensureUser(id);
    const sql = `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
    this.db.prepare(sql).run(...keys.map((k) => (patch as Record<string, string | number | null>)[k] ?? null), id);
  }

  // ─────────── entries ───────────

  private row(r: Record<string, unknown> | undefined): Entry | undefined {
    if (!r) return undefined;
    let tags: string[] = [];
    try {
      tags = JSON.parse(String(r.tags ?? "[]"));
    } catch {
      /* ignore */
    }
    return { ...(r as unknown as Entry), tags };
  }

  upsertEntry(e: EntryInput): Entry {
    const now = nowIso();
    const prev = this.getEntry(e.user_id, e.day);
    this.q(`
      INSERT INTO entries (user_id, day, mood, energy, sleep, highlight, problems, gratitude, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, day) DO UPDATE SET
        mood = excluded.mood, energy = excluded.energy, sleep = excluded.sleep,
        highlight = excluded.highlight, problems = excluded.problems, gratitude = excluded.gratitude,
        tags = excluded.tags, updated_at = excluded.updated_at
    `).run(
      e.user_id, e.day, e.mood,
      e.energy ?? null, e.sleep ?? null,
      (e.highlight ?? "").trim(), (e.problems ?? "").trim(), (e.gratitude ?? "").trim(),
      JSON.stringify(e.tags ?? prev?.tags ?? []),
      prev?.created_at ?? now, now,
    );
    return this.getEntry(e.user_id, e.day)!;
  }

  getEntry(userId: string, day: string): Entry | undefined {
    return this.row(this.q("SELECT * FROM entries WHERE user_id = ? AND day = ?").get(userId, day) as Record<string, unknown>);
  }

  setTags(userId: string, day: string, tags: string[]): void {
    this.q("UPDATE entries SET tags = ?, updated_at = ? WHERE user_id = ? AND day = ?").run(JSON.stringify(tags), nowIso(), userId, day);
  }

  setAiReply(userId: string, day: string, text: string): void {
    this.q("UPDATE entries SET ai_reply = ? WHERE user_id = ? AND day = ?").run(text, userId, day);
  }

  /** من الأقدم للأحدث */
  entriesBetween(userId: string, start: string, end: string): Entry[] {
    return (this.q("SELECT * FROM entries WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day").all(userId, start, end) as Record<string, unknown>[])
      .map((r) => this.row(r)!);
  }

  allEntries(userId: string): Entry[] {
    return (this.q("SELECT * FROM entries WHERE user_id = ? ORDER BY day").all(userId) as Record<string, unknown>[]).map((r) => this.row(r)!);
  }

  allDays(userId: string): Set<string> {
    return new Set((this.q("SELECT day FROM entries WHERE user_id = ?").all(userId) as { day: string }[]).map((r) => r.day));
  }

  countEntries(userId: string): number {
    return (this.q("SELECT COUNT(*) AS n FROM entries WHERE user_id = ?").get(userId) as { n: number }).n;
  }

  // ─────────── chat memory ───────────

  addChat(userId: string, role: ChatTurn["role"], content: string, keep = 40): void {
    this.q("INSERT INTO chat (user_id, role, content, created_at) VALUES (?, ?, ?, ?)").run(userId, role, content, nowIso());
    this.q("DELETE FROM chat WHERE user_id = ? AND id NOT IN (SELECT id FROM chat WHERE user_id = ? ORDER BY id DESC LIMIT ?)").run(userId, userId, keep);
  }

  recentChat(userId: string, n = 16): ChatTurn[] {
    return (this.q("SELECT role, content FROM (SELECT * FROM chat WHERE user_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id").all(userId, n) as unknown as ChatTurn[]);
  }

  clearChat(userId: string): void {
    this.q("DELETE FROM chat WHERE user_id = ?").run(userId);
  }

  // ─────────── achievements ───────────

  /** يرجع true لو انفتح لأول مرة. */
  unlock(userId: string, code: string): boolean {
    const r = this.q("INSERT OR IGNORE INTO achievements (user_id, code, unlocked_at) VALUES (?, ?, ?)").run(userId, code, nowIso());
    return Number(r.changes) > 0;
  }

  achievements(userId: string): { code: string; unlocked_at: string }[] {
    return this.q("SELECT code, unlocked_at FROM achievements WHERE user_id = ? ORDER BY unlocked_at").all(userId) as { code: string; unlocked_at: string }[];
  }

  // ─────────── meta ───────────

  getMeta(key: string): string | undefined {
    return (this.q("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }

  setMeta(key: string, value: string): void {
    this.q("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  /** يرجع true لو هذي أول مرة (ويسجّلها) — نستخدمها عشان ما نرسل نفس التقرير مرتين. */
  once(key: string): boolean {
    const r = this.q("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").run(key, nowIso());
    return Number(r.changes) > 0;
  }

  // ─────────── privacy & backups ───────────

  deleteUserData(userId: string): void {
    this.tx(() => {
      for (const t of ["entries", "chat", "achievements"]) this.db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
      this.db.prepare("DELETE FROM meta WHERE key LIKE ?").run(`%:${userId}:%`);
    });
  }

  /** نسخة احتياطية متسقة (VACUUM INTO) + حذف النسخ القديمة. */
  backup(dir: string, day: string, keep: number): string {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `mood-${day}.db`);
    rmSync(file, { force: true });
    this.db.prepare("VACUUM INTO ?").run(file);
    const old = readdirSync(dir).filter((f) => /^mood-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(keep);
    for (const f of old) rmSync(join(dir, f), { force: true });
    return file;
  }
}
