/** Collection — Map مع دوال discord.js المعتادة (first, find, filter, map…). */
export class Collection<K, V> extends Map<K, V> {
  first(): V | undefined;
  first(n: number): V[];
  first(n?: number): V | V[] | undefined {
    if (n === undefined) return this.values().next().value as V | undefined;
    const out: V[] = [];
    for (const v of this.values()) {
      if (out.length >= n) break;
      out.push(v);
    }
    return out;
  }
  last(): V | undefined {
    let last: V | undefined;
    for (const v of this.values()) last = v;
    return last;
  }
  find(fn: (v: V, k: K, c: this) => unknown): V | undefined {
    for (const [k, v] of this) if (fn(v, k, this)) return v;
    return undefined;
  }
  findKey(fn: (v: V, k: K, c: this) => unknown): K | undefined {
    for (const [k, v] of this) if (fn(v, k, this)) return k;
    return undefined;
  }
  filter(fn: (v: V, k: K, c: this) => unknown): Collection<K, V> {
    const out = new Collection<K, V>();
    for (const [k, v] of this) if (fn(v, k, this)) out.set(k, v);
    return out;
  }
  map<T>(fn: (v: V, k: K, c: this) => T): T[] {
    const out: T[] = [];
    for (const [k, v] of this) out.push(fn(v, k, this));
    return out;
  }
  mapValues<T>(fn: (v: V, k: K, c: this) => T): Collection<K, T> {
    const out = new Collection<K, T>();
    for (const [k, v] of this) out.set(k, fn(v, k, this));
    return out;
  }
  some(fn: (v: V, k: K, c: this) => unknown): boolean {
    for (const [k, v] of this) if (fn(v, k, this)) return true;
    return false;
  }
  every(fn: (v: V, k: K, c: this) => unknown): boolean {
    for (const [k, v] of this) if (!fn(v, k, this)) return false;
    return true;
  }
  reduce<T>(fn: (acc: T, v: V, k: K, c: this) => T, initial: T): T {
    let acc = initial;
    for (const [k, v] of this) acc = fn(acc, v, k, this);
    return acc;
  }
  sort(fn: (a: V, b: V) => number = () => 0): this {
    const entries = [...this.entries()].sort((a, b) => fn(a[1], b[1]));
    this.clear();
    for (const [k, v] of entries) this.set(k, v);
    return this;
  }
  sorted(fn: (a: V, b: V) => number = () => 0): Collection<K, V> {
    return new Collection([...this.entries()].sort((a, b) => fn(a[1], b[1])));
  }
  toJSON(): V[] {
    return [...this.values()];
  }
  random(): V | undefined {
    const arr = [...this.values()];
    return arr[Math.floor(Math.random() * arr.length)];
  }
  at(index: number): V | undefined {
    return [...this.values()].at(index);
  }
  hasAny(...keys: K[]): boolean {
    return keys.some((k) => this.has(k));
  }
  hasAll(...keys: K[]): boolean {
    return keys.every((k) => this.has(k));
  }
}

/** Collection محدودة الحجم: لما تمتلي تحذف الأقدم (ذاكرة ثابتة). */
export class LimitedCollection<K, V> extends Collection<K, V> {
  constructor(public maxSize: number) {
    super();
  }
  override set(k: K, v: V): this {
    if (this.maxSize <= 0) return this;
    if (super.has(k)) super.delete(k);
    else if (this.size >= this.maxSize) super.delete(super.keys().next().value as K);
    return super.set(k, v);
  }
}
