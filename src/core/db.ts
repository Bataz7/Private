/**
 * التخزين: SQLite المدمج في Bun (نفس ملفات قواعد البيانات القديمة في data/ — البيانات تنتقل كما هي)
 * + ملفات JSON القديمة بكاش ما يُعاد تحميله إلا إذا تغيّر الملف (لوحة التحكم تكتب في نفس الملفات).
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";

type Row = Record<string, any>;
type Param = string | number | bigint | boolean | null | undefined | Uint8Array;

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
/**
 * آيديات ديسكورد أكبر من أرقام JavaScript، فنقرأ الأعداد كـ bigint ونحوّل:
 * الأرقام الصغيرة → number، والكبيرة (الآيديات) → string. فالآيديات دايماً نصوص في الكود.
 */
function norm(v: unknown): unknown {
  if (typeof v === "bigint") return v <= MAX && v >= -MAX ? Number(v) : v.toString();
  return v;
}
function normRow<T>(r: Row | null | undefined): T | undefined {
  if (!r) return undefined;
  for (const k in r) r[k] = norm(r[k]);
  return r as T;
}
const bind = (p: Param[]) => p.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v)) as any[];

/** غلاف خفيف على SQLite: all / get / run / exec / tx — الآيديات ترجع نصوص. */
export class Sql {
  constructor(readonly raw: Database) {}
  all<T = Row>(sql: string, ...p: Param[]): T[] {
    return (this.raw.query(sql).all(...bind(p)) as Row[]).map((r) => normRow<T>(r)!);
  }
  get<T = Row>(sql: string, ...p: Param[]): T | undefined {
    return normRow<T>(this.raw.query(sql).get(...bind(p)) as Row | null);
  }
  /** قيمة وحدة (أول عمود). */
  value<T = any>(sql: string, ...p: Param[]): T | undefined {
    const r = this.raw.query(sql).values(...bind(p))[0];
    return r ? (norm(r[0]) as T) : undefined;
  }
  run(sql: string, ...p: Param[]): { changes: number; lastInsertRowid: number } {
    const r = this.raw.query(sql).run(...bind(p));
    return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
  }
  exec(sql: string): void {
    this.raw.exec(sql);
  }
  tx<T>(fn: () => T): T {
    return this.raw.transaction(fn)();
  }
  /** يضيف عمود لجدول لو مو موجود (ترقية القواعد القديمة بدون حذف شي). */
  addColumn(table: string, column: string, type: string): void {
    const cols = this.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === column)) this.raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

const open = new Map<string, Sql>();

/** يفتح قاعدة بيانات في data/ (مرة وحدة لكل ملف) بإعدادات خفيفة على الذاكرة. */
export function db(file: string): Sql {
  let d = open.get(file);
  if (!d) {
    const raw = new Database(join(config.DATA_DIR, file), { create: true, safeIntegers: true });
    raw.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-256; PRAGMA busy_timeout=5000;");
    d = new Sql(raw);
    open.set(file, d);
  }
  return d;
}

export function closeAll(): void {
  for (const d of open.values()) d.raw.close();
  open.clear();
}

/** JSON.parse يحافظ على الآيديات الكبيرة (16 رقم أو أكثر) كنصوص بدل ما تخرب. */
export function parseJson<T = any>(text: string): T {
  return JSON.parse(text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
}

export function dbFiles(): string[] {
  return [...open.keys()];
}

/** ملف JSON في data/ يُقرأ من الذاكرة ولا يُعاد تحميله إلا إذا تغيّر على القرص. */
export class JsonStore<T extends Record<string, any> = Record<string, any>> {
  private data: T = {} as T;
  private mtime = -1;
  readonly path: string;

  constructor(file: string) {
    this.path = join(config.DATA_DIR, file);
  }

  get(): T {
    let m = -1;
    try {
      m = statSync(this.path).mtimeMs;
    } catch {
      this.data = {} as T;
      this.mtime = -1;
      return this.data;
    }
    if (m !== this.mtime) {
      try {
        this.data = parseJson(readFileSync(this.path, "utf8"));
      } catch {
        this.data = {} as T;
      }
      this.mtime = m;
    }
    return this.data;
  }

  save(data: T = this.data): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.path);
    this.data = data;
    this.mtime = statSync(this.path).mtimeMs;
  }

  exists(): boolean {
    return existsSync(this.path);
  }
}

/** كاش بسيط بمدة صلاحية. */
export class TTL<V> {
  private d = new Map<string, [number, V]>();
  constructor(private readonly ttlMs = 30_000, private readonly max = 1000) {}
  get(k: string): V | undefined {
    const v = this.d.get(k);
    if (v && v[0] > Date.now()) return v[1];
    if (v) this.d.delete(k);
    return undefined;
  }
  set(k: string, v: V): V {
    if (this.d.size >= this.max) this.d.delete(this.d.keys().next().value!);
    this.d.set(k, [Date.now() + this.ttlMs, v]);
    return v;
  }
  delete(k: string) {
    this.d.delete(k);
  }
  clear() {
    this.d.clear();
  }
}
