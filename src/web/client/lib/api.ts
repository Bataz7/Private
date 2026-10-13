// طلبات الـ API: كل طلب غير GET يرسل رمز CSRF من <meta name="csrf-token">، والأخطاء ترجع برسائل عربية واضحة.

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export type ApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** بالمللي ثانية، الافتراضي 15 ثانية. */
  timeout?: number;
  /** لا تحوّل لصفحة الدخول عند 401 (للصفحات العامة). */
  noRedirect?: boolean;
};

export const csrfToken = (): string => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || '';

// رسائل السيرفر الإنجليزية القديمة الشائعة، بالعربي.
const KNOWN: Array<[RegExp, string]> = [
  [/administrator permission is required/i, 'هذا الإجراء للإدارة فقط.'],
  [/authentication required|unauthorized/i, 'انتهت الجلسة، سجّل دخولك من جديد.'],
  [/staff role is required/i, 'لازم يكون عندك رتبة الستاف.'],
  [/guild not configured|set up this server first/i, 'السيرفر ما تم إعداده بعد. افتح إعدادات السيرفر أول.'],
  [/too many requests/i, 'طلبات كثيرة، انتظر شوي وجرّب مرة ثانية.'],
];

function arabic(message: string): string {
  for (const [pattern, text] of KNOWN) if (pattern.test(message)) return text;
  return message;
}

let redirecting = false;

export async function api<T = any>(url: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers['x-csrf-token'] = csrfToken();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 15_000);
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: method === 'GET' || options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (options.signal?.aborted) throw error;
    throw new ApiError(controller.signal.aborted ? 'السيرفر تأخر في الرد. جرّب مرة ثانية.' : 'تعذّر الاتصال بالسيرفر. تأكد من الانترنت وجرّب مرة ثانية.', 0, null);
  }
  clearTimeout(timer);
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data as T;
  const message = typeof data?.error === 'string' && data.error ? arabic(data.error) : '';
  if (response.status === 401) {
    if (!options.noRedirect && !redirecting) {
      redirecting = true;
      location.assign('/login');
    }
    throw new ApiError(message || 'انتهت الجلسة، سجّل دخولك من جديد.', 401, data);
  }
  if (response.status === 403) throw new ApiError(message || 'ما عندك صلاحية لهذا الإجراء.', 403, data);
  if (response.status === 429) throw new ApiError(message || 'طلبات كثيرة، انتظر شوي وجرّب مرة ثانية.', 429, data);
  if (response.status === 404) throw new ApiError(message || 'الشي المطلوب مو موجود.', 404, data);
  throw new ApiError(message || `صار خطأ في السيرفر (${response.status}).`, response.status, data);
}

/** رسالة خطأ صالحة للعرض من أي استثناء. */
export const errorText = (error: unknown, fallback = 'صار خطأ غير متوقع.'): string =>
  error instanceof Error && error.message ? error.message : fallback;
