/**
 * لوحة تحكم ريفايف — برنامج Bun منفصل عن البوت (TSX مرسوم على السيرفر، بدون مكتبات).
 *   bun --smol dashboard/server.tsx
 * الإعدادات من البيئة / .env: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DASHBOARD_URL, SESSION_SECRET,
 * DASHBOARD_PORT, FORCE_HTTPS, FORWARDED_ALLOW_IPS, SSL_CERTFILE/SSL_KEYFILE, SUPPORT_URL, DISCORD_TOKEN, DATA_DIR.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { Server } from "bun";
import type { Html } from "#jsx/jsx-runtime";
import { enqueueJob, waitJob } from "../src/core/jobs.ts";
import { log } from "../src/core/log.ts";
import { cfg } from "./lib/config.ts";
import {
  avatarUrl, botGuilds, botTopPosition, discord, exchangeCode, getChannels, getGuild, guildIcon, guildMeta, isAdmin, isTextChannel,
  snowflakeDate, userInfo,
} from "./lib/discord.ts";
import { fail, HttpError, translateError } from "./lib/errors.ts";
import { parseCookies, safeEqual, serializeCookie, signSession, token, verifySession, type SessionData, type SessionUser } from "./lib/session.ts";
import {
  AD, ADMIN_ONLY, applyItems, COLORS, PANEL_KEYS, plen, ratingData, ratingSave, readSection, saveSettings, SECTIONS, ticketItems, truthy,
  type Ctx, type Data,
} from "./lib/store.ts";
import { jsBundle, pickLang, t, type Lang } from "./ui/i18n.ts";
import { SECTIONS as UI_SECTIONS } from "./ui/schema.ts";
import { css as themesCss, ORDER as THEMES } from "./ui/themes.ts";
import {
  EmojisView, EmptyView, HomeView, LanguageView, PanelView, RateView, SectionView, StatsView, ThemesView, type Emoji,
} from "./views/fragments.tsx";
import type { PageCtx } from "./views/layout.tsx";
import { Dashboard, Landing, Team } from "./views/pages.tsx";

const SESSION_COOKIE = "session";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const MAX_BODY = 256 * 1024;
/** حد أقصى لعدد السيرفرات داخل كوكي الجلسة (حجم الكوكي ≤ 4KB). */
const MAX_SESSION_GUILDS = 150;

/* ====================== سياق الطلب ====================== */
class Rc {
  readonly url: URL;
  readonly cookies: Record<string, string>;
  readonly scheme: string;
  readonly host: string;
  private sess: SessionData | undefined;
  private dirty = false;

  constructor(readonly req: Request, server: Server<undefined>) {
    this.url = new URL(req.url);
    this.cookies = parseCookies(req.headers.get("cookie"));
    this.host = (req.headers.get("host") || this.url.host).toLowerCase();
    let scheme = cfg.SSL_CERTFILE && cfg.SSL_KEYFILE ? "https" : this.url.protocol.replace(":", "");
    const fp = req.headers.get("x-forwarded-proto");
    if (fp && trusted(server, req)) {
      const p = fp.split(",")[0]!.trim().toLowerCase();
      if (p === "http" || p === "https") scheme = p;
    }
    this.scheme = scheme;
  }

