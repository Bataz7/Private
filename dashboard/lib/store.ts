/**
 * قراءة/كتابة إعدادات الأقسام — نفس ملفات data/ ونفس الجداول والأعمدة والمفاتيح اللي يقرأها البوت.
 * الآيديات دايماً نصوص في الكود، وتُكتب في أعمدة INTEGER كـ BigInt (نفس التخزين القديم بالضبط).
 */
import { db, JsonStore, type Sql } from "../../src/core/db.ts";
import { PRESETS } from "../ui/presets.ts";
import { type Channel, type Guild } from "./discord.ts";
import { fail, HttpError } from "./errors.ts";

export type Data = Record<string, any>;

/** سياق السيرفر: بياناته ورومّاته (من كاش REST). */
export interface Ctx {
  gid: string;
  g: Guild;
  chans: Channel[];
  /** أعلى رتبة للبوت (للرتبة التلقائية). */
  botTop?: () => Promise<number | null>;
}

/* ---------- أدوات بنفس منطق بايثون ---------- */
/** truthiness بنفس قواعد بايثون. */
export function truthy(v: unknown): boolean {
  if (v == null || v === false || v === 0 || v === "" || v === 0n) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}
const sid = (v: unknown): string => (truthy(v) ? String(v) : "");
const isDigits = (s: string) => /^\d+$/.test(s);
/** عدد الأحرف (code points) مثل len() في بايثون. */
export const plen = (s: string) => [...s].length;
const cut = (s: string, n: number) => [...s].slice(0, n).join("");
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const big = (id: string | null | undefined) => (id ? BigInt(id) : null);

const hasChannel = (c: Ctx, id: string) => c.chans.some((x) => x.id === id);
const hasRole = (c: Ctx, id: string) => c.g.roles.some((r) => r.id === id);

/** نفس clean() القديمة: نصوص مقصوصة، آيديات تتبع السيرفر، وحقول مطلوبة (REQ:<key>). */
function clean(c: Ctx, d: Data, text: string[], ids: string[], req: string[]): Record<string, string | null> {
  const o: Record<string, string | null> = {};
  for (const k of text) {
    const v = d[k];
    o[k] = typeof v === "string" ? v.trim() || null : null;
  }
  for (const k of ids) {
    const s = truthy(d[k]) ? str(d[k]) : "";
    const v = isDigits(s) && s.length <= 22 && /[1-9]/.test(s) ? s.replace(/^0+/, "") : null;
    if (v && !(hasChannel(c, v) || hasRole(c, v))) fail(400, "روم أو رتبة ما تتبع هذا السيرفر");
    o[k] = v;
  }
  for (const k of req) if (!o[k]) fail(400, "REQ:" + k);
  return o;
}

function slotOk(s: string, n: number) {
  if (!Array.from({ length: n }, (_, i) => String(i + 1)).includes(s)) fail(400, "رقم غير صالح");
}

/** قراءة آمنة من SQLite: لو الجدول مو موجود نرجع القيمة الافتراضية (مثل except sqlite3.Error). */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
/** كتابة: أي خطأ SQLite يصير 500 برسالة القسم. */
function write(msg: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    fail(500, msg);
  }
}

const stores = new Map<string, JsonStore>();
const json = (file: string) => {
  let s = stores.get(file);
  if (!s) stores.set(file, (s = new JsonStore(file)));
  return s;
};
const jload = (file: string): Data => {
  const d = json(file).get();
  return d && typeof d === "object" && !Array.isArray(d) ? d : {};
};
const jsave = (file: string, d: Data) => json(file).save(d);
const isObj = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v);

/* ---------- dashboard.db: إعدادات عامة + تقييمات ---------- */
let dashDb: Sql | null = null;
function dash(): Sql {
  if (!dashDb) {
    dashDb = db("dashboard.db");
    dashDb.exec(`CREATE TABLE IF NOT EXISTS settings(guild_id TEXT, section TEXT, slot TEXT DEFAULT '', data TEXT, PRIMARY KEY(guild_id, section, slot));
      CREATE TABLE IF NOT EXISTS panels(guild_id TEXT, section TEXT, slot TEXT, channel_id TEXT, message_id TEXT, PRIMARY KEY(guild_id, section, slot));
      CREATE TABLE IF NOT EXISTS ratings(user_id TEXT PRIMARY KEY, stars INTEGER, comment TEXT, ts INTEGER);`);
  }
  return dashDb;
}
export function getSettings(gid: string, section: string, slot = ""): Data {
  const r = dash().get<{ data: string }>("SELECT data FROM settings WHERE guild_id=? AND section=? AND slot=?", gid, section, slot);
  if (!r) return {};
  try {
    return JSON.parse(r.data);
  } catch {
    return {};
  }
}
export function saveSettings(gid: string, section: string, data: Data, slot = "") {
  dash().run("REPLACE INTO settings VALUES(?,?,?,?)", gid, section, slot, JSON.stringify(data));
}

