/**
 * عميل REST لـ Discord مبني على fetch المدمج في Node.
 * - يحترم حدود السرعة (rate limits) لكل مسار + الحد العام
 * - يعيد المحاولة تلقائياً مع 429 و 5xx وأخطاء الشبكة
 * - يدعم رفع الملفات (multipart)
 */
import { API_BASE } from "./constants.ts";
import { silentLogger, type Logger } from "../log.ts";

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
  reason?: string;
}

export class DiscordAPIError extends Error {
  readonly status: number;
  readonly code: number;
  readonly method: string;
  readonly path: string;
  readonly raw: unknown;

  constructor(status: number, raw: unknown, method: string, path: string) {
    const r = (raw ?? {}) as { message?: string; code?: number };
    super(`Discord ${status} ${method} ${path}: ${r.message ?? "Unknown error"} (code ${r.code ?? 0})`);
    this.name = "DiscordAPIError";
    this.status = status;
    this.code = r.code ?? 0;
    this.method = method;
    this.path = path;
    this.raw = raw;
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface Bucket {
  remaining: number;
  resetAt: number;
}

export interface RESTOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  logger?: Logger;
  maxRetries?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** يحوّل المسار لمفتاح bucket: نخلي المعرفات الأساسية (channel/guild/webhook) ونعمم الباقي. */
export function routeKey(method: string, path: string): string {
  const p = path
    .replace(/\/interactions\/\d+\/[^/]+/, "/interactions/:id/:token")
    .replace(/\/webhooks\/(\d+)\/[^/?]+/, "/webhooks/$1/:token")
    .replace(/\/(?!channels\/|guilds\/|webhooks\/)([a-z-]+)\/\d{15,21}/g, "/$1/:id")
    .replace(/\/reactions\/[^/]+/, "/reactions/:emoji");
  return `${method} ${p}`;
}

export class REST {
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly log: Logger;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  private readonly routeToBucket = new Map<string, string>();
  private readonly buckets = new Map<string, Bucket>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private globalResetAt = 0;

  constructor(token: string, opts: RESTOptions = {}) {
    this.token = token;
    this.fetchImpl = opts.fetch ?? ((i, init) => fetch(i, init));
    this.baseUrl = opts.baseUrl ?? API_BASE;
    this.log = opts.logger ?? silentLogger;
    this.maxRetries = opts.maxRetries ?? 5;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  get<T = unknown>(path: string, o?: RequestOptions) { return this.request<T>("GET", path, o); }
  post<T = unknown>(path: string, o?: RequestOptions) { return this.request<T>("POST", path, o); }
  patch<T = unknown>(path: string, o?: RequestOptions) { return this.request<T>("PATCH", path, o); }
  put<T = unknown>(path: string, o?: RequestOptions) { return this.request<T>("PUT", path, o); }
  delete<T = unknown>(path: string, o?: RequestOptions) { return this.request<T>("DELETE", path, o); }

  /** الطلبات على نفس المسار تمشي بالدور عشان ما نكسر حدود السرعة. */
  request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const key = routeKey(method, path);
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
    if (this.globalResetAt > now) await this.sleep(this.globalResetAt - now);
    const bucketId = this.routeToBucket.get(key);
    const b = bucketId ? this.buckets.get(bucketId) : undefined;
    if (b && b.remaining <= 0 && b.resetAt > Date.now()) {
      const wait = b.resetAt - Date.now();
      this.log.debug(`bucket ${key} exhausted, waiting ${wait}ms`);
      await this.sleep(wait);
    }
  }

  private updateBucket(key: string, res: Response): void {
    const bucket = res.headers.get("x-ratelimit-bucket");
    const remaining = res.headers.get("x-ratelimit-remaining");
    const resetAfter = res.headers.get("x-ratelimit-reset-after");
    if (!bucket || remaining === null || resetAfter === null) return;
    this.routeToBucket.set(key, bucket);
    this.buckets.set(bucket, {
      remaining: Number(remaining),
      resetAt: Date.now() + Number(resetAfter) * 1000 + 50,
    });
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
    let url = this.baseUrl + path;
    if (opts.query) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) if (v !== undefined) q.set(k, String(v));
      const s = q.toString();
      if (s) url += `?${s}`;
    }

    for (let attempt = 0; ; attempt++) {
      await this.waitForLimits(key);
      const { body, headers } = this.buildBody(opts);
      headers["user-agent"] = "DiscordBot (https://github.com/mood-bot, 2.0) MoodBot";
      if (opts.auth !== false) headers.authorization = `Bot ${this.token}`;
      if (opts.reason) headers["x-audit-log-reason"] = encodeURIComponent(opts.reason);

      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        if (attempt >= this.maxRetries) throw err;
        const wait = Math.min(1000 * 2 ** attempt, 15_000);
        const cause = (err as { cause?: { code?: string } }).cause?.code;
        this.log.warn(`network error on ${method} ${path}${cause ? ` (${cause})` : ""}, retry in ${wait}ms:`, (err as Error).message);
        await this.sleep(wait);
        continue;
      }

      this.updateBucket(key, res);

      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { retry_after?: number; global?: boolean };
        const retryAfter = Math.ceil((data.retry_after ?? Number(res.headers.get("retry-after") ?? 1)) * 1000) + 100;
        if (data.global || res.headers.get("x-ratelimit-global")) this.globalResetAt = Date.now() + retryAfter;
        this.log.warn(`rate limited on ${key} (${data.global ? "global" : "route"}), waiting ${retryAfter}ms`);
        if (attempt >= this.maxRetries) throw new DiscordAPIError(429, data, method, path);
        await this.sleep(retryAfter);
        continue;
      }

      if (res.status >= 500 && attempt < this.maxRetries) {
        const wait = Math.min(1000 * 2 ** attempt, 15_000);
        this.log.warn(`Discord ${res.status} on ${method} ${path}, retry in ${wait}ms`);
        await this.sleep(wait);
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