  get session(): SessionData {
    if (this.sess === undefined) this.sess = verifySession(this.cookies[SESSION_COOKIE], cfg.SESSION_SECRET) ?? {};
    return this.sess;
  }
  set session(d: SessionData) {
    this.sess = d;
    this.dirty = true;
  }
  touch() {
    this.dirty = true;
  }
  get user(): SessionUser | undefined {
    return this.session.user;
  }
  /** لغة رسائل الأخطاء (X-Lang من الواجهة أو كوكي lang). */
  get errLang(): Lang {
    return (this.req.headers.get("x-lang") || this.cookies.lang || "").toLowerCase().startsWith("en") ? "en" : "ar";
  }
  get lang(): Lang {
    return pickLang(this.cookies.lang, this.req.headers.get("accept-language"));
  }
  /** الدومين اللي يُبنى عليه redirect_uri. */
  get siteBase(): string {
    if (cfg.BASE_URL) return cfg.BASE_URL;
    return `${cfg.FORCE_HTTPS ? "https" : this.scheme}://${this.host}`;
  }
  page(): PageCtx {
    const theme = this.cookies.theme;
    return {
      lang: this.lang, user: this.user, theme: theme && THEMES.includes(theme) ? theme : "royal",
      fxOff: this.cookies.fx === "0", supportUrl: cfg.SUPPORT_URL, csrf: this.user ? this.session.csrf : undefined,
    };
  }
  finish(res: Response): Response {
    if (this.dirty) {
      const s = this.sess ?? {};
      const secure = this.scheme === "https";
      res.headers.append("Set-Cookie", Object.keys(s).length
        ? serializeCookie(SESSION_COOKIE, signSession(s, cfg.SESSION_SECRET, cfg.SESSION_MAX_AGE), { maxAge: cfg.SESSION_MAX_AGE, secure })
        : serializeCookie(SESSION_COOKIE, "", { maxAge: 0, secure }));
    }
    if (this.scheme === "https" && !res.headers.has("Strict-Transport-Security")) res.headers.set("Strict-Transport-Security", "max-age=31536000");
    res.headers.set("X-Content-Type-Options", "nosniff");
    if (!res.headers.has("X-Frame-Options")) res.headers.set("X-Frame-Options", "DENY");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return res;
  }
}

function trusted(server: Server<undefined>, req: Request): boolean {
  if (cfg.FORWARDED_ALLOW_IPS.includes("*")) return true;
  const ip = server.requestIP(req)?.address ?? "";
  return cfg.FORWARDED_ALLOW_IPS.includes(ip) || cfg.FORWARDED_ALLOW_IPS.includes(ip.replace(/^::ffff:/, ""));
}

const hostname = (host: string) => (host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0]!);

/* ====================== ردود ====================== */
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const htmlRes = (h: Html | string, status = 200) =>
  new Response(String(h), { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { Location: to, "Cache-Control": "no-store" } });

/* ====================== صلاحيات ====================== */
function userOr401(rc: Rc): SessionUser {
  const u = rc.user;
  if (!u) fail(401, "سجّل دخولك أول");
  return u;
}

/** يتحقق: مسجّل دخول + عنده إدارة السيرفر + البوت موجود فيه. يرجع سياق السيرفر. */
async function guildOr403(rc: Rc, gid: string): Promise<Ctx> {
  userOr401(rc);
  if (!/^\d{1,25}$/.test(gid) || !(rc.session.guilds ?? []).includes(gid)) fail(403, "ما عندك صلاحية على هذا السيرفر");
  const g = await getGuild(gid);
  if (!g) fail(404, "البوت مو موجود في هذا السيرفر");
  const chans = await getChannels(gid);
  return { gid, g, chans, botTop: () => botTopPosition(g) };
}

/** سيرفرات المستخدم اللي البوت موجود فيها. */
async function userGuildList(rc: Rc): Promise<{ id: string; name: string; icon: string | null }[]> {
  const bot = await botGuilds();
  return (rc.session.guilds ?? []).filter((id) => bot.has(id)).map((id) => {
    const g = bot.get(id)!;
    return { id, name: g.name, icon: g.icon };
  });
}

/** حماية CSRF لطلبات POST: نفس الأصل + رمز الجلسة في X-CSRF-Token + JSON فقط. */
function checkCsrf(rc: Rc) {
  const h = rc.req.headers;
  const origin = h.get("origin");
  if (origin) {
    const allowed = new Set([`${rc.scheme}://${rc.host}`]);
    if (cfg.BASE_URL) allowed.add(new URL(cfg.BASE_URL).origin);
    if (!allowed.has(origin.toLowerCase())) fail(403, "طلب مرفوض (CSRF)");
  } else {
    const site = h.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") fail(403, "طلب مرفوض (CSRF)");
  }
  if (!(h.get("content-type") || "").toLowerCase().includes("application/json")) fail(403, "طلب مرفوض (CSRF)");
  const want = rc.session.csrf;
  const got = h.get("x-csrf-token") || "";
  if (!want || !safeEqual(want, got)) fail(403, "طلب مرفوض (CSRF)");
}

