import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "traffic-test-"));
const { Bot } = await import("../src/discord/client.ts");
const { Ctx } = await import("../src/discord/ctx.ts");
const { db } = await import("../src/core/db.ts");
const traffic = await import("../src/features/traffic.ts");
const vehicle = await import("../src/features/vehicle.ts");
const { deductMoney } = await import("../src/features/traffic/bank.ts");
const { VIOLATIONS } = await import("../src/features/traffic/violations.ts");

const GID = "123456789012345678";
const UID = "223456789012345678";
const OFFICER = "323456789012345678";

const bank = db("bank.db");
bank.exec(`CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL, user_id INTEGER NOT NULL, account_number TEXT NOT NULL, balance INTEGER NOT NULL DEFAULT 0, is_frozen INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(guild_id, user_id));
CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL, user_id INTEGER NOT NULL, target_user_id INTEGER, transaction_type TEXT NOT NULL, amount INTEGER NOT NULL, description TEXT, created_at TEXT NOT NULL);`);

const bot = new Bot("x.y.z", 0);
traffic.default(bot);
vehicle.default(bot);
bot.appId = "1";
const calls: { path: string; body: any }[] = [];
(bot.rest as any).post = async (path: string, o: any) => { calls.push({ path, body: o?.body }); return { id: "m1", channel_id: "c1" }; };
(bot.rest as any).patch = async (path: string, o: any) => { calls.push({ path, body: o?.body }); return {}; };
(bot.rest as any).get = async () => { throw new Error("no"); };

const handler = (id: string) => (bot as any).components.find(([p]: [string]) => id === p || id.startsWith(p))[1];
const modalHandler = (id: string) => (bot as any).modals.find(([p]: [string]) => id === p || id.startsWith(p))[1];
const iact = (type: number, data: any, user = OFFICER, perms = "8") => new Ctx(bot, {
  id: "i", token: "t", type, guild_id: GID, channel_id: "c1",
  member: { user: { id: user, username: "u" }, roles: [], permissions: perms }, data, message: { id: "panel" },
});

describe("traffic", () => {
  test("violations list parity", () => {
    expect(VIOLATIONS.length).toBe(100);
    expect(VIOLATIONS[0]).toEqual(["قطع إشارة المرور الحمراء", 3000]);
  });

  test("iso format matches python", () => {
    const s = traffic._test.pyIso(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)));
    expect(s).toBe("2026-01-02T03:04:05.006000+00:00");
    expect(traffic._test.timeDiff(s)).toMatch(/^منذ \d+ يوم$/);
    expect(traffic._test.timeDiff("bad")).toBe("وقت غير معروف");
  });

  test("bank deduct", () => {
    bank.run("INSERT INTO accounts (guild_id, user_id, account_number, balance, created_at) VALUES (?, ?, '1111', 5000, 'x')", GID, UID);
    expect(deductMoney(UID, GID, 6000)).toBe(false);
    expect(deductMoney(UID, GID, 1000)).toBe(true);
    expect(bank.value("SELECT balance FROM accounts WHERE user_id = ?", UID)).toBe(4000);
    expect(bank.value("SELECT COUNT(*) FROM transactions")).toBe(1);
    expect(bank.value("SELECT user_id FROM transactions")).toBe(UID);
  });

  test("issue violation flow + pay", async () => {
    await modalHandler("traffic:car")(Object.assign(iact(5, { custom_id: "traffic:car", components: [
      { components: [{ custom_id: "car_type", value: "فورد" }] }, { components: [{ custom_id: "car_model", value: "2024" }] },
      { components: [{ custom_id: "car_color", value: "أسود" }] }, { components: [{ custom_id: "car_plate", value: "ABC-1" }] },
    ] })));
    const sel = calls.at(-1)!.body.data.components[0].components[0];
    expect(sel.custom_id).toStartWith("traffic:target:");
    const tok = sel.custom_id.split(":")[2];
    await handler(sel.custom_id)(iact(3, { custom_id: sel.custom_id, values: [UID], resolved: { members: { [UID]: { roles: [] } }, users: { [UID]: { id: UID, username: "x" } } } }));
    const upd = calls.at(-1)!.body.data;
    expect(upd.components[0].components[0].options.length).toBe(25);
    expect(upd.components[1].components[0].custom_id).toBe(`traffic:page:${tok}:${UID}:1`);
    await handler(`traffic:vio:${tok}:${UID}`)(iact(3, { custom_id: `traffic:vio:${tok}:${UID}`, values: ["1"] }));
    const row = traffic._test.sql.get<any>("SELECT * FROM traffic_violations");
    expect(row.user_id).toBe(UID);
    expect(row.reason).toBe("عكس اتجاه السير");
    expect(row.car_plate).toBe("ABC-1");
    expect(row.status).toBe("unpaid");
    // سداد
    await handler("traffic:pay")(iact(3, { custom_id: "traffic:pay", values: [String(row.id)] }, UID, "0"));
    expect(traffic._test.sql.value("SELECT status FROM traffic_violations WHERE id = ?", row.id)).toBe("paid");
    expect(bank.value("SELECT balance FROM accounts WHERE user_id = ?", UID)).toBe(1000);
  });
});

