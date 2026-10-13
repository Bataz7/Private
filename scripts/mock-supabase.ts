/**
 * محاكي Supabase (PostgREST) في الذاكرة — للاختبار وقياس الذاكرة بدون قاعدة بيانات حقيقية.
 * يدعم: select/insert/update/upsert/delete، الفلاتر (eq neq gt gte lt lte in is like ilike cs or)، order، limit/offset،
 * single، count (head)، وبعض دوال rpc اللي يستخدمها البوت.
 */
type Row = Record<string, any>;
const tables = new Map<string, Row[]>();
let seq = 1000;

export const db = {
  table(name: string) {
    let t = tables.get(name);
    if (!t) {
      t = [];
      tables.set(name, t);
    }
    return t;
  },
  seed(name: string, rows: Row[]) {
    db.table(name).push(...rows);
  },
  stats() {
    return Object.fromEntries([...tables].map(([k, v]) => [k, v.length]));
  },
};

const parseVal = (v: string): any => (v === "null" ? null : v === "true" ? true : v === "false" ? false : v);
const cmp = (a: any, b: any) => {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== "" && String(b).trim() !== "") return na - nb;
  const da = Date.parse(a);
  const dbb = Date.parse(b);
  if (!Number.isNaN(da) && !Number.isNaN(dbb) && /\d{4}-\d\d-\d\d/.test(String(a))) return da - dbb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};
const splitList = (s: string) => s.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));

