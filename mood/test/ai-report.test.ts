import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AI, localInsight, normalizeTurns } from "../src/ai.ts";
import type { Entry } from "../src/db.ts";
import { buildReportHTML } from "../src/report.ts";
import { computeStats } from "../src/stats.ts";
import { addDays } from "../src/time.ts";
import { fakeClaudeFetch } from "./helpers.ts";

const E = (day: string, mood: number, extra: Partial<Entry> = {}): Entry => ({
  user_id: "1", day, mood, energy: null, sleep: null, highlight: "", problems: "", gratitude: "", tags: [], ai_reply: "", created_at: "", updated_at: "", ...extra,
});

function stats(n = 10) {
  const es = Array.from({ length: n }, (_, k) => E(addDays("2026-10-01", k), (k % 5) + 1, { sleep: 6 + (k % 3), energy: 5, tags: k % 2 ? ["sport"] : ["work"], highlight: "رياضة" }));
  return computeStats(es, [], { start: "2026-10-01", end: addDays("2026-10-01", n - 1) }, new Set(es.map((e) => e.day)), addDays("2026-10-01", n - 1));
}

describe("AI", () => {
  test("request shape: model, effort, fallbacks + beta header, no sampling params", async () => {
    const c = fakeClaudeFetch("هلا");
    const ai = new AI({ apiKey: "k", model: "claude-opus-5-5", fetch: c.fetch });
    assert.equal(await ai.replyToEntry(E("2026-10-01", 4), [], { streak: 1, newBadges: [] }), "هلا");
    const r = c.requests[0]!;
    assert.equal(r.body.model, "claude-opus-5-5");
    assert.equal(r.body.fallbacks, "default");
    assert.equal(r.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
    assert.equal(r.headers["anthropic-version"], "2023-06-01");
    assert.equal(r.body.output_config.effort, "low");
    assert.equal(r.body.temperature, undefined);
    assert.equal(r.body.thinking, undefined);
  });

  test("no fallbacks param for models that don't support it", async () => {
    const c = fakeClaudeFetch();
    await new AI({ apiKey: "k", model: "claude-haiku-5-5", fetch: c.fetch }).replyToEntry(E("2026-10-01", 4), [], { streak: 1, newBadges: [] });
    assert.equal(c.requests[0]!.body.fallbacks, undefined);
    assert.equal(c.requests[0]!.headers["anthropic-beta"], undefined);
  });

  test("retries 529/429 then succeeds", async () => {
    let n = 0;
    const ai = new AI({
      apiKey: "k", model: "claude-opus-5-5", sleep: async () => {},
      fetch: async () => (++n < 3 ? new Response("{}", { status: n === 1 ? 529 : 429 }) : new Response(JSON.stringify({ content: [{ type: "text", text: "تمام" }] }))),
    });
    assert.equal(await ai.call({ messages: [{ role: "user", content: "x" }], maxTokens: 10, effort: "low" }), "تمام");
    assert.equal(n, 3);
  });

  test("falls back to a friendly local reply on refusal / errors / no key", async () => {
    const refusing = new AI({ apiKey: "k", model: "claude-opus-5-5", fetch: async () => new Response(JSON.stringify({ stop_reason: "refusal", content: [] })) });
    const r = await refusing.replyToEntry(E("2026-10-01", 1), [], { streak: 0, newBadges: [] });
    assert.ok(r.length > 10);
    const off = new AI({ apiKey: "", model: "x" });
    assert.equal(off.enabled, false);
    assert.ok((await off.replyToEntry(E("2026-10-01", 5), [], { streak: 0, newBadges: [] })).length > 5);
    await assert.rejects(off.chat([], "hi", [], "x"), /disabled/);
  });

  test("analyze uses structured output and parses JSON", async () => {
    const c = fakeClaudeFetch();
    const res = await new AI({ apiKey: "k", model: "claude-opus-5-5", fetch: c.fetch }).analyze(stats());
    assert.equal(res.source, "ai");
    assert.deepEqual(res.tips, ["نم بدري"]);
    assert.equal(c.requests[0]!.body.output_config.format.type, "json_schema");
    assert.equal(c.requests[0]!.body.output_config.effort, "medium");
  });

  test("local insight without AI is data-driven", () => {
    const ins = localInsight(stats(20));
    assert.match(ins.summary, /سجّلت 20 يوم/);
    assert.ok(ins.tips.length >= 1 && ins.tips.length <= 3);
  });

  test("chat turns are normalized (start with user, alternate)", () => {
    const t = normalizeTurns([{ role: "assistant", content: "a" }, { role: "user", content: "1" }, { role: "user", content: "2" }, { role: "assistant", content: "b" }, { role: "user", content: "" }]);
    assert.deepEqual(t, [{ role: "user", content: "1\n2" }, { role: "assistant", content: "b" }]);
  });
});

describe("HTML report", () => {
  test("renders all sections, escapes user text, no NaN/undefined", () => {
    const st = stats(30);
    st.entries[0]!.highlight = `<script>alert("x")</script>`;
    const html = buildReportHTML({ name: `<img src=x onerror=alert(1)>`, stats: st, insight: { ...localInsight(st), source: "local" }, unlocked: ["first"], generatedAt: "now" });
    assert.ok(!html.includes(`<script>alert`), "user text escaped");
    assert.ok(!html.includes(`<img src=x`), "name escaped");
    assert.ok(html.includes("&lt;script&gt;"));
    for (const s of ["المزاج يوم بيوم", "خريطة الأيام", "توزيع المزاج", "أيام الأسبوع", "وش يأثر على مزاجك", "النوم والطاقة", "الإنجازات", "السجل اليومي"]) assert.ok(html.includes(s), s);
    assert.ok(!/NaN|undefined/.test(html.replace(/<script>[\s\S]*?<\/script>/g, "")), "no NaN/undefined in markup");
    assert.ok(html.length < 400_000, `report size ${html.length}`);
  });

  test("handles an empty period", () => {
    const st = computeStats([], [], { start: "2026-10-01", end: "2026-10-07" }, new Set(), "2026-10-07");
    const html = buildReportHTML({ name: "x", stats: st, insight: { summary: "لا شيء", good_things: [], bad_things: [], tips: [] }, unlocked: [], generatedAt: "now" });
    assert.ok(html.includes("نحتاج يومين"));
    assert.ok(!/NaN/.test(html));
  });
});
