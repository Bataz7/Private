import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bank-test-"));

const G = "111111111111111111";
const A = "222222222222222222";
const B = "333333333333333333";
const STAFF = "444444444444444444";
const LOANCH = "555555555555555555";

let bot: any;
let bank: typeof import("../src/features/bank.ts");
const calls: { method: string; path: string; body: any }[] = [];

beforeAll(async () => {
  const { Bot } = await import("../src/discord/client.ts");
  bank = await import("../src/features/bank.ts");
  bot = new Bot("x.y.z", 0);
  bot.appId = "999";
  const fake = (method: string) => async (path: string, o: any = {}) => {
    calls.push({ method, path, body: o.body });
    if (path === "/users/@me/channels") return { id: "dm1" };
    return { id: "m1" };
  };
  for (const m of ["get", "post", "patch", "put", "delete"]) bot.rest[m] = fake(m.toUpperCase());
  bank.default(bot);
});

const replies = () => calls.filter((c) => c.path.includes("/callback") || c.path.startsWith("/webhooks/"));
const lastText = () => {
  const c = replies().at(-1)!;
  const d = c.body?.data ?? c.body;
  return String(d?.content ?? d?.embeds?.[0]?.description ?? d?.title ?? "");
};
let n = 0;
function interact(type: number, uid: string, data: any, extra: any = {}) {
  return bot.onInteraction({
    id: String(++n), token: "t", type, guild_id: G, channel_id: "c1",
    member: { user: { id: uid, username: `u${uid.slice(0, 2)}` }, roles: extra.roles ?? [], permissions: extra.perms ?? "0" },
    data, message: extra.message,
  });
}
const click = (uid: string, custom_id: string, values?: string[], extra?: any) => interact(3, uid, { custom_id, values, component_type: 2 }, extra);
const submit = (uid: string, custom_id: string, f: Record<string, string>, extra?: any) =>
  interact(5, uid, { custom_id, components: Object.entries(f).map(([k, v]) => ({ type: 1, components: [{ type: 4, custom_id: k, value: v }] })) }, extra);

test("python int parsing", async () => {
  const { parseIntPy } = await import("../src/features/bank/store.ts");
  expect(parseIntPy(" 5000 ")).toBe(5000);
  expect(parseIntPy("٥٠٠")).toBe(500);
  expect(parseIntPy("5.0")).toBeNull();
  expect(parseIntPy("abc")).toBeNull();
  expect(parseIntPy("-3")).toBe(-3);
});

test("create accounts, transfer, helpers", async () => {
  await click(A, "bank:create_account_button_unique");
  await click(B, "bank:create_account_button_unique");
  await click(A, "bank:create_account_button_unique");
  expect(lastText()).toContain("لديك حساب بنكي بالفعل");
  const a = bank.getAccount(G, A)!;
  const b = bank.getAccount(G, B)!;
  expect(a.account_number).toMatch(/^\d{4}$/);
  expect(a.user_id).toBe(A);
  expect(bank.getBalance(G, A)).toBe(0);
  expect(bank.getBalance(G, "1")).toBeNull();

  expect(bank.addMoney(A, G, 1000)).toBe(true);
  expect(bank.deductMoney(A, G, 5000)).toBe(false);
  expect(bank.deductMoney(A, G, 100)).toBe(true);
  expect(bank.getBalance(G, A)).toBe(900);

  await submit(A, "bank:m:transfer", { iban: b.account_number, amount: "1000" });
  expect(lastText()).toContain("رصيدك غير كافي");
  await submit(A, "bank:m:transfer", { iban: b.account_number, amount: "400" });
  expect(lastText()).toContain("تم تحويل");
  expect(bank.getBalance(G, A)).toBe(500);
  expect(bank.getBalance(G, B)).toBe(400);
});

test("staff actions require staff, freeze toggles", async () => {
  const b = bank.getAccount(G, B)!;
  await click(A, "bank_staff_select_menu_unique", ["add"]);
  expect(lastText()).toContain("ليس لديك صلاحية");
  await submit(STAFF, "bank:m:staff:add", { iban: b.account_number, amount: "100" }, { perms: "8" });
  expect(bank.getBalance(G, B)).toBe(500);
  await submit(STAFF, "bank:m:staff:freeze", { iban: b.account_number }, { perms: "8" });
  expect(bank.getAccount(G, B)!.is_frozen).toBe(1);
  await submit(STAFF, "bank:m:staff:freeze", { iban: b.account_number }, { perms: "8" });
  expect(bank.getAccount(G, B)!.is_frozen).toBe(0);
});

test("loan request -> accept from embed -> repay", async () => {
  await interact(2, STAFF, { name: "اعداد-البنك", options: [{ name: "البانل", type: 3, value: "account" }, { name: "روم_القروض", type: 7, value: LOANCH }] }, { perms: "8" });
  expect(bank.getSettings(G)!.loan_channel_id).toBe(LOANCH);
  expect(bank.getSettings(G)!.account_panel_channel_id).toBe("c1");
  // روم القروض مو في الكاش → رسالة خطأ زي بايثون
  await submit(A, "bank:m:loan", { q1: "x", q2: "y", q3: "1000", q4: "z", q5: "موافق" });
  expect(lastText()).toContain("روم القروض غير موجود");

  const a = bank.getAccount(G, A)!;
  const message = {
    id: "lm1",
    embeds: [{ fields: [
      { name: "المواطن", value: `<@${A}>` }, { name: "رقم الآيبان", value: `\`${a.account_number}\`` },
      { name: "3- مبلغ القرض المطلوب", value: "**1,000 ريال**" },
    ] }],
    components: [{ type: 1, components: [{ type: 2, custom_id: "loan:accept_unique" }, { type: 2, custom_id: "loan:reject_unique" }] }],
  };
  await click(A, "loan:accept_unique", undefined, { message });
  expect(lastText()).toContain("للإدارة أو مسؤولي البنك فقط");
  await click(STAFF, "loan:accept_unique", undefined, { message, perms: "8" });
  expect(bank.getBalance(G, A)).toBe(1500);
  const loan = bank.bankSql.get<any>("SELECT * FROM loans WHERE guild_id = ? AND user_id = ?", G, A)!;
  expect(loan.amount).toBe(1000);

  await submit(A, "bank:m:repay", { loan_id: String(loan.id), amount: "5000" });
  expect(bank.getBalance(G, A)).toBe(500);
  expect(bank.bankSql.value("SELECT status FROM loans WHERE id = ?", loan.id)).toBe("paid");
});
