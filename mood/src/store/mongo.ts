/** تخزين MongoDB (مثلاً MongoDB Atlas المجاني). المكتبة اختيارية: npm install mongodb */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Collection, Db, MongoClient } from "mongodb";
import { pruneBackups } from "./sql.ts";
import {
  emptyUser, nowIso, StoreError, USER_FIELDS,
  type Achievement, type ChatTurn, type Dump, type Entry, type EntryInput, type Store, type UserPatch, type UserRow,
} from "./types.ts";

interface ChatDoc { user_id: string; role: ChatTurn["role"]; content: string; created_at: string; seq: number }
interface MetaDoc { _id: string; value: string }
interface UserDoc extends Omit<UserRow, "id"> { _id: string }
interface AchDoc { user_id: string; code: string; unlocked_at: string }

const isDup = (e: unknown) => (e as { code?: number }).code === 11000;

export class MongoStore implements Store {
  readonly kind = "mongodb" as const;
  private readonly url: string;
  private client: MongoClient | null = null;
  private db!: Db;
  private seq = Date.now() * 1000;

  constructor(url: string) {
    this.url = url;
  }

  private get users(): Collection<UserDoc> { return this.db.collection<UserDoc>("mood_users"); }
  private get entries(): Collection<Entry> { return this.db.collection<Entry>("mood_entries"); }
  private get chat(): Collection<ChatDoc> { return this.db.collection<ChatDoc>("mood_chat"); }
  private get ach(): Collection<AchDoc> { return this.db.collection<AchDoc>("mood_achievements"); }
  private get meta(): Collection<MetaDoc> { return this.db.collection<MetaDoc>("mood_meta"); }

  async init(): Promise<void> {
    let mod: typeof import("mongodb") | undefined;
    try {
      mod = await import("mongodb");
    } catch (e) {
      if ((e as { code?: string }).code === "ERR_MODULE_NOT_FOUND") throw new StoreError('قاعدة MongoDB تحتاج مكتبة "mongodb". شغّل:  npm install mongodb');
      throw e;
    }
    if (!this.client) {
      // init ممكن ينادى أكثر من مرة: نفتح اتصال واحد بس
      this.client = new mod.MongoClient(this.url, { serverSelectionTimeoutMS: 15_000 });
      await this.client.connect();
      this.db = this.client.db(); // اسم القاعدة من الرابط (أو "test")
    }
    await Promise.all([
      this.entries.createIndex({ user_id: 1, day: 1 }, { unique: true }),
      this.chat.createIndex({ user_id: 1, seq: -1 }),
      this.ach.createIndex({ user_id: 1, code: 1 }, { unique: true }),
    ]);
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }

  private toUser(d: UserDoc | null): UserRow | undefined {
    if (!d) return undefined;
    const { _id, ...rest } = d;
    return { ...emptyUser(_id), ...rest, id: _id };
  }

  private toEntry(d: (Entry & { _id?: unknown }) | null): Entry | undefined {
    if (!d) return undefined;
    const { _id, ...e } = d;
    const x = e as Partial<Entry> & Entry;
    return { ...x, question: x.question ?? "", answer: x.answer ?? "", gratitude: x.gratitude ?? "", tags: x.tags ?? [] };
  }

  // ─────────── users ───────────

  async ensureUser(id: string): Promise<UserRow> {
    const { id: _ignored, ...defaults } = emptyUser(id);
    await this.users.updateOne({ _id: id }, { $setOnInsert: defaults }, { upsert: true }).catch((e) => { if (!isDup(e)) throw e; });
    return (await this.getUser(id))!;
  }

  async getUser(id: string): Promise<UserRow | undefined> {
    return this.toUser(await this.users.findOne({ _id: id }));
  }

  async updateUser(id: string, patch: UserPatch): Promise<void> {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if ((USER_FIELDS as readonly string[]).includes(k)) set[k] = v ?? null;
    if (!Object.keys(set).length) return;
    await this.ensureUser(id);
    await this.users.updateOne({ _id: id }, { $set: set });
  }

  // ─────────── entries ───────────

  async upsertEntry(e: EntryInput): Promise<Entry> {
    const now = nowIso();
    const set: Record<string, unknown> = {
      mood: e.mood, energy: e.energy ?? null, sleep: e.sleep ?? null,
      highlight: (e.highlight ?? "").trim(), problems: (e.problems ?? "").trim(), gratitude: (e.gratitude ?? "").trim(),
      updated_at: now,
    };
    const onInsert: Record<string, unknown> = { created_at: now, ai_reply: "" };
    if (e.tags) set.tags = e.tags; else onInsert.tags = [];
    if (e.question !== undefined) set.question = e.question; else onInsert.question = "";
    if (e.answer !== undefined) set.answer = e.answer.trim(); else onInsert.answer = "";
    try {
      await this.entries.updateOne({ user_id: e.user_id, day: e.day }, { $set: set, $setOnInsert: onInsert }, { upsert: true });
    } catch (err) {
      if (!isDup(err)) throw err; // سباق upsert نادر: نعيد كتحديث
      await this.entries.updateOne({ user_id: e.user_id, day: e.day }, { $set: set });
    }
    return (await this.getEntry(e.user_id, e.day))!;
  }

  async getEntry(userId: string, day: string): Promise<Entry | undefined> {
    return this.toEntry(await this.entries.findOne({ user_id: userId, day }));
  }