async function body(rc: Rc): Promise<Data> {
  const len = Number(rc.req.headers.get("content-length") || 0);
  if (len > MAX_BODY) fail(400, "بيانات غير صالحة");
  const text = await rc.req.text();
  if (text.length > MAX_BODY) fail(400, "بيانات غير صالحة");
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    fail(400, "بيانات غير صالحة");
  }
  if (!d || typeof d !== "object" || Array.isArray(d) || JSON.stringify(d).length > 200_000) fail(400, "بيانات غير صالحة");
  return d as Data;
}

/* ====================== مهام البوت (بانلات) ====================== */
const UNKNOWN_JOB = "نوع مهمة غير معروف";

/** يطلب من البوت إرسال بانل القسم بعد الحفظ (طابور المهام في dashboard_jobs.db). */
async function sendSectionPanel(rc: Rc, section: string, gid: string, slot: string, data: Data): Promise<string> {
  const keys = PANEL_KEYS[section]!;
  const payload: Data = { slot };
  for (const k of keys) payload[k] = truthy(data[k]) ? String(data[k]) : null;
  if (keys.length === 1) payload.channel_id = payload[keys[0]!];
  const r = await waitJob(enqueueJob(`${section}-panel`, gid, payload));
  if (r.ok) return "sent";
  if (r.message === UNKNOWN_JOB) return "unsupported";
  return "error:" + translateError(r.message, rc.errLang);
}