/* ---------- التذاكر: tickets_data.json {guild: {num: {...}}} ---------- */
const TKF = "tickets_data.json";
const TK_IDS = ["category_id", "support_role_id", "ticket_mod_role_id", "log_channel_id", "rating_channel_id", "panel_channel_id"];
function rTickets(c: Ctx, s: string): Data {
  const d = jload(TKF)[c.gid]?.[s];
  if (!isObj(d)) return {};
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, TK_IDS.includes(k) ? sid(v) : v]));
}
function toInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^\s*[-+]?\d+\s*$/.test(v)) return Number.parseInt(v, 10);
  if (typeof v === "boolean") return v ? 1 : 0;
  return Number.NaN;
}
function wTickets(c: Ctx, s: string, d: Data) {
  slotOk(s, 10);
  const o: Data = clean(c, d, ["name", "welcome_msg", "image_url", "preset"], TK_IDS, ["name", "category_id", "support_role_id", "ticket_mod_role_id", "log_channel_id"]);
  if (o.preset && !(o.preset in PRESETS)) o.preset = null;
  o.questions = (Array.isArray(d.questions) ? d.questions : [])
    .filter((q: unknown): q is string => typeof q === "string" && !!q.trim())
    .map((q: string) => cut(q.trim(), 45))
    .slice(0, 5);
  const n = toInt(truthy(d.max_open) ? d.max_open : 1);
  o.max_open = Number.isNaN(n) ? 1 : Math.max(1, Math.min(5, n));
  const a = jload(TKF);
  if (!isObj(a[c.gid])) a[c.gid] = {};
  a[c.gid][s] = o;
  jsave(TKF, a);
}
export function ticketItems(gid: string): { num: string; name: string }[] {
  const d = jload(TKF)[gid];
  if (!isObj(d)) return [];
  return Object.entries(d)
    .filter(([k, v]) => isObj(v) && isDigits(k))
    .sort((x, y) => Number(x[0]) - Number(y[0]))
    .map(([k, v]) => ({ num: k, name: str((v as Data).name ?? "") }));
}

/* ---------- التقديمات: apply_data.json {guild: {num: {...}}} ---------- */
const APF = "apply_data.json";
function rApply(c: Ctx, s: string): Data {
  const d = jload(APF)[c.gid]?.[s];
  if (!isObj(d) || !Object.keys(d).length) return {};
  const gr = [...(Array.isArray(d.given_roles_ids) ? d.given_roles_ids : []), null, null];
  return {
    name: d.name ?? null, admin_role_id: sid(d.admin_role_id), review_channel_id: sid(d.review_channel_id), accept_msg: d.accept_msg ?? null,
    reject_msg: d.reject_msg ?? null, given1: sid(gr[0]), given2: sid(gr[1]), removed_role_id: sid(d.removed_role_id),
    panel_channel_id: sid(d.panel_channel_id), questions: Array.isArray(d.questions) ? d.questions : [],
  };
}
function wApply(c: Ctx, s: string, d: Data) {
  slotOk(s, 10);
  const o = clean(c, d, ["name", "accept_msg", "reject_msg"], ["admin_role_id", "review_channel_id", "removed_role_id", "given1", "given2", "panel_channel_id"],
    ["name", "admin_role_id", "review_channel_id", "accept_msg", "reject_msg"]);
  const qs = (Array.isArray(d.questions) ? d.questions : []).filter((q: unknown): q is string => typeof q === "string" && !!q.trim()).map((q: string) => q.trim()).slice(0, 5);
  if (!qs.length) fail(400, "REQ:questions");
  if (qs.some((q: string) => plen(q) > 45)) fail(400, "السؤال لازم يكون 45 حرف أو أقل");
  const row = {
    num: s, name: cut(o.name!, 90), admin_role_id: o.admin_role_id, review_channel_id: o.review_channel_id,
    accept_msg: o.accept_msg, reject_msg: o.reject_msg, given_roles_ids: [o.given1, o.given2].filter(Boolean),
    removed_role_id: o.removed_role_id, panel_channel_id: o.panel_channel_id, questions: qs,
  };
  const a = jload(APF);
  if (!isObj(a[c.gid])) a[c.gid] = {};
  a[c.gid][s] = row;
  jsave(APF, a);
}
export function applyItems(gid: string): { num: string; name: string }[] {
  const d = jload(APF)[gid];
  if (!isObj(d)) return [];
  return Object.entries(d)
    .filter(([k, v]) => isObj(v) && isDigits(k))
    .map(([k, v]) => ({ num: k, name: str((v as Data).name || "") }))
    .sort((x, y) => Number(x.num) - Number(y.num));
}

/* ---------- حالة الرول: roleplay_data.json {guild: {...}} ---------- */
const RPF = "roleplay_data.json";
const RP_IDS = ["panel_channel_id", "channel_id", "ping_role_id", "manager_role_id"];
function rRoleplay(c: Ctx): Data {
  const d = jload(RPF)[c.gid];
  if (!isObj(d)) return {};
  return Object.fromEntries(Object.entries(d).filter(([k]) => k !== "last_status_msg_id").map(([k, v]) => [k, RP_IDS.includes(k) ? sid(v) : v]));
}
function wRoleplay(c: Ctx, _s: string, d: Data) {
  const o = clean(c, d, ["start_msg", "end_msg", "vote_msg"], RP_IDS, ["channel_id"]);
  const a = jload(RPF);
  a[c.gid] = { ...(isObj(a[c.gid]) ? a[c.gid] : {}), ...o };
  jsave(RPF, a);
}

