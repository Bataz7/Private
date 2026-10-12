/**
 * طابور مهام بين لوحة التحكم (برنامج منفصل) والبوت عبر SQLite (data/dashboard_jobs.db).
 * اللوحة تضيف مهمة (مثل إرسال بانل التذاكر) والبوت ينفذها خلال ثواني ويكتب النتيجة.
 *
 *   البوت:  onJob("ticket-panel", async (guildId, payload) => { …; return "تم" })   ← يرمي Error برسالة عربية عند الفشل
 *   اللوحة: const id = enqueueJob("ticket-panel", gid, {...}); const r = await waitJob(id)
 */
import { db } from "./db.ts";
import { log } from "./log.ts";

const sql = db("dashboard_jobs.db");
sql.exec(`CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, guild_id TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', result TEXT, created_at INTEGER NOT NULL, done_at INTEGER)`);

type JobFn = (guildId: string, payload: any) => Promise<string | void> | string | void;
const handlers = new Map<string, JobFn>();

export function onJob(kind: string, fn: JobFn): void {
  handlers.set(kind, fn);
}

let started = false;
/** يبدأ البوت بمراقبة الطابور (كل 3 ثواني، استعلام واحد صغير). */
export function startJobs(): void {
  if (started) return;
  started = true;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const jobs = sql.all<{ id: number; kind: string; guild_id: string; payload: string }>(
        "SELECT id, kind, guild_id, payload FROM jobs WHERE status = 'pending' ORDER BY id LIMIT 10");
      for (const j of jobs) {
        const fn = handlers.get(j.kind);
        let status = "done";
        let result = "";
        try {
          if (!fn) throw new Error("نوع مهمة غير معروف");
          result = (await fn(String(j.guild_id), JSON.parse(j.payload))) ?? "تم";
        } catch (e) {
          status = "error";
          result = (e as Error).message || "تعذر التنفيذ";
          log.warn("jobs", `${j.kind}: ${result}`);
        }
        sql.run("UPDATE jobs SET status = ?, result = ?, done_at = ? WHERE id = ?", status, result, Date.now(), j.id);
      }
      sql.run("DELETE FROM jobs WHERE created_at < ?", Date.now() - 86_400_000);
    } finally {
      busy = false;
    }
  }, 3000).unref();
}

/** (اللوحة) يضيف مهمة ويرجع رقمها. */
export function enqueueJob(kind: string, guildId: string, payload: unknown): number {
  return sql.run("INSERT INTO jobs (kind, guild_id, payload, created_at) VALUES (?, ?, ?, ?)", kind, guildId, JSON.stringify(payload), Date.now()).lastInsertRowid;
}

/** (اللوحة) ينتظر نتيجة المهمة (افتراضياً 15 ثانية). */
export async function waitJob(id: number, timeoutMs = 15_000): Promise<{ ok: boolean; message: string }> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = sql.get<{ status: string; result: string }>("SELECT status, result FROM jobs WHERE id = ?", id);
    if (r && r.status !== "pending") return { ok: r.status === "done", message: r.result };
    await Bun.sleep(400);
  }
  return { ok: false, message: "البوت ما رد — تأكد إنه شغال" };
}
