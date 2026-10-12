/**
 * عميل REST لـ Discord مبني على fetch المدمج.
 * - يحترم حدود السرعة (rate limits) لكل مسار + الحد العام
 * - يعيد المحاولة تلقائياً مع 429 و 5xx وأخطاء الشبكة
 * - يدعم رفع الملفات (multipart)
 */
import { API_BASE } from "./constants.ts";
import { log } from "../core/log.ts";

export interface FileUpload {
  name: string;
  data: Uint8Array | string;
  contentType?: string;
}

export interface RequestOptions {
  body?: unknown;
  files?: FileUpload[];
  query?: Record<string, string | number | boolean | undefined>;
  /** مسارات webhook التفاعلات ما تحتاج توكن البوت. */
  auth?: boolean;
  /** سبب يظهر في سجل التدقيق. */
  reason?: string;
  /** يتجاوز طابور المسار (ردود التفاعلات المستعجلة). */
  direct?: boolean;
  retries?: number;
}

export class DiscordAPIError extends Error {
  readonly status: number;
  readonly code: number;
  constructor(status: number, raw: unknown, readonly method: string, readonly path: string) {
    const r = (raw ?? {}) as { message?: string; code?: number };
    super(`Discord ${status} ${method} ${path}: ${r.message ?? "Unknown error"} (code ${r.code ?? 0})`);
    this.name = "DiscordAPIError";
    this.status = status;
    this.code = r.code ?? 0;
  }
}

interface Bucket {
  remaining: number;
  resetAt: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** يحوّل المسار لمفتاح bucket: نخلي المعرفات الأساسية (channel/guild/webhook) ونعمم الباقي. */
export function routeKey(method: string, path: string): string {
  const p = path
    .replace(/\/interactions\/\d+\/[^/]+/, "/interactions/:id/:token")
    .replace(/\/(?!channels\/|guilds\/|webhooks\/)([a-z-]+)\/\d{15,21}/g, "/$1/:id")
    .replace(/\/reactions\/[^/]+/, "/reactions/:emoji");
  return `${method} ${p}`;
}

export class REST {
  private readonly routeToBucket = new Map<string, string>();
  private readonly buckets = new Map<string, Bucket>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private globalResetAt = 0;

  constructor(private readonly token: string, private readonly maxRetries = 4, private readonly timeoutMs = 20_000) {}

  get<T = any>(path: string, o?: RequestOptions) { return this.request<T>("GET", path, o); }
  post<T = any>(path: string, o?: RequestOptions) { return this.request<T>("POST", path, o); }
  patch<T = any>(path: string, o?: RequestOptions) { return this.request<T>("PATCH", path, o); }
  put<T = any>(path: string, o?: RequestOptions) { return this.request<T>("PUT", path, o); }
  delete<T = any>(path: string, o?: RequestOptions) { return this.request<T>("DELETE", path, o); }

  /** الطلبات على نفس المسار تمشي بالدور عشان ما نكسر حدود السرعة. */
  request<T = any>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const key = routeKey(method, path);
    if (opts.direct) return this.execute<T>(method, path, key, opts);
    const prev = this.queues.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(() => this.execute<T>(method, path, key, opts));
    const tail = run.catch(() => undefined);
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return run;
  }

  private async waitForLimits(key: string): Promise<void> {
    const now = Date.now();
    if (this.globalResetAt > now) await sleep(this.globalResetAt - now);
    const id = this.routeToBucket.get(key);
    const b = id ? this.buckets.get(id) : undefined;
    if (b && b.remaining <= 0 && b.resetAt > Date.now()) await sleep(b.resetAt - Date.now());
  }

  private updateBucket(key: string, res: Response): void {
    const bucket = res.headers.get("x-ratelimit-bucket");
    const remaining = res.headers.get("x-ratelimit-remaining");
    const resetAfter = res.headers.get("x-ratelimit-reset-after");
    if (!bucket || remaining === null || resetAfter === null) return;
    if (this.buckets.size > 2000) this.buckets.clear(); // ما نخلي الخريطة تكبر بلا حد
    if (this.routeToBucket.size > 2000) this.routeToBucket.clear();
    this.routeToBucket.set(key, bucket);
    this.buckets.set(bucket, { remaining: Number(remaining), resetAt: Date.now() + Number(resetAfter) * 1000 + 50 });
  }

  private buildBody(opts: RequestOptions): { body?: BodyInit; headers: Record<string, string> } {
    const headers: Record<string, string> = {};
    if (opts.files?.length) {
      const form = new FormData();
      const payload = { ...((opts.body as object) ?? {}) } as Record<string, unknown>;
      payload.attachments = opts.files.map((f, id) => ({ id, filename: f.name }));
      form.append("payload_json", JSON.stringify(payload));
      opts.files.forEach((f, i) => {
        const blob = new Blob([typeof f.data === "string" ? f.data : new Uint8Array(f.data)], {
          type: f.contentType ?? "application/octet-stream",
        });
        form.append(`files[${i}]`, blob, f.name);
      });
      return { body: form, headers };
    }
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      return { body: JSON.stringify(opts.body), headers };
    }
    return { headers };
  }

  private async execute<T>(method: string, path: string, key: string, opts: RequestOptions): Promise<T> {
    let url = API_BASE + path;
    if (opts.query) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) if (v !== undefined) q.set(k, String(v));
      const s = q.toString();
      if (s) url += `?${s}`;
    }
    const maxRetries = opts.retries ?? this.maxRetries;
    for (let attempt = 0; ; attempt++) {
      await this.waitForLimits(key);
      const { body, headers } = this.buildBody(opts);
      headers["user-agent"] = "DiscordBot (https://github.com/revive, 3.0) Revive";
      if (opts.auth !== false) headers.authorization = `Bot ${this.token}`;
      if (opts.reason) headers["x-audit-log-reason"] = encodeURIComponent(opts.reason.slice(0, 400));

      let res: Response;
      try {
        res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        const wait = Math.min(1000 * 2 ** attempt, 15_000);
        log.warn("rest", `network error on ${method} ${path}, retry in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      this.updateBucket(key, res);

      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { retry_after?: number; global?: boolean };
        const retryAfter = Math.ceil((data.retry_after ?? Number(res.headers.get("retry-after") ?? 1)) * 1000) + 100;
        if (data.global || res.headers.get("x-ratelimit-global")) this.globalResetAt = Date.now() + retryAfter;
        if (attempt >= maxRetries) throw new DiscordAPIError(429, data, method, path);
        log.debug("rest", `rate limited on ${key}, waiting ${retryAfter}ms`);
        await sleep(retryAfter);
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        await sleep(Math.min(1000 * 2 ** attempt, 15_000));
        continue;
      }
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      const data = text ? safeJson(text) : undefined;
      if (!res.ok) throw new DiscordAPIError(res.status, data, method, path);
      return data as T;
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