/* ---------- الترحيب والمغادرة: welcome_goodbye.db (1 = ترحيب، 2 = مغادرة) ---------- */
const WT: Record<string, string> = { "1": "welcome", "2": "goodbye" };
export const COLORS = ["أزرق", "أخضر", "أحمر", "أصفر", "بنفسجي", "برتقالي", "أبيض", "أسود"];
export const EMBEDS = ["ايمبد عادي", "ايمبد حديث"];
const BOOLS = ["show_avatar", "ignore_bots", "disable_mention", "status"];
const WL_STYLES = ["royal", "neon", "glass", "minimal", "sunset", "aurora"];
const WL_COLUMNS: [string, string][] = [["card", "INTEGER DEFAULT 1"], ["card_style", "TEXT DEFAULT 'royal'"], ["card_bg", "TEXT"], ["card_title", "TEXT"], ["card_sub", "TEXT"]];
function welcomeDb(): Sql {
  const w = db("welcome_goodbye.db");
  w.exec(`CREATE TABLE IF NOT EXISTS welcome_settings (
    guild_id INTEGER, type TEXT, channel_id INTEGER, color TEXT, show_avatar INTEGER, ignore_bots INTEGER, disable_mention INTEGER,
    embed_type TEXT, image_url TEXT, embed_text TEXT, outside_text TEXT, status INTEGER DEFAULT 1, PRIMARY KEY (guild_id, type))`);
  for (const [col, ddl] of WL_COLUMNS) w.addColumn("welcome_settings", col, ddl);
  return w;
}
function rWelcome(c: Ctx, s: string): Data {
  const r = safe(() => db("welcome_goodbye.db").get<Data>("SELECT * FROM welcome_settings WHERE guild_id=? AND type=?", big(c.gid), WT[s] ?? null), undefined);
  if (!r) return {};
  const d: Data = { ...r, guild_id: String(r.guild_id), channel_id: sid(r.channel_id) };
  for (const k of BOOLS) d[k] = truthy(d[k]);
  d.card = d.card != null ? truthy(d.card) : true;
  d.card_style = d.card_style || "royal";
  return d;
}
function wWelcome(c: Ctx, s: string, d: Data) {
  if (!(s in WT)) fail(400, "نوع غير صالح");
  const o = clean(c, d, ["color", "embed_type", "image_url", "embed_text", "outside_text"], ["channel_id"], ["channel_id", "color", "embed_type"]);
  if (!COLORS.includes(o.color!) || !EMBEDS.includes(o.embed_type!)) fail(400, "قيمة غير صالحة");
  const b = BOOLS.map((k) => (truthy(d[k]) ? 1 : 0));
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const card = {
    card: ("card" in d ? truthy(d.card) : true) ? 1 : 0,
    card_style: WL_STYLES.includes(d.card_style) ? d.card_style : "royal",
    card_bg: text(d.card_bg) || null,
    card_title: cut(text(d.card_title), 40) || null,
    card_sub: cut(text(d.card_sub), 70) || null,
  };
  if (card.card_bg && !/^https?:\/\//.test(card.card_bg)) fail(400, "رابط الصورة لازم يبدأ بـ http أو https");
  write("قاعدة بيانات الترحيب غير جاهزة", () =>
    welcomeDb().run(
      `INSERT INTO welcome_settings(guild_id,type,channel_id,color,show_avatar,ignore_bots,disable_mention,embed_type,image_url,embed_text,outside_text,status,card,card_style,card_bg,card_title,card_sub)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(guild_id,type) DO UPDATE SET channel_id=excluded.channel_id,color=excluded.color,
       show_avatar=excluded.show_avatar,ignore_bots=excluded.ignore_bots,disable_mention=excluded.disable_mention,embed_type=excluded.embed_type,
       image_url=excluded.image_url,embed_text=excluded.embed_text,outside_text=excluded.outside_text,status=excluded.status,
       card=excluded.card,card_style=excluded.card_style,card_bg=excluded.card_bg,card_title=excluded.card_title,card_sub=excluded.card_sub`,
      big(c.gid), WT[s], big(o.channel_id), o.color, b[0], b[1], b[2], o.embed_type, o.image_url, o.embed_text, o.outside_text, b[3],
      card.card, card.card_style, card.card_bg, card.card_title, card.card_sub,
    ),
  );
}

/* ---------- الهوية: id_data.json (إعداد واحد على مستوى الملف، يحافظ على submitted) ---------- */
const IDF = "id_data.json";
const ID_IDS = ["admins_channel_id", "add_role_id", "rem_role_id", "panel_channel_id"];
function rIdentity(): Data {
  const d = jload(IDF);
  const o: Data = Object.fromEntries(ID_IDS.map((k) => [k, sid(d[k])]));
  o.change_nick = "change_nick" in d ? truthy(d.change_nick) : true;
  return o;
}
function wIdentity(c: Ctx, _s: string, d: Data) {
  const o = clean(c, d, [], ID_IDS, ["admins_channel_id"]);
  const a = jload(IDF);
  const submitted = a.submitted;
  Object.assign(a, o);
  a.submitted = Array.isArray(submitted) ? submitted : [];
  a.change_nick = "change_nick" in d ? truthy(d.change_nick) : true;
  jsave(IDF, a);
}

/* ---------- جداول بسيطة (صف لكل سيرفر) ---------- */
function simple(file: string, table: string, cols: string[]) {
  const ensure = () => {
    const s = db(file);
    s.exec(`CREATE TABLE IF NOT EXISTS ${table} (guild_id INTEGER PRIMARY KEY, ${cols.map((k) => `${k} INTEGER`).join(", ")})`);
    return s;
  };
  return {
    read(c: Ctx): Data {
      const x = safe(() => db(file).get<Data>(`SELECT ${cols.join(",")} FROM ${table} WHERE guild_id=?`, big(c.gid)), undefined);
      return x ? Object.fromEntries(cols.map((k) => [k, sid(x[k])])) : {};
    },
    write(c: Ctx, _s: string, d: Data) {
      const o = clean(c, d, [], cols, cols);
      write("قاعدة البيانات غير جاهزة", () =>
        ensure().run(`INSERT OR REPLACE INTO ${table}(guild_id,${cols.join(",")}) VALUES(?${",?".repeat(cols.length)})`, big(c.gid), ...cols.map((k) => big(o[k]))),
      );
    },
  };
}
const WEAPONS = simple("weapons.db", "weapon_settings", ["panel_channel", "log_channel"]);
const TRAFFIC = simple("bank_traffic.db", "traffic_settings", ["police_role", "control_channel", "citizen_channel", "log_channel"]);

/* ---------- العقارات: real_estate.db (جدول settings: key, channel_id) ---------- */
const RE_KEYS = ["citizen_channel", "admin_channel", "requests_channel", "market_channel", "logs_channel"];
function rRealEstate(): Data {
  const rows = safe(() => db("real_estate.db").all<{ key: string; channel_id: unknown }>("SELECT key, channel_id FROM settings"), []);
  const m = new Map(rows.map((r) => [r.key, r.channel_id]));
  return Object.fromEntries(RE_KEYS.filter((k) => truthy(m.get(k))).map((k) => [k, sid(m.get(k))]));
}
function wRealEstate(c: Ctx, _s: string, d: Data) {
  const o = clean(c, d, [], RE_KEYS, ["requests_channel", "market_channel", "logs_channel"]);
  write("قاعدة بيانات العقارات غير جاهزة", () => {
    const s = db("real_estate.db");
    s.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, channel_id INTEGER)");
    s.tx(() => {
      for (const k of RE_KEYS) {
        if (o[k]) s.run("INSERT OR REPLACE INTO settings (key, channel_id) VALUES (?, ?)", k, big(o[k]));
        else s.run("DELETE FROM settings WHERE key=?", k);
      }
    });
  });
}

