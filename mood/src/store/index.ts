/**
 * يختار قاعدة البيانات حسب DATABASE_URL:
 *   (فاضي)                       → SQLite (ملف data/mood.db، بدون أي تثبيت)
 *   sqlite:./data/mood.db        → SQLite بمسار مخصص
 *   postgres://user:pass@host/db → PostgreSQL   (npm install pg)
 *   mysql://user:pass@host/db    → MySQL/MariaDB (npm install mysql2)
 *   mongodb+srv://…              → MongoDB       (npm install mongodb)
 */
import { join, resolve } from "node:path";
import { MongoStore } from "./mongo.ts";
import { mysqlExec, postgresExec, sqliteExec, SqlStore } from "./sql.ts";
import { StoreError, type Store, type StoreKind } from "./types.ts";

export * from "./types.ts";

export function detectKind(url: string | undefined): StoreKind {
  const u = (url ?? "").trim().toLowerCase();
  if (!u || u.startsWith("sqlite:") || u === ":memory:" || u.endsWith(".db") || u.endsWith(".sqlite")) return "sqlite";
  if (u.startsWith("postgres://") || u.startsWith("postgresql://")) return "postgres";
  if (u.startsWith("mysql://") || u.startsWith("mariadb://")) return "mysql";
  if (u.startsWith("mongodb://") || u.startsWith("mongodb+srv://")) return "mongodb";
  throw new StoreError(`DATABASE_URL غير مفهوم: "${url}" — لازم يبدأ بـ sqlite: أو postgres:// أو mysql:// أو mongodb://`);
}

/** يخفي كلمة المرور من الرابط (للّوق). */
export function redact(url: string): string {
  return url.replace(/(\/\/[^:/@]+:)[^@]+@/, "$1***@");
}

export async function createStore(url: string | undefined, dataDir: string): Promise<Store> {
  const kind = detectKind(url);
  let store: Store;
  switch (kind) {
    case "sqlite": {
      const raw = (url ?? "").trim();
      const path = !raw ? join(dataDir, "mood.db") : raw === ":memory:" || raw === "sqlite::memory:" ? ":memory:" : resolve(raw.replace(/^sqlite:(\/\/)?/, ""));
      store = new SqlStore(await sqliteExec(path));
      break;
    }
    case "postgres":
      store = new SqlStore(await postgresExec(url!));
      break;
    case "mysql":
      store = new SqlStore(await mysqlExec(url!.replace(/^mariadb:/, "mysql:")));
      break;
    case "mongodb":
      store = new MongoStore(url!);
      break;
  }
  await store.init();
  return store;
}
