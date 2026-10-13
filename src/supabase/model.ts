import { supabase } from './client.js';

type Filter = Record<string, unknown>;
type ModelConfig<T extends Record<string, any>> = {
  table: string;
  columns: Record<keyof T, string>;
  primaryKey?: string;
  dates?: Array<keyof T>;
  defaults?: Partial<T>;
};

function unwrap(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

export class SupabaseDocument<T extends Record<string, any>> {
  [key: string]: any;

  constructor(public readonly model: SupabaseModel<T>, public readonly data: T) {
    Object.assign(this, data);
  }

  async save() {
    const saved = await this.model.update(this.data.id, this.model.currentData(this));
    Object.assign(this, saved);
    return this;
  }
}

export class SupabaseQuery<T> implements PromiseLike<T> {
  private sortField?: string;
  private sortDirection: 'asc' | 'desc' = 'asc';
  private rowLimit?: number;

  constructor(private readonly runQuery: (query: SupabaseQuery<T>) => Promise<T>) {}

  sort(sort: Record<string, 1 | -1>) {
    const [field, direction] = Object.entries(sort)[0] ?? [];
    this.sortField = field;
    this.sortDirection = direction === -1 ? 'desc' : 'asc';
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  get options() {
    return { sortField: this.sortField, sortDirection: this.sortDirection, rowLimit: this.rowLimit };
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.runQuery(this).then(onfulfilled, onrejected);
  }

  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null) {
    return Promise.resolve(this).catch(onrejected);
  }
}

export class SupabaseModel<T extends Record<string, any>> {
  constructor(private readonly config: ModelConfig<T>) {}

  currentData(document: SupabaseDocument<T>) {
    const primaryKey = this.config.primaryKey ?? 'id';
    return Object.fromEntries(Object.keys(this.config.columns)
      .filter(key => key !== 'id' && key !== primaryKey && key !== '_id')
      .map(key => [key, document[key]])) as Partial<T>;
  }

  private toDb(data: Partial<T>) {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [
      this.config.columns[key as keyof T] ?? key,
      unwrap(value)
    ]));
  }

  private fromDb(row: Record<string, any>): SupabaseDocument<T> & T {
    const data = {} as T;
    for (const [key, column] of Object.entries(this.config.columns)) {
      const value = row[column];
      (data as any)[key] = this.config.dates?.includes(key as keyof T) && value ? new Date(value) : value;
    }
    (data as any)._id = row.id ?? row[this.config.primaryKey ?? 'id'];
    if (!('id' in this.config.columns)) (data as any).id = row[this.config.primaryKey ?? 'id'];
    return Object.assign(new SupabaseDocument(this, data), data) as SupabaseDocument<T> & T;
  }

  private applyFilters(query: any, filters: Filter) {
    for (const [key, value] of Object.entries(filters)) {
      const column = this.config.columns[key as keyof T] ?? key;
      query = query.eq(column, unwrap(value));
    }
    return query;
  }

  private async execute(filters: Filter, options: SupabaseQuery<T[]>['options']) {
    let query = this.applyFilters(supabase.from(this.config.table).select('*'), filters);
    if (options.sortField) {
      const mappedSortField = this.config.columns[options.sortField as keyof T] ?? (options.sortField === 'createdAt' ? 'created_at' : options.sortField);
      query = query.order(mappedSortField, { ascending: options.sortDirection === 'asc' });
    }
    if (options.rowLimit) query = query.limit(options.rowLimit);
    const { data, error } = await query;
    if (error) throw new Error(`فشل استعلام ${this.config.table} في قاعدة البيانات: ${error.message}`);
    return (data ?? []).map((row: Record<string, any>) => this.fromDb(row));
  }

  find(filters: Filter = {}) {
    return new SupabaseQuery<Array<SupabaseDocument<T> & T>>(query => this.execute(filters, query.options));
  }

  findOne(filters: Filter = {}) {
    return new SupabaseQuery<(SupabaseDocument<T> & T) | null>(async query => (await this.execute(filters, { ...query.options, rowLimit: 1 }))[0] ?? null);
  }

  async findById(id: string | number | undefined) {
    if (id === undefined) return null;
    return (await this.findOne({ id })) as SupabaseDocument<T> | null;
  }

  async create(data: Partial<T>) {
    const payload = this.toDb({ ...this.config.defaults, ...data });
    const { data: rows, error } = await supabase.from(this.config.table).insert(payload).select('*').single();
    if (error) throw new Error(`فشل حفظ ${this.config.table} في قاعدة البيانات: ${error.message}`);
    return this.fromDb(rows);
  }

  async update(id: string | number, data: Partial<T>) {
    const { data: row, error } = await supabase.from(this.config.table).update(this.toDb(data)).eq(this.config.primaryKey ?? 'id', id).select('*').single();
    if (error) throw new Error(`فشل تحديث ${this.config.table} في قاعدة البيانات: ${error.message}`);
    return this.fromDb(row);
  }

  async deleteMany(filters: Filter = {}) {
    let query = supabase.from(this.config.table).delete();
    query = this.applyFilters(query, filters);
    const { error } = await query;
    if (error) throw new Error(`فشل حذف ${this.config.table} من قاعدة البيانات: ${error.message}`);
  }

  async findByIdAndUpdate(id: string | number, data: Partial<T>, _options?: { new?: boolean }) {
    return this.update(id, data);
  }

  async findOneAndUpdate(filters: Filter, data: Partial<T>, options: { upsert?: boolean; new?: boolean; setDefaultsOnInsert?: boolean } = {}) {
    const existing = await this.findOne(filters);
    if (existing) return this.update(existing.data.id, data);
    if (!options.upsert) return null;
    return this.create({ ...filters, ...data } as Partial<T>);
  }

  async countDocuments(filters: Filter = {}) {
    let query = this.applyFilters(supabase.from(this.config.table).select('id', { count: 'exact', head: true }), filters);
    const { count, error } = await query;
    if (error) throw new Error(`فشل عدّ ${this.config.table} في قاعدة البيانات: ${error.message}`);
    return count ?? 0;
  }
}