/* ---------- الأذكار: azkar_settings.db ---------- */
const INTERVALS = [5, 10, 15, 30, 45];
function rAzkar(c: Ctx): Data {
  const r = safe(() => db("azkar_settings.db").get<Data>("SELECT channel_id, interval_minutes, status FROM server_azkar WHERE guild_id=?", big(c.gid)), null);
  if (r === null) return {};
  if (!r) return { channel_id: "", interval: 15, status: false };
  return { channel_id: sid(r.channel_id), interval: Number(r.interval_minutes) || 15, status: String(r.status).toUpperCase() === "TRUE" };
}
function wAzkar(c: Ctx, _s: string, d: Data) {
  const interval = toInt(truthy(d.interval) ? d.interval : 15);
  if (Number.isNaN(interval)) fail(400, "المدة غير صالحة");
  if (!INTERVALS.includes(interval)) fail(400, "اختر مدة من 5 أو 10 أو 15 أو 30 أو 45 دقيقة");
  const enabled = truthy(d.status);
  const raw = truthy(d.channel_id) ? str(d.channel_id) : "";
  const channel = isDigits(raw) && /[1-9]/.test(raw) && raw.length <= 22 ? raw.replace(/^0+/, "") : "";
  if (channel && !hasChannel(c, channel)) fail(400, "روم الأذكار ما يتبع هذا السيرفر");
  if (enabled && !channel) fail(400, "حدد روم الأذكار عند تفعيل النظام");
  write("قاعدة بيانات الأذكار غير جاهزة", () => {
    const s = db("azkar_settings.db");
    s.exec(`CREATE TABLE IF NOT EXISTS server_azkar (guild_id INTEGER PRIMARY KEY, channel_id INTEGER,
      interval_minutes INTEGER DEFAULT 15, status TEXT DEFAULT 'FALSE')`);
    s.run(`INSERT INTO server_azkar(guild_id, channel_id, interval_minutes, status) VALUES(?,?,?,?)
      ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id, interval_minutes=excluded.interval_minutes, status=excluded.status`,
      big(c.gid), channel ? BigInt(channel) : 0, interval, enabled ? "TRUE" : "FALSE");
  });
}

