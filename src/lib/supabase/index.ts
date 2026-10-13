/**
 * supabase-lite — بديل خفيف لـ @supabase/supabase-js (قاعدة البيانات فقط: PostgREST + rpc) بدون مكتبات.
 * نفس الواجهة: supabase.from('t').select('*').eq('a', 1).order('x', { ascending: false }).limit(5) → { data, error, count }
 */

export interface PostgrestError {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
}
export interface PostgrestResponse<T = any> {
  data: T;
  error: PostgrestError | null;
  count: number | null;
  status: number;
  statusText: string;
}

type Method = "GET" | "HEAD" | "POST" | "PATCH" | "DELETE";
type CountOption = "exact" | "planned" | "estimated";

const cleanValue = (v: unknown) => {
  if (v === null) return "null";
  if (v instanceof Date) return v.toISOString();
  return String(v);
};
const listValue = (values: unknown[]) =>
  values.map((v) => {
    const s = cleanValue(v);
    return typeof v === "string" && /[,()"\\]/.test(s) ? `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : s;
  }).join(",");

export class PostgrestBuilder<T = any> implements PromiseLike<PostgrestResponse<T>> {
  protected method: Method = "GET";
  protected params: [string, string][] = [];
  protected headers: Record<string, string> = {};
  protected body: unknown = undefined;
  protected singleMode: "single" | "maybe" | null = null;
  protected prefer: string[] = [];
  protected signal?: AbortSignal;

  constructor(protected readonly client: SupabaseClient, protected readonly path: string) {}

  // ─────────── الفلاتر ───────────
  protected f(column: string, op: string, value: string) {
    this.params.push([column, `${op}.${value}`]);
    return this;
  }
  eq(column: string, value: unknown) { return this.f(column, "eq", cleanValue(value)); }
  neq(column: string, value: unknown) { return this.f(column, "neq", cleanValue(value)); }
  gt(column: string, value: unknown) { return this.f(column, "gt", cleanValue(value)); }
  gte(column: string, value: unknown) { return this.f(column, "gte", cleanValue(value)); }
  lt(column: string, value: unknown) { return this.f(column, "lt", cleanValue(value)); }
  lte(column: string, value: unknown) { return this.f(column, "lte", cleanValue(value)); }
  like(column: string, pattern: string) { return this.f(column, "like", pattern); }
  ilike(column: string, pattern: string) { return this.f(column, "ilike", pattern); }
  likeAnyOf(column: string, patterns: string[]) { return this.f(column, "like(any)", `{${patterns.join(",")}}`); }
  ilikeAnyOf(column: string, patterns: string[]) { return this.f(column, "ilike(any)", `{${patterns.join(",")}}`); }
  is(column: string, value: null | boolean) { return this.f(column, "is", String(value)); }
  in(column: string, values: readonly unknown[]) { return this.f(column, "in", `(${listValue([...values])})`); }
  contains(column: string, value: unknown) {
    if (Array.isArray(value)) return this.f(column, "cs", `{${listValue(value)}}`);
    if (value && typeof value === "object") return this.f(column, "cs", JSON.stringify(value));
    return this.f(column, "cs", String(value));
  }
  containedBy(column: string, value: unknown) {
    if (Array.isArray(value)) return this.f(column, "cd", `{${listValue(value)}}`);
    if (value && typeof value === "object") return this.f(column, "cd", JSON.stringify(value));
    return this.f(column, "cd", String(value));
  }
  overlaps(column: string, value: unknown[]) { return this.f(column, "ov", `{${listValue(value)}}`); }
  textSearch(column: string, query: string, o: { type?: "plain" | "phrase" | "websearch"; config?: string } = {}) {
    const op = o.type === "plain" ? "plfts" : o.type === "phrase" ? "phfts" : o.type === "websearch" ? "wfts" : "fts";
    return this.f(column, `${op}${o.config ? `(${o.config})` : ""}`, query);
  }
  not(column: string, operator: string, value: unknown) {
    const v = operator === "in" && Array.isArray(value) ? `(${listValue(value)})` : cleanValue(value);
    return this.f(column, `not.${operator}`, v);
  }
  or(filters: string, o: { foreignTable?: string; referencedTable?: string } = {}) {
    const key = o.referencedTable ?? o.foreignTable;
    this.params.push([key ? `${key}.or` : "or", `(${filters})`]);
    return this;
  }
  match(query: Record<string, unknown>) {
    for (const [k, v] of Object.entries(query)) this.eq(k, v);
    return this;
  }
  filter(column: string, operator: string, value: unknown) { return this.f(column, operator, cleanValue(value)); }

  // ─────────── المعدّلات ───────────
  order(column: string, o: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string; referencedTable?: string } = {}) {
    const key = o.referencedTable ?? o.foreignTable;
    const name = key ? `${key}.order` : "order";
    const value = `${column}.${o.ascending === false ? "desc" : "asc"}${o.nullsFirst === undefined ? "" : o.nullsFirst ? ".nullsfirst" : ".nullslast"}`;
    const existing = this.params.find(([k]) => k === name);
    if (existing) existing[1] = `${existing[1]},${value}`;
    else this.params.push([name, value]);
    return this;
  }
  limit(count: number, o: { foreignTable?: string; referencedTable?: string } = {}) {
    const key = o.referencedTable ?? o.foreignTable;
    this.params = this.params.filter(([k]) => k !== (key ? `${key}.limit` : "limit"));
    this.params.push([key ? `${key}.limit` : "limit", String(count)]);
    return this;
  }
  range(from: number, to: number, o: { foreignTable?: string; referencedTable?: string } = {}) {
    const key = o.referencedTable ?? o.foreignTable;
    this.params = this.params.filter(([k]) => k !== (key ? `${key}.offset` : "offset") && k !== (key ? `${key}.limit` : "limit"));
    this.params.push([key ? `${key}.offset` : "offset", String(from)], [key ? `${key}.limit` : "limit", String(to - from + 1)]);
    return this;
  }
  single() {
    this.singleMode = "single";
    return this as unknown as PostgrestBuilder<any>;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this as unknown as PostgrestBuilder<any>;
  }
  abortSignal(signal: AbortSignal) {
    this.signal = signal;
    return this;
  }
  /** بعد insert/update/upsert/delete: رجّع الصفوف. */
  select(columns = "*", o: { count?: CountOption; head?: boolean } = {}) {
    this.params = this.params.filter(([k]) => k !== "select");
    this.params.unshift(["select", columns.replace(/\s+(?=([^"]*"[^"]*")*[^"]*$)/g, "")]);
    if (this.method !== "GET" && this.method !== "HEAD") this.prefer.push("return=representation");
    if (o.count) this.prefer.push(`count=${o.count}`);
    if (o.head) this.method = "HEAD";
    return this;
  }
  returns<U>() {
    return this as unknown as PostgrestBuilder<U>;
  }

  // ─────────── التنفيذ ───────────
  then<A = PostgrestResponse<T>, B = never>(ok?: ((v: PostgrestResponse<T>) => A | PromiseLike<A>) | null, bad?: ((e: any) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.execute().then(ok, bad);
  }
  catch<B = never>(bad?: ((e: any) => B | PromiseLike<B>) | null) {
    return this.execute().catch(bad);
  }

  protected async execute(): Promise<PostgrestResponse<T>> {
    const qs = new URLSearchParams(this.params).toString();
    const url = `${this.client.restUrl}/${this.path}${qs ? `?${qs}` : ""}`;
    const headers: Record<string, string> = { ...this.client.headers, ...this.headers };
    if (this.body !== undefined) headers["content-type"] = "application/json";
    if (this.prefer.length) headers.Prefer = [...new Set(this.prefer)].join(",");
    if (this.singleMode === "single" && this.method === "GET") headers.Accept = "application/vnd.pgrst.object+json";
    let res: Response;
    try {
      res = await this.client.fetch(url, {
        method: this.method,
        headers,
        body: this.body === undefined ? undefined : JSON.stringify(this.body),
        signal: this.signal ?? AbortSignal.timeout(this.client.timeoutMs),
      });
    } catch (e) {
      return { data: null as T, error: { message: `FetchError: ${(e as Error).message}`, code: "", details: null, hint: null }, count: null, status: 0, statusText: "" };
    }
    let count: number | null = null;
    const range = res.headers.get("content-range");
    if (range) {
      const total = range.split("/")[1];
      if (total && total !== "*") count = Number(total);
    }
    const text = this.method === "HEAD" ? "" : await res.text();
    if (!res.ok) {
      let err: PostgrestError = { message: text || res.statusText, code: String(res.status), details: null, hint: null };
      try {
        const j = JSON.parse(text);
        err = { message: j.message ?? text, code: j.code ?? String(res.status), details: j.details ?? null, hint: j.hint ?? null };
      } catch {}
      // maybeSingle مع 0 صفوف = null بدون خطأ
      if (this.singleMode === "maybe" && err.code === "PGRST116") return { data: null as T, error: null, count, status: 200, statusText: "OK" };
      return { data: null as T, error: err, count, status: res.status, statusText: res.statusText };
    }
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (this.singleMode && Array.isArray(data)) {
      if (data.length > 1) {
        return { data: null as T, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116", details: `The result contains ${data.length} rows`, hint: null }, count, status: 406, statusText: "Not Acceptable" };
      }
      if (!data.length) {
        if (this.singleMode === "maybe") data = null;
        else return { data: null as T, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116", details: "The result contains 0 rows", hint: null }, count, status: 406, statusText: "Not Acceptable" };
      } else data = data[0];
    }
    if (this.method === "HEAD") data = null;
    return { data: data as T, error: null, count, status: res.status, statusText: res.statusText };
  }
}

export class QueryBuilder {
  constructor(private readonly client: SupabaseClient, private readonly table: string) {}
  private b(method: Method, body?: unknown) {
    const q = new PostgrestBuilder<any[]>(this.client, encodeURIComponent(this.table));
    (q as any).method = method;
    (q as any).body = body;
    return q;
  }
  select(columns = "*", o: { count?: CountOption; head?: boolean } = {}) {
    return this.b(o.head ? "HEAD" : "GET").select(columns, o);
  }
  insert(values: unknown, o: { count?: CountOption; defaultToNull?: boolean } = {}) {
    const q = this.b("POST", values);
    if (o.count) (q as any).prefer.push(`count=${o.count}`);
    if (o.defaultToNull === false) (q as any).prefer.push("missing=default");
    if (Array.isArray(values) && values.length > 1) {
      const cols = [...new Set(values.flatMap((v) => Object.keys(v as object)))];
      (q as any).params.push(["columns", cols.map((c) => `"${c}"`).join(",")]);
    }
    return q;
  }
  upsert(values: unknown, o: { onConflict?: string; ignoreDuplicates?: boolean; count?: CountOption; defaultToNull?: boolean } = {}) {
    const q = this.b("POST", values);
    (q as any).prefer.push(`resolution=${o.ignoreDuplicates ? "ignore" : "merge"}-duplicates`);
    if (o.onConflict) (q as any).params.push(["on_conflict", o.onConflict]);
    if (o.count) (q as any).prefer.push(`count=${o.count}`);
    if (o.defaultToNull === false) (q as any).prefer.push("missing=default");
    return q;
  }
  update(values: unknown, o: { count?: CountOption } = {}) {
    const q = this.b("PATCH", values);
    if (o.count) (q as any).prefer.push(`count=${o.count}`);
    return q;
  }
  delete(o: { count?: CountOption } = {}) {
    const q = this.b("DELETE");
    if (o.count) (q as any).prefer.push(`count=${o.count}`);
    return q;
  }
}

export interface SupabaseClientOptions {
  global?: { headers?: Record<string, string>; fetch?: typeof fetch };
  auth?: unknown;
  db?: { schema?: string };
}

export class SupabaseClient {
  readonly restUrl: string;
  readonly headers: Record<string, string>;
  readonly fetch: typeof fetch;
  timeoutMs = 20_000;
  constructor(readonly supabaseUrl: string, readonly supabaseKey: string, o: SupabaseClientOptions = {}) {
    this.restUrl = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1`;
    this.headers = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "X-Client-Info": "rift-supabase-lite/1.0",
      ...(o.db?.schema ? { "Accept-Profile": o.db.schema, "Content-Profile": o.db.schema } : {}),
      ...(o.global?.headers ?? {}),
    };
    this.fetch = (o.global?.fetch ?? ((u: any, i: any) => fetch(u, i))) as typeof fetch;
  }
  from(table: string) {
    return new QueryBuilder(this, table);
  }
  /** استدعاء دالة SQL (rpc). */
  rpc(fn: string, args: Record<string, unknown> = {}, o: { head?: boolean; get?: boolean; count?: CountOption } = {}) {
    const q = new PostgrestBuilder<any>(this, `rpc/${encodeURIComponent(fn)}`);
    if (o.get || o.head) {
      (q as any).method = o.head ? "HEAD" : "GET";
      for (const [k, v] of Object.entries(args)) (q as any).params.push([k, cleanValue(v)]);
    } else {
      (q as any).method = "POST";
      (q as any).body = args;
    }
    if (o.count) (q as any).prefer.push(`count=${o.count}`);
    return q;
  }
}

export function createClient(url: string, key: string, o: SupabaseClientOptions = {}) {
  return new SupabaseClient(url, key, o);
}
export type { SupabaseClient as Client };
