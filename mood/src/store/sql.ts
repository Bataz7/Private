/**
 * تخزين SQL موحّد لـ SQLite و PostgreSQL و MySQL.
 * نفس الكود للكل، والفروق (العلامات ?، الـ upsert، الأنواع) في "اللهجة" (dialect).
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  emptyUser, nowIso, StoreError, USER_FIELDS,
  type Achievement, type ChatTurn, type Dump, type Entry, type EntryInput, type Store, type StoreKind, type UserPatch, type UserRow,
} from "./types.ts";

type Param = string | number | null;
type Row = Record<string, unknown>;

/** أقل شي نحتاجه من أي قاعدة SQL. */
export interface SqlExec {
  readonly dialect: Exclude<StoreKind, "mongodb">;
  all(sql: string, params?: Param[]): Promise<Row[]>;
  run(sql: string, params?: Param[]): Promise<number>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

// ─────────── المنفّذات (executors) ───────────

export async function sqliteExec(path: string): Promise<SqlExec & { raw: unknown }> {
  const { DatabaseSync } = await import("node:sqlite");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  const cache = new Map<string, ReturnType<typeof db.prepare>>();
  const prep = (sql: string) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  return {
    dialect: "sqlite",
    raw: db,
    all: async (sql, p = []) => prep(sql).all(...p) as Row[],
    run: async (sql, p = []) => Number(prep(sql).run(...p).changes),
    exec: async (sql) => { db.exec(sql); },
    close: async () => { db.close(); },
  };
}

/** يحمّل مكتبة اختيارية ويعطي رسالة واضحة لو مو مثبتة. */
async function optional<T>(name: string, label: string): Promise<T> {
  try {
    return (await import(name)) as T;
  } catch (e) {
    if ((e as { code?: string }).code === "ERR_MODULE_NOT_FOUND") {
      throw new StoreError(`قاعدة ${label} تحتاج مكتبة "${name}". شغّل:  npm install ${name}`);
    }
    throw e;
  }
}

export async function postgresExec(url: string): Promise<SqlExec> {
  const pg = await optional<typeof import("pg")>("pg", "PostgreSQL");
  const Pool = pg.Pool ?? (pg as unknown as { default: typeof import("pg") }).default.Pool;
  const ssl = /sslmode=require|[?&]ssl=true/.test(url) ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({ connectionString: url, max: 5, ssl });
  pool.on("error", () => undefined); // اتصال خامل انقطع — الـ pool يعيد الاتصال تلقائياً
  // ? → $1, $2 …
  const conv = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  return {
    dialect: "postgres",
    all: async (sql, p = []) => (await pool.query(conv(sql), p)).rows,
    run: async (sql, p = []) => (await pool.query(conv(sql), p)).rowCount ?? 0,
    exec: async (sql) => { await pool.query(sql); },
    close: async () => { await pool.end(); },
  };
}

export async function mysqlExec(url: string): Promise<SqlExec> {
  const mysql = await optional<typeof import("mysql2/promise")>("mysql2/promise", "MySQL");
  const create = mysql.createPool ?? (mysql as unknown as { default: typeof import("mysql2/promise") }).default.createPool;
  const pool = create({ uri: url, connectionLimit: 5, charset: "utf8mb4", multipleStatements: true, supportBigNumbers: true, bigNumberStrings: false });
  return {
    dialect: "mysql",
    all: async (sql, p = []) => (await pool.query(sql, p))[0] as Row[],
    run: async (sql, p = []) => Number(((await pool.query(sql, p))[0] as { affectedRows?: number }).affectedRows ?? 0),
    exec: async (sql) => { await pool.query(sql); },
    close: async () => { await pool.end(); },
  };
}

// ─────────── المخطط ───────────

function schema(d: SqlExec["dialect"]): string[] {
  const id = d === "postgres" ? "BIGSERIAL PRIMARY KEY" : d === "mysql" ? "BIGINT AUTO_INCREMENT PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const real = d === "mysql" ? "DOUBLE" : "REAL";
  const text = "TEXT";
  const tail = d === "mysql" ? " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci" : "";
  const s = (n: number) => `VARCHAR(${n})`;
  return [
    `CREATE TABLE IF NOT EXISTS mood_users (
      id ${s(32)} PRIMARY KEY, lang ${s(8)}, timezone ${s(64)}, checkin_minutes INTEGER, reminder_hours ${real},
      paused_until ${s(10)}, last_prompt_day ${s(10)}, last_prompt_at ${s(32)}, last_prompt_channel ${s(32)}, last_prompt_message ${s(32)},
      last_reminder_day ${s(10)}, dm_failed INTEGER NOT NULL DEFAULT 0, created_at ${s(32)} NOT NULL)${tail}`,
    `CREATE TABLE IF NOT EXISTS mood_entries (
      user_id ${s(32)} NOT NULL, day ${s(10)} NOT NULL,
      mood INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 5),
      energy INTEGER CHECK (energy IS NULL OR energy BETWEEN 1 AND 10),
      sleep ${real} CHECK (sleep IS NULL OR sleep BETWEEN 0 AND 24),
      highlight ${text} NOT NULL, problems ${text} NOT NULL, gratitude ${text} NOT NULL,
      tags ${text} NOT NULL, question ${s(32)} NOT NULL, answer ${text} NOT NULL, ai_reply ${text} NOT NULL,
      created_at ${s(32)} NOT NULL, updated_at ${s(32)} NOT NULL,
      PRIMARY KEY (user_id, day))${tail}`,
    `CREATE TABLE IF NOT EXISTS mood_chat (
      id ${id}, user_id ${s(32)} NOT NULL, role ${s(16)} NOT NULL, content ${text} NOT NULL, created_at ${s(32)} NOT NULL)${tail}`,
    `CREATE TABLE IF NOT EXISTS mood_achievements (
      user_id ${s(32)} NOT NULL, code ${s(32)} NOT NULL, unlocked_at ${s(32)} NOT NULL, PRIMARY KEY (user_id, code))${tail}`,
    `CREATE TABLE IF NOT EXISTS mood_meta (mkey ${s(191)} PRIMARY KEY, mval ${text} NOT NULL)${tail}`,
  ];
}

const CHAT_INDEX = "CREATE INDEX mood_chat_user ON mood_chat (user_id, id)";

// ─────────── المتجر ───────────

const ENTRY_COLS = ["user_id", "day", "mood", "energy", "sleep", "highlight", "problems", "gratitude", "tags", "question", "answer", "ai_reply", "created_at", "updated_at"] as const;

export class SqlStore implements Store {
  readonly kind: StoreKind;
  private readonly x: SqlExec;