/* ---------- المستويات: levels_settings.db ---------- */
export const LEVEL_DEFAULT = "مبروك {user}، لقد صعدت إلى المستوى {level}! (المستوى القادم: {next-level})";
function rLevels(c: Ctx): Data {
  const r = safe(() => db("levels_settings.db").get<Data>("SELECT channel_id, custom_message FROM server_levels_settings WHERE guild_id=?", big(c.gid)), null);
  if (r === null) return {};
  if (!r) return { channel_id: "", message: LEVEL_DEFAULT };
  return { channel_id: sid(r.channel_id), message: r.custom_message || LEVEL_DEFAULT };
}
function wLevels(c: Ctx, _s: string, d: Data) {
  const channel = truthy(d.channel_id) ? str(d.channel_id) : "";
  if (!isDigits(channel) || !hasChannel(c, channel)) fail(400, "حدد روم نصي صالح للمستويات");
  const message = str(truthy(d.message) ? d.message : "").trim();
  if (!message) fail(400, "اكتب رسالة المستويات");
  if (plen(message) > 2000) fail(400, "رسالة المستويات 2000 حرف كحد أقصى");
  const allowed = new Set(["{user}", "{level}", "{next-level}", "{xp}"]);
  const unknown = [...new Set(message.match(/\{[^{}]+\}/g) ?? [])].filter((x) => !allowed.has(x)).sort();
  if (unknown.length) fail(400, "متغير غير معروف: " + unknown.join(", "));
  write("قاعدة بيانات المستويات غير جاهزة", () => {
    const s = db("levels_settings.db");
    s.exec("CREATE TABLE IF NOT EXISTS server_levels_settings (guild_id INTEGER PRIMARY KEY, channel_id INTEGER, custom_message TEXT)");
    s.run(`INSERT INTO server_levels_settings(guild_id, channel_id, custom_message) VALUES(?,?,?)
      ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id, custom_message=excluded.custom_message`, big(c.gid), BigInt(channel), message);
  });
}

/* ---------- التفعيل: activation_settings.json {guild: {...}} ---------- */
const ACF = "activation_settings.json";
const AC_IDS = ["panel_channel_id", "staff_channel_id", "add_role_id", "remove_role_id", "staff_role_id"];
function rActivation(c: Ctx): Data {
  const d = jload(ACF)[c.gid];
  if (!isObj(d)) return {};
  return Object.fromEntries(AC_IDS.filter((k) => truthy(d[k])).map((k) => [k, sid(d[k])]));
}
function wActivation(c: Ctx, _s: string, d: Data) {
  const o = clean(c, d, [], AC_IDS, ["staff_channel_id"]);
  const a = jload(ACF);
  a[c.gid] = o;
  jsave(ACF, a);
}

/* ---------- الردود التلقائية: auto_responses.json {guild: {keyword: {response, match_type, mention}}} ---------- */
const ARF = "auto_responses.json";
const arLegacy = (a: Data) => Object.values(a).some((v) => isObj(v) && "response" in v && "match_type" in v);
function rReplies(c: Ctx): Data {
  const a = jload(ARF);
  if (arLegacy(a)) return { items: [], legacy: true };
  const g = isObj(a[c.gid]) ? a[c.gid] : {};
  return {
    items: Object.entries(g).map(([k, v]: [string, any]) => ({
      keyword: k, response: v?.response ?? "", match_type: v?.match_type ?? "contains", mention: v?.mention === "true",
    })),
  };
}
function wReplies(c: Ctx, _s: string, d: Data) {
  const a = jload(ARF);
  if (arLegacy(a)) throw new HttpError(409, "حدّث ملف الردود reply.py بالنسخة الجديدة أول");
  const out: Data = {};
  for (const it of Array.isArray(d.items) ? d.items : []) {
    if (!isObj(it)) continue;
    const k = str(truthy(it.keyword) ? it.keyword : "").toLowerCase().trim();
    const r = str(truthy(it.response) ? it.response : "").trim();
    if (!k && !r) continue;
    if (!k || !r) fail(400, "كل رد لازم له كلمة مفتاحية ونص");
    if (plen(k) > 100 || plen(r) > 2000) fail(400, "الكلمة 100 حرف والرد 2000 حرف كحد أقصى");
    out[k] = { response: r, match_type: it.match_type === "exact" ? "exact" : "contains", mention: truthy(it.mention) ? "true" : "false" };
  }
  a[c.gid] = out;
  jsave(ARF, a);
}

/* ---------- البنك: bank.db (guild_settings) ---------- */
const BK_IDS = ["account_panel_channel_id", "citizens_panel_channel_id", "staff_panel_channel_id", "loan_channel_id", "log_channel_id", "bank_staff_role_id"];
const bkCols = (s: Sql) => {
  for (const k of BK_IDS) {
    try {
      s.exec(`ALTER TABLE guild_settings ADD COLUMN ${k} INTEGER`);
    } catch {}
  }
};
function rBank(c: Ctx): Data {
  return safe(() => {
    const s = db("bank.db");
    bkCols(s);
    const r = s.get<Data>(`SELECT ${BK_IDS.join(",")} FROM guild_settings WHERE guild_id=?`, big(c.gid));
    return r ? Object.fromEntries(BK_IDS.filter((k) => truthy(r[k])).map((k) => [k, sid(r[k])])) : {};
  }, {});
}
function wBank(c: Ctx, _s: string, d: Data) {
  const o = clean(c, d, [], BK_IDS, []);
  write("قاعدة بيانات البنك غير جاهزة", () => {
    const s = db("bank.db");
    s.exec("CREATE TABLE IF NOT EXISTS guild_settings (guild_id INTEGER PRIMARY KEY, loan_channel_id INTEGER, log_channel_id INTEGER, bank_staff_role_id INTEGER)");
    bkCols(s);
    s.tx(() => {
      s.run("INSERT OR IGNORE INTO guild_settings(guild_id) VALUES(?)", big(c.gid));
      s.run(`UPDATE guild_settings SET ${BK_IDS.map((k) => `${k}=?`).join(",")} WHERE guild_id=?`, ...BK_IDS.map((k) => big(o[k])), big(c.gid));
    });
  });
}

