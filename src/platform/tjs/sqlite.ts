/**
 * bun:sqlite فوق tjs:sqlite (txiki). الآيديات الكبيرة ترجع نصوص من C مباشرة (runtime/txiki/revive.patch)،
 * فـ safeIntegers ما يحتاج شي هنا.
 */
// @ts-ignore — وحدة مدمجة في txiki
import { Database as TjsDatabase } from "tjs:sqlite";

const MAX_STATEMENTS = 200;

export class Database {
  private readonly db: any;
  private readonly cache = new Map<string, any>();
  private readonly meta: any;

  constructor(path = ":memory:", _o?: { create?: boolean; safeIntegers?: boolean; readonly?: boolean }) {
    this.db = new TjsDatabase(path, { create: true, readOnly: false });
    this.meta = this.db.prepare("SELECT changes() AS c, last_insert_rowid() AS r");
  }

  private stmt(sql: string): any {
    let s = this.cache.get(sql);
    if (s) {
      this.cache.delete(sql);
      this.cache.set(sql, s);
      return s;
    }
    s = this.db.prepare(sql);
    if (this.cache.size >= MAX_STATEMENTS) {
      const [k, old] = this.cache.entries().next().value as [string, any];
      this.cache.delete(k);
      try { old.finalize(); } catch {}
    }
    this.cache.set(sql, s);
    return s;
  }

  query(sql: string) {
    const s = this.stmt(sql);
    const self = this;
    return {
      all: (...p: any[]) => s.all(...p) as any[],
      get: (...p: any[]) => (s.all(...p)[0] ?? null) as any,
      values: (...p: any[]) => (s.all(...p) as any[]).map((r) => Object.values(r)),
      run: (...p: any[]) => {
        s.run(...p);
        const m = self.meta.all()[0] ?? { c: 0, r: 0 };
        return { changes: Number(m.c), lastInsertRowid: m.r };
      },
    };
  }

  prepare(sql: string) {
    return this.query(sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T extends (...a: any[]) => any>(fn: T): T {
    return this.db.transaction(fn);
  }

  close(): void {
    for (const s of this.cache.values()) try { s.finalize(); } catch {}
    this.cache.clear();
    try { this.meta.finalize(); } catch {}
    this.db.close();
  }
}

export default { Database };