  constructor(exec: SqlExec) {
    this.x = exec;
    this.kind = exec.dialect;
  }

  /** للاستخدام الداخلي (اختبارات/أدوات) */
  get exec(): SqlExec {
    return this.x;
  }

  async init(): Promise<void> {
    if (this.kind === "sqlite") await this.migrateLegacySqlite();
    for (const sql of schema(this.x.dialect)) await this.x.exec(sql);
    // الفهرس: "IF NOT EXISTS" مو مدعوم في كل نسخ MySQL، فنتجاهل خطأ "موجود"
    try {
      await this.x.exec(this.kind === "mysql" ? CHAT_INDEX : CHAT_INDEX.replace("INDEX", "INDEX IF NOT EXISTS"));
    } catch (e) {
      if (!/exist|Duplicate key name/i.test((e as Error).message)) throw e;
    }
  }

  /** قاعدة الإصدار الأول (جداول بدون بادئة) → ننقلها للمخطط الجديد مرة وحدة. */
  private async migrateLegacySqlite(): Promise<void> {
    const t = await this.x.all("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('entries','users','mood_entries')");
    const names = new Set(t.map((r) => r.name));
    if (!names.has("entries") || names.has("mood_entries")) return;
    for (const sql of schema("sqlite")) await this.x.exec(sql);
    await this.x.exec(`
      BEGIN;
      INSERT INTO mood_users (id, timezone, checkin_minutes, reminder_hours, paused_until, last_prompt_day, last_prompt_channel, last_prompt_message, last_reminder_day, dm_failed, created_at)
        SELECT id, timezone, checkin_minutes, reminder_hours, paused_until, last_prompt_day, last_prompt_channel, last_prompt_message, last_reminder_day, dm_failed, created_at FROM users;
      INSERT INTO mood_entries (user_id, day, mood, energy, sleep, highlight, problems, gratitude, tags, question, answer, ai_reply, created_at, updated_at)
        SELECT user_id, day, mood, energy, sleep, highlight, problems, gratitude, tags, '', '', ai_reply, created_at, updated_at FROM entries;
      INSERT INTO mood_chat (user_id, role, content, created_at) SELECT user_id, role, content, created_at FROM chat ORDER BY id;
      INSERT INTO mood_achievements SELECT user_id, code, unlocked_at FROM achievements;
      INSERT INTO mood_meta SELECT key, value FROM meta;
      DROP TABLE entries; DROP TABLE users; DROP TABLE chat; DROP TABLE achievements; DROP TABLE meta;
      COMMIT;`);
  }

