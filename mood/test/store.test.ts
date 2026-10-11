/**
 * نفس الاختبارات لكل أنواع قواعد البيانات.
 * SQLite يشتغل دايماً. الباقي يشتغل لو حطيت رابطه:
 *   TEST_POSTGRES_URL=postgres://…  TEST_MYSQL_URL=mysql://…  TEST_MONGO_URL=mongodb://…
 * (في GitHub Actions تشتغل كلها على سيرفرات حقيقية)
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createStore, detectKind, redact } from "../src/store/index.ts";
import type { Store } from "../src/store/types.ts";

const BACKENDS: [string, string | undefined][] = [
  ["sqlite", ":memory:"],
  ["postgres", process.env.TEST_POSTGRES_URL],
  ["mysql", process.env.TEST_MYSQL_URL],
  ["mongodb", process.env.TEST_MONGO_URL],
];

const U = `9${Date.now()}`.slice(0, 18);
const U2 = `8${Date.now()}`.slice(0, 18);

describe("store url detection", () => {
  test("detects every kind and redacts passwords", () => {
    assert.equal(detectKind(""), "sqlite");
    assert.equal(detectKind("sqlite:./x.db"), "sqlite");
    assert.equal(detectKind("postgresql://u:p@h/db"), "postgres");
    assert.equal(detectKind("mysql://u:p@h/db"), "mysql");
    assert.equal(detectKind("mariadb://u:p@h/db"), "mysql");
    assert.equal(detectKind("mongodb+srv://u:p@cluster.x/db"), "mongodb");
    assert.throws(() => detectKind("redis://x"), /DATABASE_URL/);
    assert.equal(redact("postgres://user:secret@host/db"), "postgres://user:***@host/db");
  });
});

for (const [kind, url] of BACKENDS) {
  describe(`store contract: ${kind}`, { skip: url ? false : `set TEST_${kind.toUpperCase().replace("MONGODB", "MONGO")}_URL to run` }, () => {
    let db: Store;
    const dir = mkdtempSync(join(tmpdir(), `mood-store-${kind}-`));

    before(async () => {
      db = await createStore(url, dir);
      await db.deleteUserData(U);
      await db.deleteUserData(U2);
    });
    after(async () => {
      await db.deleteUserData(U);
      await db.deleteUserData(U2);
      await db.close();
    });

    test("kind and idempotent init", async () => {
      assert.equal(db.kind, kind);
      await db.init(); // مرة ثانية ما تخرب شي
    });

    test("users: ensure, update, read", async () => {
      const u = await db.ensureUser(U);
      assert.equal(u.id, U);
      assert.equal(u.dm_failed, 0);
      await db.updateUser(U, { lang: "en", timezone: "Asia/Dubai", checkin_minutes: 600, reminder_hours: 2.5, last_prompt_at: "2026-10-09T11:30:00.000Z" });
      const v = (await db.getUser(U))!;
      assert.equal(v.lang, "en");
      assert.equal(v.timezone, "Asia/Dubai");
      assert.equal(v.checkin_minutes, 600);
      assert.equal(v.reminder_hours, 2.5);
      assert.equal(v.last_prompt_at, "2026-10-09T11:30:00.000Z");
      await db.updateUser(U, { timezone: null });
      assert.equal((await db.getUser(U))!.timezone, null);
      assert.equal((await db.ensureUser(U)).lang, "en", "ensure doesn't reset");
    });

    test("entries: upsert keeps tags/answer, Arabic & emoji round-trip", async () => {
      await db.upsertEntry({ user_id: U, day: "2026-10-01", mood: 4, sleep: 7.5, energy: 8, highlight: " طلعت مع الربع 😄 ", question: "laugh", answer: "نكتة أخوي 😂" });
      await db.setTags(U, "2026-10-01", ["sport", "friends"]);
      await db.setAiReply(U, "2026-10-01", "رد 🌟");
      const e = await db.upsertEntry({ user_id: U, day: "2026-10-01", mood: 5, highlight: "عدلت" });
      assert.equal(e.mood, 5);
      assert.deepEqual(e.tags, ["sport", "friends"]);
      assert.equal(e.question, "laugh");
      assert.equal(e.answer, "نكتة أخوي 😂");
      assert.equal(e.ai_reply, "رد 🌟");
      assert.equal(e.sleep, null, "sleep cleared when not given");
      const first = await db.upsertEntry({ user_id: U, day: "2026-09-30", mood: 2, sleep: 6.5, energy: 3, problems: "ضغط" });
      assert.equal(first.sleep, 6.5);
      assert.equal(first.energy, 3);
      assert.equal((await db.getEntry(U, "2026-10-01"))!.highlight, "عدلت");
      await db.upsertEntry({ user_id: U, day: "2026-10-03", mood: 1 });
      const range = await db.entriesBetween(U, "2026-09-30", "2026-10-02");
      assert.deepEqual(range.map((x) => x.day), ["2026-09-30", "2026-10-01"]);
      assert.equal(await db.countEntries(U), 3);
      assert.deepEqual([...(await db.allDays(U))].sort(), ["2026-09-30", "2026-10-01", "2026-10-03"]);
      assert.equal((await db.allEntries(U)).length, 3);
      assert.equal(await db.getEntry(U, "1999-01-01"), undefined);
    });

    test("users are isolated", async () => {
      await db.upsertEntry({ user_id: U2, day: "2026-10-01", mood: 3 });
      assert.equal((await db.getEntry(U2, "2026-10-01"))!.mood, 3);
      assert.equal((await db.getEntry(U, "2026-10-01"))!.mood, 5);
    });

    test("chat memory keeps the last N in order", async () => {
      for (let k = 0; k < 12; k++) await db.addChat(U, k % 2 ? "assistant" : "user", `m${k}`, 10);
      const all = await db.recentChat(U, 100);
      assert.equal(all.length, 10);
      assert.equal(all[0]!.content, "m2");
      assert.equal(all.at(-1)!.content, "m11");
      assert.deepEqual((await db.recentChat(U, 2)).map((c) => c.content), ["m10", "m11"]);
      await db.clearChat(U);
      assert.equal((await db.recentChat(U)).length, 0);
    });

    test("achievements & once() are idempotent", async () => {
      assert.equal(await db.unlock(U, "first"), true);
      assert.equal(await db.unlock(U, "first"), false);
      assert.deepEqual((await db.achievements(U)).map((a) => a.code), ["first"]);
      const k = `test:${U}:once`;
      assert.equal(await db.once(k), true);
      assert.equal(await db.once(k), false);
      await db.setMeta(`snooze:${U}`, "2026-10-01|2026-10-01T12:00:00.000Z");
      assert.equal(await db.getMeta(`snooze:${U}`), "2026-10-01|2026-10-01T12:00:00.000Z");
      await db.setMeta(`snooze:${U}`, "");
      assert.equal(await db.getMeta(`snooze:${U}`), "");
      assert.equal(await db.getMeta("nope:nothing"), undefined);
    });

    test("export → import into a fresh store round-trips", async () => {
      const dump = await db.exportAll();
      assert.equal(dump.version, 2);
      const mine = dump.entries.filter((e) => e.user_id === U);
      assert.equal(mine.length, 3);
      const copy = await createStore(":memory:", dir);
      await copy.importAll(dump);
      assert.equal(await copy.countEntries(U), 3);
      assert.deepEqual((await copy.getEntry(U, "2026-10-01"))!.tags, ["sport", "friends"]);
      assert.equal((await copy.getUser(U))!.lang, "en");
      assert.equal(await copy.unlock(U, "first"), false);
      await copy.close();
    });

    test("backup writes a file and never deletes the fresh one", async () => {
      const bdir = join(dir, "backups");
      const f1 = await db.backup(bdir, "2026-10-01", 2);
      const f2 = await db.backup(bdir, "2026-10-02", 2);
      const f3 = await db.backup(bdir, "2026-10-03", 2);
      assert.ok(existsSync(f3));
      assert.ok(existsSync(f2));
      assert.ok(!existsSync(f1), "oldest pruned");
      await db.backup(bdir, "2026-10-04", 0);
      assert.deepEqual(readdirSync(bdir).filter((x) => x.startsWith("mood-")).length, 1, "keep=0 still keeps the new backup");
    });

    test("deleteUserData removes only that user", async () => {
      await db.setMeta(`weekly:${U}:2026-W40`, "x");
      await db.deleteUserData(U);
      assert.equal(await db.countEntries(U), 0);
      assert.equal((await db.achievements(U)).length, 0);
      assert.equal(await db.getMeta(`weekly:${U}:2026-W40`), undefined);
      assert.equal(await db.countEntries(U2), 1);
    });
  });
}
