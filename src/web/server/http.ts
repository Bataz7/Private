// أدوات HTTP صغيرة فوق Request/Response القياسية (Bun.serve): السياق، الردود، الكوكيز، قراءة الجسم بحد أقصى.

export type Params = Record<string, string>;

/** خطأ يوصل للمستخدم كما هو (رسالة عربية + كود HTTP). أي خطأ ثاني يتحول لرسالة عامة. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'HttpError';
  }
}

export const MB = 1024 * 1024;

export function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (!name || out.has(name)) continue;
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try { out.set(name, decodeURIComponent(value)); } catch { out.set(name, value); }
  }
  return out;
}

export type CookieOptions = { maxAge?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Lax' | 'Strict' | 'None'; path?: string };

export function serializeCookie(name: string, value: string, options: CookieOptions = {}) {
  let out = `${name}=${encodeURIComponent(value)}; Path=${options.path ?? '/'}`;
  if (options.maxAge !== undefined) out += `; Max-Age=${Math.max(0, Math.floor(options.maxAge))}`;
  if (options.httpOnly !== false) out += '; HttpOnly';
  out += `; SameSite=${options.sameSite ?? 'Lax'}`;
  if (options.secure) out += '; Secure';
  return out;
}

/** يقرأ الجسم كنص مع حد أقصى للحجم (حتى لو ما فيه Content-Length). */
export async function readBodyText(req: Request, limit: number): Promise<string> {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > limit) throw new HttpError(413, 'حجم الطلب أكبر من المسموح.');
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, 'حجم الطلب أكبر من المسموح.');
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(buffer);
}

const isJsonType = (type: string | null) => Boolean(type && /^application\/(?:[\w.+-]+\+)?json\b/i.test(type.split(';')[0]!.trim()));

/** JSON فقط: نوع ثاني = 415، JSON خربان = 400، فاضي = {}. */
export async function readJsonBody(req: Request, limit: number): Promise<any> {
  const text = await readBodyText(req, limit);
  if (!text.trim()) return {};
  if (!isJsonType(req.headers.get('content-type'))) throw new HttpError(415, 'نوع المحتوى غير مدعوم. أرسل JSON.');
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    throw new HttpError(400, 'صيغة الطلب غير صحيحة.');
  }
}

export interface Session {
  id: string;
  csrf: string;
  createdAt: number;
  lastSeen: number;
  data: Record<string, any>;
}

/** كل ما يحتاجه المعالج عن الطلب، ومكان يحفظ فيه الرد. */
export class Context {
  readonly url: URL;
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly cookies: Map<string, string>;
  /** هيدرات تنضاف للرد النهائي (Set-Cookie وغيره). */
  readonly headers = new Headers();
  params: Params = {};
  body: any = {};
  session: Session | null = null;
  res: Response | null = null;
  /** مكان حر للحراس (مثلاً: مين المستخدم، السيرفر المختار). */
  state: Record<string, any> = {};

  constructor(readonly req: Request, readonly ip: string) {
    this.url = new URL(req.url);
    this.method = req.method.toUpperCase();
    this.path = this.url.pathname;
    this.query = this.url.searchParams;
    this.cookies = parseCookies(req.headers.get('cookie'));
  }

  /** قيمة نصية من الرابط (فاضية لو مو موجودة). */
  q(name: string): string {
    return this.query.get(name) ?? '';
  }

  get sent() { return this.res !== null; }

  send(res: Response): Response {
    this.res = res;
    return res;
  }

  json(data: unknown, status = 200, headers?: HeadersInit): Response {
    return this.send(new Response(JSON.stringify(data ?? null), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headersObject(headers) } }));
  }

  /** c.status(400).json({...}) — نفس أسلوب الكود القديم. */
  status(code: number) {
    return { json: (data: unknown) => this.json(data, code), text: (body: string) => this.text(body, code) };
  }

  /** رد خطأ موحّد: { error } بالعربي. */
  fail(status: number, error: string, extra: Record<string, unknown> = {}): Response {
    return this.json({ error, ...extra }, status);
  }

  text(body: string, status = 200, type = 'text/plain; charset=utf-8', headers?: HeadersInit): Response {
    return this.send(new Response(body, { status, headers: { 'content-type': type, ...headersObject(headers) } }));
  }

  html(body: string, status = 200, headers?: HeadersInit): Response {
    return this.text(body, status, 'text/html; charset=utf-8', headers);
  }

  redirect(location: string, status = 302): Response {
    return this.send(new Response(null, { status, headers: { location } }));
  }

  empty(status = 204): Response {
    return this.send(new Response(null, { status }));
  }

  setCookie(name: string, value: string, options?: CookieOptions) {
    this.headers.append('set-cookie', serializeCookie(name, value, options));
  }

  clearCookie(name: string, options: CookieOptions = {}) {
    this.headers.append('set-cookie', serializeCookie(name, '', { ...options, maxAge: 0 }));
  }
}

function headersObject(init?: HeadersInit): Record<string, string> {
  if (!init) return {};
  return Object.fromEntries(new Headers(init).entries());
}