  close(): Promise<void> {
    return this.x.close();
  }

  // ─────────── أدوات اللهجات ───────────

  private insertIgnore(table: string, cols: string[]): string {
    const ph = cols.map(() => "?").join(", ");
    const c = cols.join(", ");
    if (this.kind === "mysql") return `INSERT IGNORE INTO ${table} (${c}) VALUES (${ph})`;
    if (this.kind === "postgres") return `INSERT INTO ${table} (${c}) VALUES (${ph}) ON CONFLICT DO NOTHING`;
    return `INSERT OR IGNORE INTO ${table} (${c}) VALUES (${ph})`;
  }

  private upsert(table: string, cols: readonly string[], keys: string[], update: string[]): string {
    const ph = cols.map(() => "?").join(", ");
    const head = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${ph})`;
    if (this.kind === "mysql") return `${head} ON DUPLICATE KEY UPDATE ${update.map((u) => `${u} = VALUES(${u})`).join(", ")}`;
    return `${head} ON CONFLICT (${keys.join(", ")}) DO UPDATE SET ${update.map((u) => `${u} = excluded.${u}`).join(", ")}`;
  }

  private user(r: Row | undefined): UserRow | undefined {
    if (!r) return undefined;
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      ...(r as unknown as UserRow),
      id: String(r.id),
      checkin_minutes: num(r.checkin_minutes),
      reminder_hours: num(r.reminder_hours),
      dm_failed: Number(r.dm_failed ?? 0),
    };
  }

  private entry(r: Row | undefined): Entry | undefined {
    if (!r) return undefined;
    let tags: string[] = [];
    try {
      tags = JSON.parse(String(r.tags ?? "[]"));
    } catch {
      /* ignore */
    }
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      user_id: String(r.user_id), day: String(r.day), mood: Number(r.mood),
      energy: num(r.energy), sleep: num(r.sleep),
      highlight: String(r.highlight ?? ""), problems: String(r.problems ?? ""), gratitude: String(r.gratitude ?? ""),
      tags, question: String(r.question ?? ""), answer: String(r.answer ?? ""), ai_reply: String(r.ai_reply ?? ""),
      created_at: String(r.created_at), updated_at: String(r.updated_at),
    };
  }

  // ─────────── users ───────────

  async ensureUser(id: string): Promise<UserRow> {
    await this.x.run(this.insertIgnore("mood_users", ["id", "dm_failed", "created_at"]), [id, 0, nowIso()]);
    return (await this.getUser(id)) ?? emptyUser(id);
  }

  async getUser(id: string): Promise<UserRow | undefined> {
    return this.user((await this.x.all("SELECT * FROM mood_users WHERE id = ?", [id]))[0]);
  }

  async updateUser(id: string, patch: UserPatch): Promise<void> {
    const keys = Object.keys(patch).filter((k) => (USER_FIELDS as readonly string[]).includes(k));
    if (!keys.length) return;
    await this.ensureUser(id);
    await this.x.run(
      `UPDATE mood_users SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
      [...keys.map((k) => ((patch as Record<string, Param | undefined>)[k] ?? null)), id],
    );
  }

  // ─────────── entries ───────────

  async upsertEntry(e: EntryInput): Promise<Entry> {
    const now = nowIso();
    const prev = await this.getEntry(e.user_id, e.day);
    const values: Param[] = [
      e.user_id, e.day, e.mood, e.energy ?? null, e.sleep ?? null,
      (e.highlight ?? "").trim(), (e.problems ?? "").trim(), (e.gratitude ?? "").trim(),
      JSON.stringify(e.tags ?? prev?.tags ?? []),
      e.question ?? prev?.question ?? "", (e.answer ?? prev?.answer ?? "").trim(),
      prev?.ai_reply ?? "", prev?.created_at ?? now, now,
    ];
    await this.x.run(
      this.upsert("mood_entries", ENTRY_COLS, ["user_id", "day"], ["mood", "energy", "sleep", "highlight", "problems", "gratitude", "tags", "question", "answer", "updated_at"]),
      values,
    );
    return (await this.getEntry(e.user_id, e.day))!;
  }

  async getEntry(userId: string, day: string): Promise<Entry | undefined> {
    return this.entry((await this.x.all("SELECT * FROM mood_entries WHERE user_id = ? AND day = ?", [userId, day]))[0]);
  }

  async setTags(userId: string, day: string, tags: string[]): Promise<void> {
    await this.x.run("UPDATE mood_entries SET tags = ?, updated_at = ? WHERE user_id = ? AND day = ?", [JSON.stringify(tags), nowIso(), userId, day]);
  }

  async setAiReply(userId: string, day: string, text: string): Promise<void> {
    await this.x.run("UPDATE mood_entries SET ai_reply = ? WHERE user_id = ? AND day = ?", [text, userId, day]);
  }

  async entriesBetween(userId: string, start: string, end: string): Promise<Entry[]> {
    const rows = await this.x.all("SELECT * FROM mood_entries WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day", [userId, start, end]);
    return rows.map((r) => this.entry(r)!);
  }

  async allEntries(userId: string): Promise<Entry[]> {
    return (await this.x.all("SELECT * FROM mood_entries WHERE user_id = ? ORDER BY day", [userId])).map((r) => this.entry(r)!);
  }

  async allDays(userId: string): Promise<Set<string>> {
    return new Set((await this.x.all("SELECT day FROM mood_entries WHERE user_id = ?", [userId])).map((r) => String(r.day)));
  }

  async countEntries(userId: string): Promise<number> {
    return Number((await this.x.all("SELECT COUNT(*) AS n FROM mood_entries WHERE user_id = ?", [userId]))[0]?.n ?? 0);
  }

  // ─────────── chat ───────────

  async addChat(userId: string, role: ChatTurn["role"], content: string, keep = 40): Promise<void> {
    await this.x.run("INSERT INTO mood_chat (user_id, role, content, created_at) VALUES (?, ?, ?, ?)", [userId, role, content, nowIso()]);
    // نخلي آخر keep رسالة (بدون LIMIT داخل IN عشان MySQL)
    const cut = await this.x.all("SELECT id FROM mood_chat WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?", [userId, keep]);
    if (cut[0]) await this.x.run("DELETE FROM mood_chat WHERE user_id = ? AND id <= ?", [userId, Number(cut[0].id)]);
  }

  async recentChat(userId: string, n = 16): Promise<ChatTurn[]> {
    const rows = await this.x.all("SELECT role, content FROM mood_chat WHERE user_id = ? ORDER BY id DESC LIMIT ?", [userId, n]);
    return rows.reverse().map((r) => ({ role: r.role as ChatTurn["role"], content: String(r.content) }));
  }

  async clearChat(userId: string): Promise<void> {
    await this.x.run("DELETE FROM mood_chat WHERE user_id = ?", [userId]);
  }

  // ─────────── achievements ───────────

  async unlock(userId: string, code: string): Promise<boolean> {
    return (await this.x.run(this.insertIgnore("mood_achievements", ["user_id", "code", "unlocked_at"]), [userId, code, nowIso()])) > 0;
  }

  async achievements(userId: string): Promise<Achievement[]> {
    return (await this.x.all("SELECT code, unlocked_at FROM mood_achievements WHERE user_id = ? ORDER BY unlocked_at", [userId]))
      .map((r) => ({ code: String(r.code), unlocked_at: String(r.unlocked_at) }));
  }

  // ─────────── meta ───────────

  async getMeta(key: string): Promise<string | undefined> {
    const r = (await this.x.all("SELECT mval FROM mood_meta WHERE mkey = ?", [key]))[0];
    return r ? String(r.mval) : undefined;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.x.run(this.upsert("mood_meta", ["mkey", "mval"], ["mkey"], ["mval"]), [key, value]);
  }

  async once(key: string): Promise<boolean> {
    return (await this.x.run(this.insertIgnore("mood_meta", ["mkey", "mval"]), [key, nowIso()])) > 0;
  }

  // ─────────── privacy, backup, export ───────────

  async deleteUserData(userId: string): Promise<void> {
    for (const t of ["mood_entries", "mood_chat", "mood_achievements"]) await this.x.run(`DELETE FROM ${t} WHERE user_id = ?`, [userId]);
    await this.x.run("DELETE FROM mood_meta WHERE mkey LIKE ?", [`%:${userId}:%`]);
  }

  async backup(dir: string, day: string, keep: number): Promise<string> {
    mkdirSync(dir, { recursive: true });
    let file: string;
    if (this.kind === "sqlite") {
      file = join(dir, `mood-${day}.db`);
      rmSync(file, { force: true });
      await this.x.run("VACUUM INTO ?", [file]);
    } else {
      file = join(dir, `mood-${day}.json`);
      writeFileSync(file, JSON.stringify(await this.exportAll()));
    }
    pruneBackups(dir, keep);
    return file;
  }

  async exportAll(): Promise<Dump> {
    const users = (await this.x.all("SELECT * FROM mood_users ORDER BY id")).map((r) => this.user(r)!);
    const entries = (await this.x.all("SELECT * FROM mood_entries ORDER BY user_id, day")).map((r) => this.entry(r)!);
    const chat = (await this.x.all("SELECT user_id, role, content, created_at FROM mood_chat ORDER BY id"))
      .map((r) => ({ user_id: String(r.user_id), role: r.role as ChatTurn["role"], content: String(r.content), created_at: String(r.created_at) }));
    const achievements = (await this.x.all("SELECT * FROM mood_achievements"))
      .map((r) => ({ user_id: String(r.user_id), code: String(r.code), unlocked_at: String(r.unlocked_at) }));
    const meta = (await this.x.all("SELECT mkey, mval FROM mood_meta")).map((r) => ({ key: String(r.mkey), value: String(r.mval) }));
    return { version: 2, exported_at: nowIso(), users, entries, chat, achievements, meta };
  }

  async importAll(d: Dump): Promise<void> {
    for (const u of d.users) {
      await this.ensureUser(u.id);
      const patch: Record<string, unknown> = {};
      for (const k of USER_FIELDS) patch[k] = u[k];
      await this.updateUser(u.id, patch as UserPatch);
    }
    for (const e of d.entries) {
      await this.x.run(
        this.upsert("mood_entries", ENTRY_COLS, ["user_id", "day"], ENTRY_COLS.filter((c) => c !== "user_id" && c !== "day")),
        [e.user_id, e.day, e.mood, e.energy, e.sleep, e.highlight, e.problems, e.gratitude, JSON.stringify(e.tags), e.question ?? "", e.answer ?? "", e.ai_reply, e.created_at, e.updated_at],
      );
    }
    for (const c of d.chat) await this.x.run("INSERT INTO mood_chat (user_id, role, content, created_at) VALUES (?, ?, ?, ?)", [c.user_id, c.role, c.content, c.created_at]);
    for (const a of d.achievements) await this.x.run(this.insertIgnore("mood_achievements", ["user_id", "code", "unlocked_at"]), [a.user_id, a.code, a.unlocked_at]);
    for (const m of d.meta) await this.setMeta(m.key, m.value);
  }
}

export function pruneBackups(dir: string, keep: number): void {
  const old = readdirSync(dir).filter((f) => /^mood-\d{4}-\d{2}-\d{2}\.(db|json)$/.test(f)).sort().reverse().slice(Math.max(1, keep)); // ما نحذف النسخة اللي انسوت للتو أبداً
  for (const f of old) rmSync(join(dir, f), { force: true });
}