/* ---------- الرتبة التلقائية: autorole.db ---------- */
function rAutorole(c: Ctx): Data {
  const r = safe(() => db("autorole.db").get<Data>("SELECT role_id FROM auto_roles WHERE guild_id=?", big(c.gid)), undefined);
  return r && truthy(r.role_id) ? { role_id: sid(r.role_id) } : {};
}
async function wAutorole(c: Ctx, _s: string, d: Data) {
  const rid = clean(c, d, [], ["role_id"], []).role_id;
  if (rid) {
    const role = c.g.roles.find((r) => r.id === rid);
    if (!role || role.id === c.gid || role.managed) fail(400, "هذي الرتبة ما تنفع كرتبة تلقائية");
    const top = c.botTop ? await c.botTop() : null;
    if (top !== null && role.position >= top) fail(400, "الرتبة أعلى من رتبة البوت أو تساويها، ارفع رتبة البوت فوقها أول");
  }
  write("قاعدة بيانات الرتبة التلقائية غير جاهزة", () => {
    const s = db("autorole.db");
    s.exec("CREATE TABLE IF NOT EXISTS auto_roles (guild_id INTEGER PRIMARY KEY, role_id INTEGER)");
    if (rid) s.run("INSERT INTO auto_roles (guild_id, role_id) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET role_id = excluded.role_id", big(c.gid), BigInt(rid));
    else s.run("DELETE FROM auto_roles WHERE guild_id=?", big(c.gid));
  });
}