function test(row: Row, col: string, expr: string): boolean {
  let neg = false;
  if (expr.startsWith("not.")) {
    neg = true;
    expr = expr.slice(4);
  }
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const raw = expr.slice(dot + 1);
  const v = row[col];
  let r: boolean;
  switch (op) {
    case "eq": r = cmp(v, parseVal(raw)) === 0 && v !== null && v !== undefined || (raw === "null" && v == null); break;
    case "neq": r = cmp(v, parseVal(raw)) !== 0; break;
    case "gt": r = cmp(v, raw) > 0; break;
    case "gte": r = cmp(v, raw) >= 0; break;
    case "lt": r = cmp(v, raw) < 0; break;
    case "lte": r = cmp(v, raw) <= 0; break;
    case "is": r = raw === "null" ? v === null || v === undefined : String(!!v) === raw; break;
    case "in": r = splitList(raw).some((x) => cmp(v, x) === 0); break;
    case "like": r = new RegExp(`^${raw.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`).test(String(v ?? "")); break;
    case "ilike": r = new RegExp(`^${raw.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i").test(String(v ?? "")); break;
    case "cs": {
      if (raw.startsWith("{")) r = splitList(raw.slice(1, -1)).every((x) => Array.isArray(v) && v.map(String).includes(x));
      else {
        try {
          const want = JSON.parse(raw);
          r = JSON.stringify(v ?? null).includes(JSON.stringify(want).slice(1, -1));
        } catch {
          r = false;
        }
      }
      break;
    }
    default: r = true;
  }
  return neg ? !r : r;
}

function orMatch(row: Row, expr: string): boolean {
  const inner = expr.replace(/^\(|\)$/g, "");
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.some((p) => {
    const dot = p.indexOf(".");
    return test(row, p.slice(0, dot), p.slice(dot + 1));
  });
}

function filterRows(rows: Row[], params: URLSearchParams) {
  const reserved = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
  return rows.filter((row) => {
    for (const [k, v] of params) {
      if (reserved.has(k)) continue;
      if (k === "or") {
        if (!orMatch(row, v)) return false;
        continue;
      }
      if (!test(row, k, v)) return false;
    }
    return true;
  });
}

function pick(row: Row, select: string | null) {
  if (!select || select === "*" || select.includes("*")) return { ...row };
  const out: Row = {};
  for (const c of select.split(",")) {
    const name = c.split(":").pop()!.trim();
    if (!name.includes("(")) out[name] = row[name] ?? null;
  }
  return out;
}

const now = () => new Date().toISOString();
function withDefaults(table: string, r: Row): Row {
  const row: Row = { ...r };
  if (row.id === undefined && table !== "guild_settings") row.id = ++seq;
  row.created_at ??= now();
  if (table === "shifts") {
    row.status ??= "active";
    row.breaks ??= [];
    row.last_activity_at ??= now();
  }
  if (table === "staff") {
    row.active ??= true;
    row.points ??= 0;
    row.message_count ??= 0;
    row.voice_minutes ??= 0;
    row.claimed ??= 0;
  }
  return row;
}

function rpc(name: string, args: Row): any {
  if (name === "change_staff_points") {
    const staff = db.table("staff").find((s) => s.guild_id === args.p_guild && s.user_id === args.p_user);
    if (!staff) return null;
    const before = Number(staff.points) || 0;
    staff.points = Math.max(0, before + Number(args.p_delta || 0));
    staff.claimed = (Number(staff.claimed) || 0) + Number(args.p_claimed || 0);
    db.table("points_ledger").push({ id: ++seq, guild_id: args.p_guild, user_id: args.p_user, delta: args.p_delta, source: args.p_source, reason: args.p_reason, created_at: now() });
    return { before, after: staff.points };
  }
  if (name === "staff_points_breakdown") return {};
  if (name === "weekly_points" && process.env.MOCK_MISSING_COLUMNS) return { __missing: true };
  if (name === "weekly_points") {
    const sums = new Map<string, number>();
    for (const r of db.table("points_ledger")) if (r.guild_id === args.p_guild && r.created_at >= args.p_since && (!args.p_until || r.created_at < args.p_until)) sums.set(r.user_id, (sums.get(r.user_id) ?? 0) + Number(r.delta || 0));
    return [...sums].map(([user_id, points]) => ({ user_id, points })).sort((a, b) => b.points - a.points);
  }
  return [];
}

/** يعالج طلبات /rest/v1/* — يرجع Response أو null لو المسار مو له. */
export async function handleSupabase(req: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/rest/v1/")) return null;
  const path = decodeURIComponent(url.pathname.slice("/rest/v1/".length));
  const prefer = req.headers.get("prefer") ?? "";
  const single = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object");
  if (path.startsWith("rpc/")) {
    const args = req.method === "GET" ? Object.fromEntries(url.searchParams) : await req.json().catch(() => ({}));
    const out = rpc(path.slice(4), args);
    if (out && out.__missing) return Response.json({ code: "PGRST202", message: "Could not find the function public.weekly_points in the schema cache", details: null, hint: null }, { status: 404 });
    return Response.json(out);
  }
  const table = db.table(path);
  const params = url.searchParams;
  const select = params.get("select");
  // MOCK_MISSING_COLUMNS=a,b: يتصرف كأن ملف التحديث ما انطبق (PGRST204 عند الكتابة، 42703 عند القراءة/الفلترة).
  const missing = (process.env.MOCK_MISSING_COLUMNS ?? "").split(",").filter(Boolean);
  if (missing.length) {
    const named = [...url.searchParams.keys(), ...(url.searchParams.get("select") ?? "").split(","), ...(url.searchParams.get("order") ?? "").split(",").map((o) => o.split(".")[0]!)];
    const hitRead = missing.find((c) => named.includes(c));
    if (hitRead) return Response.json({ code: "42703", message: `column ${path}.${hitRead} does not exist`, details: null, hint: null }, { status: 400 });
    if (req.method === "POST" || req.method === "PATCH") {
      const peek = await req.clone().json().catch(() => null);
      const keys = (Array.isArray(peek) ? peek : [peek]).flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : []));
      const hit = missing.find((c) => keys.includes(c));
      if (hit) return Response.json({ code: "PGRST204", message: `Could not find the '${hit}' column of '${path}' in the schema cache`, details: null, hint: null }, { status: 400 });
    }
  }
  const ret = (rows: Row[], status = 200) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (prefer.includes("count=")) headers["content-range"] = `0-${Math.max(0, rows.length - 1)}/${rows.length}`;
    if (req.method === "HEAD") return new Response(null, { status, headers });
    if (single) {
      if (rows.length !== 1) return Response.json({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null }, { status: 406 });
      return new Response(JSON.stringify(pick(rows[0]!, select)), { status, headers });
    }
    return new Response(JSON.stringify(rows.map((r) => pick(r, select))), { status, headers });
  };
  if (req.method === "GET" || req.method === "HEAD") {
    let rows = filterRows(table, params);
    const total = rows.length;
    const order = params.get("order");
    if (order) {
      const keys = order.split(",").map((o) => o.split("."));
      rows = [...rows].sort((a, b) => {
        for (const [col, dir] of keys) {
          const c = cmp(a[col!], b[col!]);
          if (c) return dir === "desc" ? -c : c;
        }
        return 0;
      });
    }
    const offset = Number(params.get("offset") ?? 0);
    const limit = params.get("limit");
    rows = rows.slice(offset, limit ? offset + Number(limit) : undefined);
    const res = ret(rows);
    if (prefer.includes("count=")) res.headers.set("content-range", `${offset}-${offset + rows.length - 1}/${total}`);
    return res;
  }
  const body = req.method === "DELETE" ? null : await req.json().catch(() => null);
  const returning = prefer.includes("return=representation");
  if (req.method === "POST") {
    const items: Row[] = Array.isArray(body) ? body : [body];
    const out: Row[] = [];
    const conflict = params.get("on_conflict")?.split(",") ?? (path === "guild_settings" ? ["guild_id"] : null);
    const upsert = prefer.includes("resolution=");
    for (const item of items) {
      const existing = upsert && conflict ? table.find((r) => conflict.every((c) => String(r[c]) === String(item[c]))) : undefined;
      if (existing) {
        if (!prefer.includes("ignore-duplicates")) Object.assign(existing, item, { updated_at: now() });
        out.push(existing);
      } else {
        const row = withDefaults(path, item);
        table.push(row);
        out.push(row);
      }
    }
    return returning ? ret(out, 201) : new Response(null, { status: 201 });
  }
  if (req.method === "PATCH") {
    const rows = filterRows(table, params);
    for (const r of rows) Object.assign(r, body, { updated_at: now() });
    return returning ? ret(rows) : new Response(null, { status: 204 });
  }
  if (req.method === "DELETE") {
    const rows = filterRows(table, params);
    const set = new Set(rows);
    tables.set(path, table.filter((r) => !set.has(r)));
    return returning ? ret(rows) : new Response(null, { status: 204 });
  }
  return Response.json({ message: "method not supported" }, { status: 405 });
}