/** بانل التذاكر / التقديمات (نفس تحقق _panel_args القديم) ثم مهمة للبوت. */
async function sendListPanel(rc: Rc, gid: string, kind: "ticket-panel" | "apply-panel"): Promise<Response> {
  const c = await guildOr403(rc, gid);
  const d = await body(rc);
  const cid = String(d.channel_id ?? "");
  if (!/^\d+$/.test(cid) || !isTextChannel(c.chans, cid)) fail(400, "حدد روم نصي صالح");
  const title = typeof d.title === "string" ? d.title.trim() : "";
  const desc = typeof d.desc === "string" ? d.desc.trim() : "";
  if (!title || !desc) fail(400, "اكتب عنوان ووصف البانل");
  if (plen(title) > 256 || plen(desc) > 4000) fail(400, "العنوان 256 حرف والوصف 4000 حرف كحد أقصى");
  const image = (typeof d.image === "string" ? d.image.trim() : "") || null;
  if (image && !/^https?:\/\//.test(image)) fail(400, "رابط الصورة لازم يبدأ بـ http أو https");
  const nums = (Array.isArray(d.nums) ? d.nums : []).map(String).filter((n: string) => /^\d+$/.test(n));
  if (!nums.length) fail(400, "اختر عنصر واحد على الأقل");
  const display = d.display === "buttons" ? "buttons" : "dropdown";
  const r = await waitJob(enqueueJob(kind, gid, { channel_id: cid, title, desc, image, display, nums }));
  if (!r.ok) fail(400, r.message === UNKNOWN_JOB ? "تعذر إرسال البانل، تأكد من صلاحيات البوت في الروم" : r.message);
  return json({ ok: true, message: r.message });
}

/* ====================== الايمبد (إرسال مباشر عبر REST) ====================== */
const EMB_COLORS: Record<string, number> = {
  "أزرق": 0x3498db, "أخضر": 0x2ecc71, "أحمر": 0xe74c3c, "أصفر": 0xf1c40f, "بنفسجي": 0x9b59b6, "برتقالي": 0xe67e22, "أبيض": 0xeeeff1, "أسود": 0x313338,
};
async function sendCustomEmbed(rc: Rc, c: Ctx, d: Data) {
  if (!(await isAdmin(c.g, rc.user!.id))) fail(403, "إرسال الايمبد للأدمن فقط");
  const cid = String(d.channel_id ?? "");
  if (!/^\d+$/.test(cid) || !isTextChannel(c.chans, cid)) fail(400, "REQ:channel_id");
  const title = typeof d.title === "string" ? d.title.trim() : "";
  const desc = typeof d.description === "string" ? d.description.trim() : "";
  if (!title) fail(400, "REQ:title");
  if (!desc) fail(400, "REQ:description");
  if (plen(title) > 256 || plen(desc) > 4000) fail(400, "العنوان 256 حرف والوصف 4000 حرف كحد أقصى");
  const image = typeof d.image_url === "string" ? d.image_url.trim() : "";
  if (image && !/^https?:\/\//.test(image)) fail(400, "رابط الصورة لازم يبدأ بـ http أو https");
  const outside = (typeof d.outside_text === "string" ? d.outside_text.trim() : "") || null;
  if (outside && plen(outside) > 2000) fail(400, "النص الخارجي 2000 حرف كحد أقصى");
  const embed: Data = { title, description: desc, timestamp: new Date().toISOString(), color: EMB_COLORS[d.color] ?? EMB_COLORS["أزرق"] };
  if (image) embed.image = { url: image };
  const r = await discord(`/channels/${cid}/messages`, { auth: { bot: true }, method: "POST", json: { content: outside ?? undefined, embeds: [embed] } });
  if (r.status !== 200) fail(500, "تعذر الإرسال، تأكد من صلاحيات البوت في الروم");
  const keep: Data = {};
  for (const k of ["channel_id", "color", "title", "description", "image_url", "outside_text"]) keep[k] = d[k] ?? null;
  if (!COLORS.includes(keep.color)) keep.color = "أزرق";
  saveSettings(c.gid, "embed", keep);
}

/* ====================== الإيموجيات ====================== */
function emojiList(): { emojis: Emoji[]; cats: string[]; idsReady: boolean } {
  let manifest: { name: string; file: string; category: string }[];
  try {
    manifest = JSON.parse(readFileSync(join(cfg.EMOJI_DIR, "manifest.json"), "utf8"));
  } catch {
    return { emojis: [], cats: [], idsReady: false };
  }
  let ids: Record<string, string> = {};
  try {
    ids = JSON.parse(readFileSync(join(cfg.EMOJI_DIR, "ids.json"), "utf8"));
  } catch {}
  const emojis = manifest.map((e) => ({ ...e, code: ids[e.name] ? `<:${e.name}:${ids[e.name]}>` : `:${e.name}:` }));
  return { emojis, cats: [...new Set(emojis.map((e) => e.category))], idsReady: Object.keys(ids).length > 0 };
}

/* ====================== المسارات ====================== */
type Handler = (rc: Rc, p: Record<string, string>) => Promise<Response> | Response;
const routes: [method: string, pattern: RegExp, keys: string[], h: Handler][] = [];
function route(method: string, path: string, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push([method, re, keys, h]);
}

/** الصفحات العامة للزوار ثابتة لكل (لغة، ثيم، مؤثرات) فنخزنها مرسومة بدل إعادة الرسم كل مرة. */
const publicCache = new Map<string, string>();
function publicPage(rc: Rc, name: string, render: (c: PageCtx) => Html): Response {
  const c = rc.page();
  if (c.user) return htmlRes(render(c));
  const key = `${name}|${c.lang}|${c.theme}|${c.fxOff ? 1 : 0}`;
  let h = publicCache.get(key);
  if (h === undefined) publicCache.set(key, (h = render(c).value));
  return htmlRes(h);
}
route("GET", "/", (rc) => publicPage(rc, "landing", (c) => <Landing c={c} />));
route("GET", "/team", (rc) => publicPage(rc, "team", (c) => <Team c={c} />));
route("GET", "/team.html", (rc) => publicPage(rc, "team", (c) => <Team c={c} />));
route("GET", "/healthz", () => json({ ok: true }));

const dashboardPage: Handler = async (rc) => {
  if (!rc.user) return redirect("/login");
  const guilds = await userGuildList(rc);
  const saved = rc.cookies.gid;
  const gid = guilds.some((g) => g.id === saved) ? saved! : (guilds[0]?.id ?? "");
  return htmlRes(<Dashboard c={rc.page()} guilds={guilds} gid={gid} />);
};
route("GET", "/dashboard", dashboardPage);
route("GET", "/dashboard/", dashboardPage);

route("GET", "/login", (rc) => {
  const state = token(24);
  rc.session = { ...rc.session, oauth_state: state };
  const q = new URLSearchParams({ client_id: cfg.CLIENT_ID, redirect_uri: rc.siteBase + "/callback", response_type: "code", scope: "identify guilds", state });
  return redirect(`https://discord.com/oauth2/authorize?${q}`);
});

route("GET", "/invite", () => {
  const q = new URLSearchParams({ client_id: cfg.CLIENT_ID, permissions: "8", scope: "bot applications.commands" });
  return redirect(`https://discord.com/oauth2/authorize?${q}`);
});

route("GET", "/callback", async (rc) => {
  const code = rc.url.searchParams.get("code") || "";
  const state = rc.url.searchParams.get("state") || "";
  const expected = rc.session.oauth_state;
  if (expected) {
    const { oauth_state: _drop, ...rest } = rc.session;
    rc.session = rest;
  }
  if (rc.url.searchParams.get("error") || !code) return redirect("/"); // المستخدم ألغى الدخول
  if (!expected || !safeEqual(expected, state)) fail(400, "فشل تسجيل الدخول");
  const access = await exchangeCode(code, rc.siteBase + "/callback");
  if (!access) fail(400, "فشل تسجيل الدخول");
  const info = await userInfo(access);
  if (!info) fail(400, "فشل تسجيل الدخول");
  const { user, guilds } = info;
  // السيرفرات اللي يملكها أو عنده فيها إدارة السيرفر / أدمن
  let managed = guilds.filter((g) => g.owner || (BigInt(g.permissions || "0") & 0x28n) !== 0n).map((g) => String(g.id));
  if (managed.length > MAX_SESSION_GUILDS) {
    const bot = await botGuilds().catch(() => new Map());
    managed = [...managed.filter((id) => bot.has(id)), ...managed.filter((id) => !bot.has(id))].slice(0, MAX_SESSION_GUILDS);
  }
  rc.session = {
    user: { id: String(user.id), name: user.username, global_name: user.global_name || user.username, avatar: avatarUrl(user) },
    guilds: managed,
    csrf: token(24),
  };
  return redirect("/dashboard");
});

route("GET", "/logout", (rc) => {
  rc.session = {};
  return redirect("/");
});

route("GET", "/assets/i18n.js", () => new Response(jsBundle(), { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" } }));
route("GET", "/assets/css/themes.css", () => new Response(themesCss(), { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-cache" } }));

/* ---------- API ---------- */
route("GET", "/api/me", (rc) => json(userOr401(rc)));
route("GET", "/api/guilds", async (rc) => {
  userOr401(rc);
  return json((await userGuildList(rc)).map((g) => ({ id: g.id, name: g.name, icon: guildIcon(g.id, g.icon), bot_present: true })));
});
route("GET", "/api/stats", async (rc) => {
  userOr401(rc);
  return json({ guilds: (await botGuilds()).size });
});
route("GET", "/api/guilds/:gid/meta", async (rc, p) => {
  const c = await guildOr403(rc, p.gid!);
  return json(guildMeta(c.g, c.chans));
});

route("GET", "/api/guilds/:gid/settings/:section", async (rc, p) => {
  const c = await guildOr403(rc, p.gid!);
  if (!SECTIONS.has(p.section!)) fail(404, "غير موجود");
  return json(readSection(c, p.section!, rc.url.searchParams.get("slot") ?? ""));
});

route("POST", "/api/guilds/:gid/settings/:section", async (rc, p) => {
  checkCsrf(rc);
  const c = await guildOr403(rc, p.gid!);
  const section = p.section!;
  if (!SECTIONS.has(section)) fail(404, "غير موجود");
  const slot = rc.url.searchParams.get("slot") ?? "";
  const data = await body(rc);
  if (ADMIN_ONLY.has(section) && !(await isAdmin(c.g, rc.user!.id))) fail(403, "تعديل هذا القسم للأدمن فقط");
  if (section === "embed") {
    await sendCustomEmbed(rc, c, data);
    return json({ ok: true, panel: "sent" });
  }
  await AD[section]![1](c, slot, data);
  const out: Data = { ok: true };
  const keys = PANEL_KEYS[section];
  if (keys && keys.some((k) => truthy(data[k]))) out.panel = await sendSectionPanel(rc, section, c.gid, slot, data);
  return json(out);
});

route("GET", "/api/guilds/:gid/tickets/list", async (rc, p) => json(ticketItems((await guildOr403(rc, p.gid!)).gid)));
route("GET", "/api/guilds/:gid/apply/list", async (rc, p) => json(applyItems((await guildOr403(rc, p.gid!)).gid)));
route("POST", "/api/guilds/:gid/send/ticket-panel", (rc, p) => (checkCsrf(rc), sendListPanel(rc, p.gid!, "ticket-panel")));
route("POST", "/api/guilds/:gid/send/apply-panel", (rc, p) => (checkCsrf(rc), sendListPanel(rc, p.gid!, "apply-panel")));

route("GET", "/api/rating", (rc) => json(ratingData(userOr401(rc).id)));
route("POST", "/api/rating", async (rc) => {
  checkCsrf(rc);
  const u = userOr401(rc);
  const d = await body(rc);
  ratingSave(u.id, d.stars, d.comment);
  return json(ratingData(u.id));
});

route("GET", "/api/site-info", () => json({ creator: { username: ".a.506.", avatar: "https://cdn.simpleicons.org/discord/5865F2" }, created_at: snowflakeDate(cfg.CLIENT_ID) }));

/* ---------- أقسام اللوحة كـ HTML جاهز ---------- */
route("GET", "/ui/view/:key", async (rc, p) => {
  const u = userOr401(rc);
  const pc = rc.page();
  const key = p.key!;
  const q = rc.url.searchParams;
  const gid = q.get("gid") || "";
  const L = (path: string) => t(pc.lang, path);

  if (key in UI_SECTIONS) {
    if (!gid) return htmlRes(<EmptyView c={pc} iconName="server" message={L("ui.noServers")} invite />);
    const c = await guildOr403(rc, gid);
    const s = UI_SECTIONS[key]!;
    const slotQ = q.get("slot") || "";
    const slot = s.slots ? (s.slots.includes(slotQ) ? slotQ : s.slots[0]!) : "";
    const meta = guildMeta(c.g, c.chans);
    if (s.modes && q.get("mode") === "panel") {
      const items = key === "tickets" ? ticketItems(c.gid) : applyItems(c.gid);
      return htmlRes(<PanelView c={pc} sec={key} guildName={c.g.name} meta={meta} items={items} />);
    }
    const data = readSection(c, key, slot);
    return htmlRes(<SectionView c={pc} sec={key} guildName={c.g.name} meta={meta} data={data} slot={slot} />);
  }

  switch (key) {
    case "home": {
      const [mine, bot] = await Promise.all([userGuildList(rc), botGuilds()]);
      const gname = /^\d+$/.test(gid) ? bot.get(gid)?.name ?? "" : "";
      const tiles: [string, string, string | null, number | null][] = [
        ["server", L("ui.yourServers"), null, mine.length],
        ["globe", L("ui.allServers"), null, bot.size],
        ["server", L("ui.currentServer"), gname || "—", null],
        ["code", L("ui.developer"), ".a.506.", null],
        ["calendar", L("ui.botCreated"), snowflakeDate(cfg.CLIENT_ID) ?? L("c.unknown"), null],
      ];
      return htmlRes(<HomeView c={{ ...pc, user: u }} tiles={tiles} />);
    }
    case "stats":
      return htmlRes(<StatsView c={pc} total={(await botGuilds()).size} />);
    case "themes":
      return htmlRes(<ThemesView c={pc} />);
    case "language":
      return htmlRes(<LanguageView c={pc} />);
    case "rate":
      return htmlRes(<RateView c={pc} rating={ratingData(u.id)} />);
    case "emojis": {
      const e = emojiList();
      return htmlRes(<EmojisView c={pc} emojis={e.emojis} cats={e.cats} idsReady={e.idsReady} />);
    }
  }
  fail(404, "غير موجود");
});

/* ====================== الملفات الثابتة ====================== */
const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".json": "application/json",
  ".txt": "text/plain; charset=utf-8", ".html": "text/html; charset=utf-8",
};
function staticFile(rc: Rc, root: string, rel: string, allow?: RegExp): Response | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || (allow && !allow.test(decoded))) return null;
  const base = resolve(root);
  const full = resolve(base, "." + sep + decoded);
  if (full !== base && !full.startsWith(base + sep)) return null;
  let st;
  try {
    st = statSync(full);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const lm = st.mtime.toUTCString();
  const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers = { "Content-Type": MIME[extname(full).toLowerCase()] ?? "application/octet-stream", "Last-Modified": lm, ETag: etag, "Cache-Control": "public, max-age=300" };
  if (rc.req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(rc.req.method === "HEAD" ? null : Bun.file(full), { headers });
}

function serveStatic(rc: Rc): Response | null {
  const path = rc.url.pathname;
  if (path.startsWith("/emojis/")) return staticFile(rc, cfg.EMOJI_DIR, path.slice(8), /^(svg\/)?[\w.-]+\.(png|svg)$/);
  // web/ (assets و logo…) — مثل StaticFiles(html=True) القديمة
  return staticFile(rc, cfg.WEB_DIR, path.slice(1)) ?? (path.endsWith("/") ? staticFile(rc, cfg.WEB_DIR, path.slice(1) + "index.html") : null);
}

/* ====================== الخادم ====================== */
/** تنظيف ذاكرة خفيف بعد ما تهدأ الطلبات (يحافظ على استهلاك منخفض وقت الخمول). */
let gcTimer: Timer | null = null;
function scheduleIdleGc() {
  if (gcTimer) clearTimeout(gcTimer);
  gcTimer = setTimeout(() => {
    gcTimer = null;
    Bun.gc(true);
  }, 5_000);
  gcTimer.unref();
}

async function handle(req: Request, server: Server<undefined>): Promise<Response> {
  scheduleIdleGc();
  const rc = new Rc(req, server);
  try {
    // http → https والدومين الرسمي (DASHBOARD_URL) — ما عدا localhost
    if (cfg.FORCE_HTTPS && !LOCAL_HOSTS.has(hostname(rc.host))) {
      const canon = cfg.BASE_URL ? new URL(cfg.BASE_URL).host.toLowerCase() : rc.host;
      if (rc.scheme !== "https" || rc.host !== canon) return rc.finish(redirect(`https://${canon}${rc.url.pathname}${rc.url.search}`, 308));
    }
    const method = req.method === "HEAD" ? "GET" : req.method;
    const path = rc.url.pathname;
    for (const [m, re, keys, h] of routes) {
      const mt = re.exec(path);
      if (!mt) continue;
      if (m !== method) continue;
      const params: Record<string, string> = {};
      keys.forEach((k, i) => {
        params[k] = decodeURIComponent(mt[i + 1]!);
      });
      return rc.finish(await h(rc, params));
    }
    if (method === "GET") {
      const s = serveStatic(rc);
      if (s) return rc.finish(s);
    }
    if (routes.some(([, re]) => re.test(path))) fail(405, "غير موجود");
    fail(404, "غير موجود");
  } catch (e) {
    if (e instanceof HttpError) return rc.finish(json({ detail: translateError(e.message, rc.errLang) }, e.status, e.headers));
    log.err("dashboard", e);
    return rc.finish(json({ detail: translateError("صار خطأ في السيرفر", rc.errLang) }, 500));
  }
}

const tls = cfg.SSL_CERTFILE && cfg.SSL_KEYFILE && existsSync(cfg.SSL_CERTFILE) && existsSync(cfg.SSL_KEYFILE)
  ? { cert: Bun.file(cfg.SSL_CERTFILE), key: Bun.file(cfg.SSL_KEYFILE) }
  : undefined;

const server = Bun.serve({
  port: cfg.PORT,
  hostname: cfg.HOST,
  tls,
  maxRequestBodySize: MAX_BODY * 2,
  development: false,
  fetch: handle,
  error(e) {
    log.err("dashboard", e);
    return new Response("Internal Server Error", { status: 500 });
  },
});

if (!cfg.CLIENT_SECRET) log.warn("dashboard", "DISCORD_CLIENT_SECRET is not set — dashboard login will fail");
if (!cfg.BOT_TOKEN) log.warn("dashboard", "DISCORD_TOKEN is not set — guild data will be unavailable");
setTimeout(() => Bun.gc(true), 2_000).unref();
log.ok("dashboard", `listening on ${tls ? "https" : "http"}://${cfg.HOST}:${server.port} · redirect ${cfg.BASE_URL || "<host>"}/callback`);

const stop = () => {
  server.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
