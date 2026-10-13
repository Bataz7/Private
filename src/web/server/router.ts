import { Context, HttpError, MB, readJsonBody } from './http.js';

// راوتر صغير: method + مسار فيه :params، حرّاس لكل مسار (دخول، أدمن، حد طلبات، CSRF)، وجسم JSON بحد أقصى.
// أول مسار يطابق هو اللي يرد (بنفس ترتيب التسجيل).

/** يرجع Response (أو يحفظه في c) لما يرفض؛ يرجع لا شيء لما يسمح. */
export type Guard = (c: Context) => unknown;
export type Handler = (c: Context) => unknown;

export type RouteOptions = {
  guards?: Guard[];
  /** أقصى حجم لجسم الطلب بالبايت، أو false بدون قراءة الجسم. الافتراضي 1MB. */
  body?: number | false;
};

export interface Route {
  method: string;
  path: string;
  scope: string;
  parts: string[];
  guards: Guard[];
  handler: Handler;
  body: number | false;
}

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface Mount {
  get(path: string | string[], handler: Handler, options?: RouteOptions): void;
  post(path: string | string[], handler: Handler, options?: RouteOptions): void;
  put(path: string | string[], handler: Handler, options?: RouteOptions): void;
  patch(path: string | string[], handler: Handler, options?: RouteOptions): void;
  delete(path: string | string[], handler: Handler, options?: RouteOptions): void;
}

export class Router implements Mount {
  readonly routes: Route[] = [];

  constructor(private readonly scopeName = 'default', private readonly baseGuards: Guard[] = [], private readonly root?: Router) {}

  add(method: string, path: string | string[], handler: Handler, options: RouteOptions = {}) {
    const target = this.root ?? this;
    for (const item of Array.isArray(path) ? path : [path]) {
      target.routes.push({
        method, path: item, scope: this.scopeName, parts: split(item),
        guards: [...this.baseGuards, ...(options.guards ?? [])], handler, body: options.body ?? MB,
      });
    }
  }
  get(path: string | string[], handler: Handler, options?: RouteOptions) { this.add('GET', path, handler, options); }
  post(path: string | string[], handler: Handler, options?: RouteOptions) { this.add('POST', path, handler, options); }
  put(path: string | string[], handler: Handler, options?: RouteOptions) { this.add('PUT', path, handler, options); }
  patch(path: string | string[], handler: Handler, options?: RouteOptions) { this.add('PATCH', path, handler, options); }
  delete(path: string | string[], handler: Handler, options?: RouteOptions) { this.add('DELETE', path, handler, options); }

  /** مجموعة مسارات تشترك في حرّاس (مثلاً كل /api للستاف). */
  scope(name: string, guards: Guard[]): Router {
    return new Router(name, [...this.baseGuards, ...guards], this.root ?? this);
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    const parts = split(path);
    const wanted = method === 'HEAD' ? 'GET' : method;
    for (const route of (this.root ?? this).routes) {
      if (route.method !== wanted || route.parts.length !== parts.length) continue;
      const params = matchParts(route.parts, parts);
      if (params) return { route, params };
    }
    return null;
  }

  /** جدول المسارات (للتدقيق والاختبارات). */
  table() {
    return (this.root ?? this).routes.map(route => ({ method: route.method, path: route.path, scope: route.scope }));
  }

  /** يشغّل المسار المطابق: الحراس ثم الجسم ثم المعالج. يرجع null لو ما فيه مسار. */
  async dispatch(c: Context): Promise<Response | null> {
    const found = this.match(c.method, c.path);
    if (!found) return null;
    const { route, params } = found;
    c.params = params;
    for (const guard of route.guards) {
      const result = await guard(c);
      if (result instanceof Response) return c.send(result);
      if (c.res) return c.res;
    }
    if (route.body !== false && METHODS_WITH_BODY.has(c.method)) c.body = await readJsonBody(c.req, route.body);
    const result = await route.handler(c);
    if (result instanceof Response) return c.send(result);
    return c.res ?? c.empty(204);
  }
}

function split(path: string) {
  return path.split('/').filter(Boolean);
}

function matchParts(pattern: string[], parts: string[]) {
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index]!;
    const actual = parts[index]!;
    if (expected.startsWith(':')) {
      if (actual.length > 200) return null;
      try { params[expected.slice(1)] = decodeURIComponent(actual); } catch { return null; }
    } else if (expected !== actual) return null;
  }
  return params;
}

export { Context, HttpError };
