/**
 * اختبار نظام العقارات بدون ديسكورد: REST وهمي يسجّل الطلبات، وتفاعلات مصطنعة.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, test } from "bun:test";

process.env.DATA_DIR ||= mkdtempSync(join(tmpdir(), "re-"));

const { Bot } = await import("../src/discord/client.ts");
const { db } = await import("../src/core/db.ts");
const setup = (await import("../src/features/real_estate.ts")).default;

const G = "100000000000000001";
const ADMIN = "200000000000000002";
const BUYER = "300000000000000003";
const SELLER = "400000000000000004";
const REQ = "500000000000000005";
const MARKET = "500000000000000006";
const LOGS = "500000000000000007";

const bot = new Bot("x.y.z", 0);
const calls: { method: string; path: string; body: any }[] = [];
let msgId = 900;
for (const method of ["get", "post", "patch", "put", "delete"] as const) {
  (bot.rest as any)[method] = async (path: string, opts: any = {}) => {
    calls.push({ method, path, body: opts.body });
    if (path === "/users/@me/channels") return { id: "dm1" };
    return { id: String(++msgId) };
  };
}
setup(bot);
bot.cache.guilds.set(G, {
  id: G, name: "g", icon: null, ownerId: ADMIN, memberCount: 3, afkChannelId: null, roles: new Map(),
  channels: new Map(), voice: new Map(), voiceFlags: new Map(),
});
for (const ch of [REQ, MARKET, LOGS]) (bot as any).channelGuild.set(ch, G);

const user = (id: string) => ({ id, username: `u${id.slice(0, 2)}`, global_name: null, avatar: null });
let iid = 0;
async function interact(type: number, uid: string, data: any, message?: any) {
  const before = calls.length;
  await (bot as any).onInteraction({
    id: String(++iid), token: "t", type, guild_id: G, channel_id: "c", member: { user: user(uid), roles: [], permissions: uid === ADMIN ? "8" : "0" },
    data, message, app_permissions: "0",
  });
  return calls.slice(before);
}
const responses = (cs: typeof calls) => cs.filter((c) => c.path.includes("/callback") || c.path.startsWith("/webhooks")).map((c) => c.body);
const text = (cs: typeof calls) => JSON.stringify(responses(cs));
const fields = (cs: Record<string, string>) => ({ components: Object.entries(cs).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })) });
const re = db("real_estate.db");
const bank = db("bank.db");

beforeAll(() => {
  bank.exec(`CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    account_number TEXT NOT NULL, balance INTEGER NOT NULL DEFAULT 0, is_frozen INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(guild_id, user_id));
  CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL, user_id INTEGER NOT NULL, target_user_id INTEGER,
    transaction_type TEXT NOT NULL, amount INTEGER NOT NULL, description TEXT, created_at TEXT NOT NULL);`);
  for (const [u, b] of [[ADMIN, 0], [BUYER, 1_000_000], [SELLER, 0]] as const)
    bank.run("INSERT INTO accounts (guild_id, user_id, account_number, balance, created_at) VALUES (?, ?, ?, ?, 'x')", G, u, `A${u.slice(0, 3)}`, b);
  re.run("INSERT OR REPLACE INTO settings (key, channel_id) VALUES ('requests_channel', ?), ('market_channel', ?), ('logs_channel', ?)", REQ, MARKET, LOGS);
});
const balance = (u: string) => bank.value<number>("SELECT balance FROM accounts WHERE guild_id = ? AND user_id = ?", G, u);

test("command registered with Arabic options", () => {
  const c = bot.commands.get("اعداد-العقارات")!;
  expect(c.options!.map((x: any) => x.name)).toEqual(["روم_المواطنين", "روم_الادارة", "روم_الطلبات", "روم_السوق", "روم_اللوق"]);
});

test("add property (and duplicate)", async () => {
  const add = { custom_id: "realestate:add", ...fields({ prop_id: "shop_01", category: "محلات", location: "حي النخيل", price: "250000", profit: "١٠٠٠" }) };
  expect(text(await interact(5, ADMIN, add))).toContain("تم إضافة");
  expect(text(await interact(5, ADMIN, add))).toContain("مستخدم مسبقاً");
  const p = re.get<any>("SELECT * FROM properties WHERE property_id = 'shop_01'");
  expect(p.profit_amount).toBe(1000);
  expect(p.status).toBe("متاح");
  expect(text(await interact(5, ADMIN, { custom_id: "realestate:add", ...fields({ prop_id: "x", category: "a", location: "b", price: "1.5", profit: "0" }) }))).toContain("أرقاماً صحيحة");
});

test("admin list / stats", async () => {
  expect(text(await interact(3, ADMIN, { custom_id: "admin_menu_select_v12", component_type: 3, values: ["list"] }))).toContain("shop_01");
  expect(text(await interact(3, ADMIN, { custom_id: "admin_menu_select_v12", component_type: 3, values: ["stats"] }))).toContain("إحصائيات");
});

test("browse → buy request → accept moves money and ownership", async () => {
  const cs = await interact(3, BUYER, { custom_id: "citizen_menu_select_v12", component_type: 3, values: ["محلات"] });
  const sel = responses(cs)[0].data.components[0].components[0];
  const rowId = sel.options[0].value;
  expect(sel.options[0].label).toBe("shop_01 (250,000 ريال)");
  const modal = responses(await interact(3, BUYER, { custom_id: "realestate:browse", component_type: 3, values: [rowId] }))[0];
  expect(modal.type).toBe(9);
  const sent = await interact(5, BUYER, { custom_id: modal.data.custom_id, ...fields({ notes: "ابي محل" }) });
  const reqMsg = sent.find((c) => c.path === `/channels/${REQ}/messages`)!.body;
  expect(reqMsg.embeds[0].footer.text).toBe("معرف العقار: shop_01");
  expect(sent.some((c) => c.path === `/channels/${LOGS}/messages`)).toBe(true);
  const acc = await interact(3, ADMIN, { custom_id: "accept_req_v12", component_type: 2 }, { id: "m1", embeds: reqMsg.embeds });
  expect(text(acc)).toContain("تم قبول الطلب");
  expect(balance(BUYER)).toBe(750_000);
  expect(balance(ADMIN)).toBe(250_000);
  const p = re.get<any>("SELECT owner_id, status FROM properties WHERE property_id = 'shop_01'");
  expect(String(p.owner_id)).toBe(BUYER);
  expect(p.status).toBe("مباع");
  expect(bank.value<number>("SELECT COUNT(*) FROM transactions")).toBe(2);
});

test("claim profits then cooldown", async () => {
  const cs = await interact(3, BUYER, { custom_id: "citizen_menu_select_v12", component_type: 3, values: ["claim_profits"] });
  expect(text(cs)).toContain("تم استلام الأرباح");
  expect(balance(BUYER)).toBe(751_000);
  const ts = re.value<string>("SELECT last_claimed_timestamp FROM properties WHERE property_id = 'shop_01'")!;
  expect(ts).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}$/);
  expect(text(await interact(3, BUYER, { custom_id: "citizen_menu_select_v12", component_type: 3, values: ["claim_profits"] }))).toContain("47 ساعة");
  expect(balance(BUYER)).toBe(751_000);
});

test("sell on market and buy", async () => {
  const pick = responses(await interact(3, BUYER, { custom_id: "citizen_menu_select_v12", component_type: 3, values: ["sell"] }))[0];
  const rowId = pick.data.components[0].components[0].options[0].value;
  const modal = responses(await interact(3, BUYER, { custom_id: "realestate:sellpick", component_type: 3, values: [rowId] }))[0];
  const sent = await interact(5, BUYER, { custom_id: modal.data.custom_id, ...fields({ price: "300000" }) });
  const mk = sent.find((c) => c.path === `/channels/${MARKET}/messages`)!.body;
  expect(text(await interact(3, BUYER, { custom_id: "market_buy_prop_btn_v12", component_type: 2 }, { id: "m2", embeds: mk.embeds }))).toContain("عقارك الخاص");
  expect(text(await interact(3, SELLER, { custom_id: "market_buy_prop_btn_v12", component_type: 2 }, { id: "m2", embeds: mk.embeds }))).toContain("لا يكفي");
  bank.run("UPDATE accounts SET balance = 400000 WHERE user_id = ?", SELLER);
  expect(text(await interact(3, SELLER, { custom_id: "market_buy_prop_btn_v12", component_type: 2 }, { id: "m2", embeds: mk.embeds }))).toContain("تمت عملية شراء");
  expect(balance(SELLER)).toBe(100_000);
  expect(balance(BUYER)).toBe(1_051_000);
  expect(String(re.value("SELECT owner_id FROM properties WHERE property_id = 'shop_01'"))).toBe(SELLER);
  expect(text(await interact(3, ADMIN, { custom_id: "market_buy_prop_btn_v12", component_type: 2 }, { id: "m2", embeds: mk.embeds }))).toContain("لم يعد ملكاً");
});

test("edit, transfer, delete", async () => {
  const rowId = String(re.value("SELECT id FROM properties WHERE property_id = 'shop_01'"));
  const m = responses(await interact(3, ADMIN, { custom_id: "realestate:editpick", component_type: 3, values: [rowId] }))[0];
  expect(m.data.components[3].components[0].value).toBe("250000, 1000");
  await interact(5, ADMIN, { custom_id: m.data.custom_id, ...fields({ name: "محل", category: "محلات", location: "x", price: "5, 6", desc: "متاح - وصف - جديد" }) });
  const p = re.get<any>("SELECT * FROM properties WHERE property_id = 'shop_01'");
  expect([p.name, p.price, p.profit_amount, p.status, p.description]).toEqual(["محل", 5, 6, "متاح", "وصف - جديد"]);
  const x = responses(await interact(3, ADMIN, { custom_id: "realestate:xferpick", component_type: 3, values: [rowId] }))[0];
  await interact(3, ADMIN, { custom_id: x.data.components[0].components[0].custom_id, component_type: 5, values: [ADMIN] });
  expect(String(re.value("SELECT owner_id FROM properties WHERE property_id = 'shop_01'"))).toBe(ADMIN);
  await interact(3, ADMIN, { custom_id: "realestate:delpick", component_type: 3, values: [rowId] });
  expect(re.value("SELECT COUNT(*) FROM properties")).toBe(0);
});