  async setTags(userId: string, day: string, tags: string[]): Promise<void> {
    await this.entries.updateOne({ user_id: userId, day }, { $set: { tags, updated_at: nowIso() } });
  }

  async setAiReply(userId: string, day: string, text: string): Promise<void> {
    await this.entries.updateOne({ user_id: userId, day }, { $set: { ai_reply: text } });
  }

  async entriesBetween(userId: string, start: string, end: string): Promise<Entry[]> {
    return (await this.entries.find({ user_id: userId, day: { $gte: start, $lte: end } }).sort({ day: 1 }).toArray()).map((d) => this.toEntry(d)!);
  }

  async allEntries(userId: string): Promise<Entry[]> {
    return (await this.entries.find({ user_id: userId }).sort({ day: 1 }).toArray()).map((d) => this.toEntry(d)!);
  }

  async allDays(userId: string): Promise<Set<string>> {
    return new Set((await this.entries.find({ user_id: userId }, { projection: { day: 1 } }).toArray()).map((d) => d.day));
  }

  countEntries(userId: string): Promise<number> {
    return this.entries.countDocuments({ user_id: userId });
  }

  // ─────────── chat ───────────

  async addChat(userId: string, role: ChatTurn["role"], content: string, keep = 40): Promise<void> {
    await this.chat.insertOne({ user_id: userId, role, content, created_at: nowIso(), seq: ++this.seq });
    const cut = await this.chat.find({ user_id: userId }).sort({ seq: -1 }).skip(keep).limit(1).toArray();
    if (cut[0]) await this.chat.deleteMany({ user_id: userId, seq: { $lte: cut[0].seq } });
  }

  async recentChat(userId: string, n = 16): Promise<ChatTurn[]> {
    const docs = await this.chat.find({ user_id: userId }).sort({ seq: -1 }).limit(n).toArray();
    return docs.reverse().map((d) => ({ role: d.role, content: d.content }));
  }

  async clearChat(userId: string): Promise<void> {
    await this.chat.deleteMany({ user_id: userId });
  }

  // ─────────── achievements ───────────

  async unlock(userId: string, code: string): Promise<boolean> {
    try {
      await this.ach.insertOne({ user_id: userId, code, unlocked_at: nowIso() });
      return true;
    } catch (e) {
      if (isDup(e)) return false;
      throw e;
    }
  }

  async achievements(userId: string): Promise<Achievement[]> {
    return (await this.ach.find({ user_id: userId }).sort({ unlocked_at: 1 }).toArray()).map((a) => ({ code: a.code, unlocked_at: a.unlocked_at }));
  }

  // ─────────── meta ───────────

  async getMeta(key: string): Promise<string | undefined> {
    return (await this.meta.findOne({ _id: key }))?.value;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.meta.updateOne({ _id: key }, { $set: { value } }, { upsert: true });
  }

  async once(key: string): Promise<boolean> {
    try {
      await this.meta.insertOne({ _id: key, value: nowIso() });
      return true;
    } catch (e) {
      if (isDup(e)) return false;
      throw e;
    }
  }

  // ─────────── privacy, backup, export ───────────

  async deleteUserData(userId: string): Promise<void> {
    await Promise.all([this.entries.deleteMany({ user_id: userId }), this.chat.deleteMany({ user_id: userId }), this.ach.deleteMany({ user_id: userId })]);
    const esc = userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await this.meta.deleteMany({ _id: { $regex: `:${esc}:` } });
  }

  async backup(dir: string, day: string, keep: number): Promise<string> {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `mood-${day}.json`);
    writeFileSync(file, JSON.stringify(await this.exportAll()));
    pruneBackups(dir, keep);
    return file;
  }

  async exportAll(): Promise<Dump> {
    const users = (await this.users.find().sort({ _id: 1 }).toArray()).map((u) => this.toUser(u)!);
    const entries = (await this.entries.find().sort({ user_id: 1, day: 1 }).toArray()).map((e) => this.toEntry(e)!);
    const chat = (await this.chat.find().sort({ seq: 1 }).toArray()).map(({ user_id, role, content, created_at }) => ({ user_id, role, content, created_at }));
    const achievements = (await this.ach.find().toArray()).map(({ user_id, code, unlocked_at }) => ({ user_id, code, unlocked_at }));
    const meta = (await this.meta.find().toArray()).map((m) => ({ key: m._id, value: m.value }));
    return { version: 2, exported_at: nowIso(), users, entries, chat, achievements, meta };
  }

  async importAll(d: Dump): Promise<void> {
    for (const u of d.users) {
      const { id, ...rest } = u;
      await this.users.updateOne({ _id: id }, { $set: rest }, { upsert: true });
    }
    for (const e of d.entries) await this.entries.updateOne({ user_id: e.user_id, day: e.day }, { $set: { ...e, question: e.question ?? "", answer: e.answer ?? "" } }, { upsert: true });
    for (const c of d.chat) await this.chat.insertOne({ ...c, seq: ++this.seq });
    for (const a of d.achievements) await this.unlock(a.user_id, a.code).then(async (fresh) => {
      if (fresh) await this.ach.updateOne({ user_id: a.user_id, code: a.code }, { $set: { unlocked_at: a.unlocked_at } });
    });
    for (const m of d.meta) await this.setMeta(m.key, m.value);
  }
}
