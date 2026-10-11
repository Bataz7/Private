/** أدوات الاختبار: ديسكورد وهمي، Claude وهمي، وتطبيق كامل بقاعدة بيانات في الذاكرة. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AI } from "../src/ai.ts";
import { MoodApp } from "../src/app.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { MoodDB } from "../src/db.ts";
import { DiscordClient } from "../src/discord/api.ts";
import { REST } from "../src/discord/rest.ts";
import { silentLogger } from "../src/log.ts";

export const TARGET = "111111111111111111";
export const OWNER = "222222222222222222";
export const STRANGER = "333333333333333333";

export interface Call {
  method: string;
  path: string;
  body: any;
  files: { name: string; text: string }[];
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

/** fetch وهمي يقلّد Discord API ويسجل كل الطلبات. */
export function fakeDiscordFetch(overrides: (c: Call) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  let n = 0;
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname.replace(/^\/api\/v10/, "");
    let body: any;
    const files: Call["files"] = [];
    if (init.body instanceof FormData) {
      body = JSON.parse(String(init.body.get("payload_json")));
      for (const [k, v] of init.body.entries()) if (k.startsWith("files[")) files.push({ name: (v as File).name, text: await (v as File).text() });
    } else if (typeof init.body === "string") body = JSON.parse(init.body);
    const call = { method: String(init.method), path, body, files };
    calls.push(call);
    const o = overrides(call);
    if (o) return o;

    if (path === "/applications/@me") return json({ id: "999999999999999999" });
    if (path === "/users/@me/channels") return json({ id: `5${body.recipient_id.slice(1)}`, type: 1 });
    if (/^\/users\/\d+$/.test(path)) return json({ id: path.split("/")[2], username: "user", global_name: path.endsWith("1") ? "سارة" : "المالك" });
    if (/^\/channels\/\d+\/messages$/.test(path) && call.method === "POST") return json({ id: `70000000000000000${++n}`, channel_id: path.split("/")[2] });
    if (/\/emojis$/.test(path) && call.method === "GET") return json({ items: [] });
    if (/\/emojis$/.test(path) && call.method === "POST") return json({ id: `80000000000000000${++n}`, name: body.name });
    if (/^\/webhooks\//.test(path) && call.method === "POST") return json({ id: `90000000000000000${++n}`, channel_id: "1" });
    return new Response(null, { status: 204 });
  };
  return { fetch, calls };
}

/** fetch وهمي لـ Claude: يرجع نص أو JSON حسب الطلب. */
export function fakeClaudeFetch(reply = "رد ذكي من مود 🌟") {
  const requests: { headers: Record<string, string>; body: any }[] = [];
  const fetch = async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body));
    requests.push({ headers: init.headers as Record<string, string>, body });
    const text = body.output_config?.format
      ? JSON.stringify({ summary: "ملخص ذكي", good_things: ["الرياضة"], bad_things: ["الضغط"], tips: ["نم بدري"] })
      : reply;
    return json({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text }] });
  };
  return { fetch, requests };
}

export interface TestApp {
  app: MoodApp;
  calls: Call[];
  claude: ReturnType<typeof fakeClaudeFetch>;
  clock: { now: Date };
  config: Config;
}

export function makeApp(opts: { ai?: boolean; env?: Record<string, string>; override?: (c: Call) => Response | undefined } = {}): TestApp {
  const dataDir = mkdtempSync(join(tmpdir(), "mood-test-"));
  const config = loadConfig({
    DISCORD_TOKEN: "test-token",
    TARGET_USER_ID: TARGET,
    OWNER_ID: OWNER,
    TIMEZONE: "Asia/Riyadh",
    DATA_DIR: dataDir,
    ANTHROPIC_API_KEY: opts.ai === false ? "" : "sk-test",
    ...opts.env,
  });
  const d = fakeDiscordFetch(opts.override);
  const rest = new REST("test-token", { fetch: d.fetch, sleep: async () => {} });
  const discord = new DiscordClient(rest);
  discord.applicationId = "999999999999999999";
  const claude = fakeClaudeFetch();
  const ai = new AI({ apiKey: config.anthropicKey, model: config.aiModel, fetch: claude.fetch, sleep: async () => {} });
  const clock = { now: new Date("2026-10-09T11:30:00Z") }; // الجمعة 14:30 بتوقيت الرياض
  const app = new MoodApp({ config, db: new MoodDB(":memory:"), discord, ai, log: silentLogger, now: () => clock.now });
  return { app, calls: d.calls, claude, clock, config };
}

let seq = 0;
/** يصنع تفاعل وهمي (DM). */
export function interaction(type: number, data: Record<string, unknown>, user = TARGET, extra: Record<string, unknown> = {}): any {
  seq++;
  return {
    id: `40000000000000${String(seq).padStart(4, "0")}`,
    application_id: "999999999999999999",
    token: `tok${seq}`,
    type,
    data,
    user: { id: user, username: "u" },
    channel: { id: "511111111111111111", type: 1 },
    ...extra,
  };
}

export const callbacks = (calls: Call[]) => calls.filter((c) => c.path.includes("/callback"));
export const lastCallback = (calls: Call[]) => callbacks(calls).at(-1)!;