/* ---------- الاختصارات: shortcuts.db ---------- */
const SC_ON = "مفعّل";
const SC_OFF = "معطل";
const SC_ALLOWED = new Set(["ban", "kick", "timeout", "untimeout", "clear", "warn", "unban", "toggle_role", "nickname"]);
function rShortcuts(c: Ctx): Data {
  const rows = safe(() => db("shortcuts.db").all<Data>(
    "SELECT shortcut_name, target_command, status, options FROM server_shortcuts WHERE guild_id=? ORDER BY shortcut_name", big(c.gid)), null);
  if (!rows) return { items: [] };
  return {
    items: rows.map((r) => {
      let options: Data = {};
      try {
        const o = typeof r.options === "string" ? JSON.parse(r.options || "{}") : {};
        if (isObj(o)) options = o;
      } catch {}
      const target = r.target_command === "add_role" || r.target_command === "remove_role" ? "toggle_role" : r.target_command;
      return { name: String(r.shortcut_name), target, enabled: r.status === SC_ON, options };
    }),
  };
}
function wShortcuts(c: Ctx, _s: string, d: Data) {
  const items: [bigint, string, string, string, string][] = [];
  const seen = new Set<string>();
  for (const it of Array.isArray(d.items) ? d.items : []) {
    if (!isObj(it)) continue;
    const name = str(truthy(it.name) ? it.name : "").trim().toLowerCase().replace(/^[!/.#]+/, "");
    const target = str(truthy(it.target) ? it.target : "").trim().replace(/^\/+/, "");
    if (!name && !target) continue;
    if (!name || !target) fail(400, "كل اختصار لازم له اسم ونوع أمر");
    if (!SC_ALLOWED.has(target)) fail(400, "نوع الأمر غير مدعوم");
    if (/\s/.test(name)) fail(400, "الاختصار لازم يكون كلمة وحدة بدون مسافات: " + name);
    if (plen(name) > 50 || plen(target) > 100) fail(400, "الاختصار 50 حرف والأمر 100 حرف كحد أقصى");
    if (seen.has(name)) fail(400, "الاختصار مكرر: " + name);
    seen.add(name);
    const opts = isObj(it.options) ? it.options : {};
    items.push([BigInt(c.gid), name, target, truthy(it.enabled) ? SC_ON : SC_OFF, JSON.stringify({ reason_required: truthy(opts.reason_required) })]);
  }
  write("قاعدة بيانات الاختصارات غير جاهزة", () => {
    const s = db("shortcuts.db");
    s.exec(`CREATE TABLE IF NOT EXISTS server_shortcuts (guild_id INTEGER, shortcut_name TEXT, target_command TEXT, status TEXT DEFAULT '${SC_ON}', options TEXT DEFAULT '{}', PRIMARY KEY (guild_id, shortcut_name))`);
    s.tx(() => {
      s.run("DELETE FROM server_shortcuts WHERE guild_id=?", big(c.gid));
      for (const row of items) s.run("INSERT INTO server_shortcuts (guild_id, shortcut_name, target_command, status, options) VALUES (?,?,?,?,?)", ...row);
    });
  });
}

/* ---------- اللوقات: logs_settings.db (حذف الصف = إيقاف هذا اللوق) ---------- */
export const LG_TYPES = ["members_join_remove", "member_bans", "member_kick", "member_timeout", "member_roles", "nicknames", "messages",
  "reactions", "voice", "channels_crud", "channels_update", "roles_crud", "roles_update", "invites", "server_updates"];
function rLogs(c: Ctx): Data {
  const rows = safe(() => db("logs_settings.db").all<Data>("SELECT log_type, channel_id FROM server_logs WHERE guild_id=?", big(c.gid)), []);
  return Object.fromEntries(rows.filter((r) => LG_TYPES.includes(r.log_type) && truthy(r.channel_id)).map((r) => [r.log_type, sid(r.channel_id)]));
}
function wLogs(c: Ctx, _s: string, d: Data) {
  const vals: [string, string | null][] = [];
  for (const t of LG_TYPES) {
    const v = truthy(d[t]) ? str(d[t]) : "";
    if (!v) {
      vals.push([t, null]);
      continue;
    }
    if (!isDigits(v) || !c.chans.some((x) => x.id === v && x.type === 0)) fail(400, "اللوق لازم يكون في روم نصي من هذا السيرفر");
    vals.push([t, v]);
  }
  write("قاعدة بيانات اللوقات غير جاهزة", () => {
    const s = db("logs_settings.db");
    s.exec("CREATE TABLE IF NOT EXISTS server_logs (guild_id INTEGER, log_type TEXT, channel_id INTEGER, PRIMARY KEY (guild_id, log_type))");
    s.tx(() => {
      for (const [t, cid] of vals) {
        if (cid) s.run("INSERT INTO server_logs (guild_id, log_type, channel_id) VALUES (?,?,?) ON CONFLICT(guild_id, log_type) DO UPDATE SET channel_id=excluded.channel_id", big(c.gid), t, BigInt(cid));
        else s.run("DELETE FROM server_logs WHERE guild_id=? AND log_type=?", big(c.gid), t);
      }
    });
  });
}

/* ---------- الحماية: security_settings.db ---------- */
export const SE_FEATS = ["bot_add", "admin_role", "mass_ban", "mass_kick", "channel_delete", "role_delete", "role_create", "channel_create", "links"];
export const SE_PUN = ["timeout", "kick", "ban", "strip_roles"];
function rSecurity(c: Ctx): Data {
  const [st, pu] = safe(() => {
    const s = db("security_settings.db");
    return [
      new Map(s.all<Data>("SELECT feature, status FROM server_security WHERE guild_id=?", big(c.gid)).map((r) => [r.feature, r.status])),
      new Map(s.all<Data>("SELECT feature, punishment FROM security_punishments WHERE guild_id=?", big(c.gid)).map((r) => [r.feature, r.punishment])),
    ] as const;
  }, [new Map(), new Map()] as const);
  const o: Data = {};
  for (const f of SE_FEATS) {
    o[f + "__on"] = truthy(st.get(f) ?? 0);
    o[f + "__p"] = pu.get(f) ?? "timeout";
  }
  return o;
}
function wSecurity(c: Ctx, _s: string, d: Data) {
  const rows: [string, number, string][] = [];
  for (const f of SE_FEATS) {
    const p = truthy(d[f + "__p"]) ? d[f + "__p"] : "timeout";
    if (!SE_PUN.includes(p)) fail(400, "عقوبة غير صالحة");
    rows.push([f, truthy(d[f + "__on"]) ? 1 : 0, p]);
  }
  write("قاعدة بيانات الحماية غير جاهزة", () => {
    const s = db("security_settings.db");
    s.exec(`CREATE TABLE IF NOT EXISTS server_security (guild_id INTEGER, feature TEXT, status INTEGER DEFAULT 0, PRIMARY KEY (guild_id, feature));
      CREATE TABLE IF NOT EXISTS security_punishments (guild_id INTEGER, feature TEXT, punishment TEXT DEFAULT 'timeout', PRIMARY KEY (guild_id, feature));`);
    s.tx(() => {
      for (const [f, on, p] of rows) {
        s.run("INSERT INTO server_security (guild_id, feature, status) VALUES (?,?,?) ON CONFLICT(guild_id, feature) DO UPDATE SET status=excluded.status", big(c.gid), f, on);
        s.run("INSERT INTO security_punishments (guild_id, feature, punishment) VALUES (?,?,?) ON CONFLICT(guild_id, feature) DO UPDATE SET punishment=excluded.punishment", big(c.gid), f, p);
      }
    });
  });
}

/* ---------- الكلمات المحظورة: badwords_settings.db ---------- */
function rBadwords(c: Ctx): Data {
  return safe(() => {
    const s = db("badwords_settings.db");
    const words = s.all<Data>("SELECT word FROM bad_words WHERE guild_id=? ORDER BY word", big(c.gid)).map((r) => String(r.word));
    const p = s.get<Data>("SELECT punishment FROM bad_words_punishment WHERE guild_id=?", big(c.gid));
    return { words, punishment: p ? p.punishment : "timeout" };
  }, { words: [], punishment: "timeout" });
}
function wBadwords(c: Ctx, _s: string, d: Data) {
  const pun = truthy(d.punishment) ? d.punishment : "timeout";
  if (!SE_PUN.includes(pun)) fail(400, "عقوبة غير صالحة");
  const words: string[] = [];
  const seen = new Set<string>();
  for (const x0 of Array.isArray(d.words) ? d.words : []) {
    const x = str(x0).trim().toLowerCase();
    if (!x) continue;
    if (plen(x) < 2) fail(400, "الكلمة لازم تكون حرفين على الأقل: " + x);
    if (plen(x) > 100) fail(400, "الكلمة أطول من 100 حرف");
    if (!seen.has(x)) {
      seen.add(x);
      words.push(x);
    }
  }
  if (words.length > 500) fail(400, "الحد الأقصى 500 كلمة");
  write("قاعدة بيانات الكلمات المحظورة غير جاهزة", () => {
    const s = db("badwords_settings.db");
    s.exec(`CREATE TABLE IF NOT EXISTS bad_words (guild_id INTEGER, word TEXT, PRIMARY KEY (guild_id, word));
      CREATE TABLE IF NOT EXISTS bad_words_punishment (guild_id INTEGER PRIMARY KEY, punishment TEXT DEFAULT 'timeout');`);
    s.tx(() => {
      s.run("DELETE FROM bad_words WHERE guild_id=?", big(c.gid));
      for (const w of words) s.run("INSERT INTO bad_words (guild_id, word) VALUES (?,?)", big(c.gid), w);
      s.run("INSERT INTO bad_words_punishment (guild_id, punishment) VALUES (?,?) ON CONFLICT(guild_id) DO UPDATE SET punishment=excluded.punishment", big(c.gid), pun);
    });
  });
}

/* ---------- السجل ---------- */
type Reader = (c: Ctx, slot: string) => Data;
type Writer = (c: Ctx, slot: string, d: Data) => void | Promise<void>;

export const AD: Record<string, [Reader, Writer]> = {
  badwords: [rBadwords, wBadwords],
  security: [rSecurity, wSecurity],
  logs: [rLogs, wLogs],
  shortcuts: [rShortcuts, wShortcuts],
  autorole: [rAutorole, wAutorole],
  realestate: [rRealEstate, wRealEstate],
  activation: [rActivation, wActivation],
  bank: [rBank, wBank],
  replies: [rReplies, wReplies],
  tickets: [rTickets, wTickets],
  apply: [rApply, wApply],
  rolestatus: [rRoleplay, wRoleplay],
  welcome: [rWelcome, wWelcome],
  identity: [rIdentity, wIdentity],
  azkar: [rAzkar, wAzkar],
  levels: [rLevels, wLevels],
  weapons: [WEAPONS.read, WEAPONS.write],
  traffic: [TRAFFIC.read, TRAFFIC.write],
};

/** كل الأقسام المسموحة (قسم "لغة البوت" مخفي: البوت عربي فقط). */
export const SECTIONS = new Set([...Object.keys(AD), "embed"]);
/** أقسام التعديل فيها للأدمن فقط (مثل أوامر البوت). */
export const ADMIN_ONLY = new Set(["security", "badwords", "azkar", "levels"]);
/** مفاتيح البانلات: لو تعبّى واحد منها بعد الحفظ، نطلب من البوت يرسل/يحدّث البانل (عبر طابور المهام). */
export const PANEL_KEYS: Record<string, string[]> = {
  realestate: ["admin_channel", "citizen_channel"],
  activation: ["panel_channel_id"],
  rolestatus: ["panel_channel_id"],
  identity: ["panel_channel_id"],
  weapons: ["panel_channel"],
  traffic: ["control_channel", "citizen_channel"],
  bank: ["account_panel_channel_id", "citizens_panel_channel_id", "staff_panel_channel_id"],
};

export function readSection(c: Ctx, section: string, slot: string): Data {
  const h = AD[section];
  return h ? h[0](c, slot) : getSettings(c.gid, section, slot);
}

/* ---------- تقييم الموقع ---------- */
export function ratingData(uid: string) {
  const m = dash().get<{ stars: number; comment: string | null }>("SELECT stars, comment FROM ratings WHERE user_id=?", uid);
  const a = dash().get<{ avg: number | null; n: number }>("SELECT AVG(stars) AS avg, COUNT(*) AS n FROM ratings");
  return {
    mine: m ? { stars: Number(m.stars), comment: m.comment || "" } : null,
    avg: Math.round((Number(a?.avg) || 0) * 10) / 10,
    count: Number(a?.n) || 0,
  };
}
export function ratingSave(uid: string, stars: unknown, comment: unknown) {
  const n = toInt(stars);
  if (!(n >= 1 && n <= 5)) fail(400, "اختر من 1 إلى 5 نجوم");
  dash().run("REPLACE INTO ratings VALUES(?,?,?,?)", uid, n, cut(str(truthy(comment) ? comment : "").trim(), 500), Math.floor(Date.now() / 1000));
}