describe("vehicle", () => {
  test("plate regex", () => {
    const r = vehicle._test.PLATE_REGEX;
    expect(r.test("ABM-123")).toBe(true);
    expect(r.test("أبج-1234")).toBe(true);
    expect(r.test("ABM123")).toBe(false);
    expect(r.test("ABM-")).toBe(false);
  });
  test("utc iso like python", () => {
    const s = vehicle._test.utcIso(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)));
    expect(s).toBe("2026-01-02T03:04:05.006000");
    expect(vehicle._test.parseUtc(s)).toBe(Date.UTC(2026, 0, 2, 3, 4, 5, 6));
    expect(vehicle._test.ymd(Date.UTC(2026, 0, 2, 3, 4), true)).toBe("2026-01-02 03:04");
  });
  test("view + revoke + delete", async () => {
    vehicle._test.dataStore.save({ [UID]: [{ name: "كامري", company: "تويوتا", plate: "ABC-12", color: "أبيض", insured: true, insurance_expiry: "2099-01-01T00:00:00.000000" }] });
    await handler("vehicle:view")(iact(3, { custom_id: "vehicle:view", values: ["0"] }, UID));
    const e = calls.at(-1)!.body.data.embeds[0];
    expect(e.fields[3].value).toContain("✅ مؤمنة");
    await handler("vehicle:revoke")(iact(3, { custom_id: "vehicle:revoke", values: [`${UID}_0`] }));
    expect(vehicle._test.dataStore.get()[UID]![0]!.insured).toBe(false);
    const cmd = bot.commands.get("حذف-مركبة")!;
    await cmd.run(iact(2, { name: "حذف-مركبة", options: [{ name: "العضو", type: 6, value: UID }, { name: "اللوحة", type: 3, value: " abc-12 " }] }));
    expect(vehicle._test.dataStore.get()[UID]!.length).toBe(0);
  });
});

describe("vehicle DM flow", () => {
  test("register via DM answers", async () => {
    const dm = (content: string, attachments: any[] = []) =>
      (bot as any).emit("MESSAGE_CREATE", { id: "x", channel_id: "dm", author: { id: UID, username: "u" }, content, attachments });
    bank.run("UPDATE accounts SET balance = 5000 WHERE user_id = ?", UID);
    const f = (k: string, v: string) => ({ components: [{ custom_id: k, value: v }] });
    const p = modalHandler("vehicle:register")(iact(5, { custom_id: "vehicle:register", components: [
      f("real_name", "سعد"), f("real_age", "20"), f("id_number", "1"), f("vehicle_name", "تاهو"), f("vehicle_company", "شفروليه")] }, UID));
    const tick = () => new Promise((r) => setTimeout(r, 5));
    await tick();
    dm("bad plate"); await tick();
    dm("ABM-123"); await tick();
    dm("أسود"); await tick();
    dm("نص"); await tick();
    dm("", [{ filename: "car.PNG", url: "https://cdn/car.png" }]);
    await p;
    const v = vehicle._test.dataStore.get()[UID]!.at(-1)!;
    expect(v).toMatchObject({ plate: "ABM-123", color: "أسود", image: "https://cdn/car.png", insured: false, name: "تاهو", company: "شفروليه" });
    expect(bank.value("SELECT balance FROM accounts WHERE user_id = ?", UID)).toBe(5000 - 1600);
  });
});
