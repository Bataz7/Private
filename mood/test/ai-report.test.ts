import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AI, localInsight, normalizeTurns, parseInsight } from "../src/ai.ts";
import { buildReportHTML } from "../src/report.ts";
import { computeStats } from "../src/stats.ts";
import type { Entry } from "../src/store/types.ts";
import { addDays } from "../src/time.ts";
import { fakeClaudeFetch } from "./helpers.ts";

const E = (day: string, mood: number, extra: Partial<Entry> = {}): Entry => ({
  user_id: "1", day, mood, energy: null, sleep: null, highlight: "", problems: "", gratitude: "", tags: [], question: "", answer: "", ai_reply: "", created_at: "", updated_at: "", ...extra,
});

function stats(n = 10) {
  const es = Array.from({ length: n }, (_, k) => E(addDays("2026-10-01", k), (k % 5) + 1, {
    sleep: 6 + (k % 3), energy: 5, tags: k % 2 ? ["sport"] : ["work"], highlight: "رياضة", question: "laugh", answer: k % 2 ? "نكتة" : "",
  }));
  return computeStats(es, [], { start: "2026-10-01", end: addDays("2026-10-01", n - 1) }, new Set(es.map((e) => e.day)), addDays("2026-10-01", n - 1));
}

const extra = (lang: "ar" | "en" = "ar") => ({ streak: 1, newBadges: [] as string[], lang });

describe("AI: OpenRouter", () => {
  test("request shape: chat/completions, Bearer key, referer/title, model, system message", async () => {
    const c = fakeClaudeFetch("هلا");
    const ai = new AI({ provider: "openrouter", apiKey: "sk-or-v1-test", model: "openai/gpt-4o", appUrl: "https://example.com", appName: "Mood Bot", fetch: c.fetch });
    assert.equal(await ai.replyToEntry(E("2026-10-01", 4, { question: "laugh", answer: "ضحكت" }), [], extra()), "هلا");
    const r = c.requests[0]!;
    assert.equal(r.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(r.headers.authorization, "Bearer sk-or-v1-test");
    assert.equal(r.headers["HTTP-Referer"], "https://example.com");
    assert.equal(r.headers["X-Title"], "Mood Bot");
    assert.equal(r.body.model, "openai/gpt-4o");
    assert.equal(r.body.messages[0].role, "system");
    assert.match(r.body.messages[0].content, /مود/);
    assert.match(r.body.messages[1].content, /ضحكت/, "daily question answer reaches the AI");
    assert.equal(ai.label, "openrouter/openai/gpt-4o");
  });

  test("English users get an English system prompt", async () => {
    const c = fakeClaudeFetch("hey");
    await new AI({ provider: "openrouter", apiKey: "k", model: "openai/gpt-4o", fetch: c.fetch }).replyToEntry(E("2026-10-01", 2), [], extra("en"));
    assert.match(c.requests[0]!.body.messages[0].content, /friendly, natural, concise English/);
    assert.match(c.requests[0]!.body.messages[1].content, /Today's entry/);
  });

  test("structured report uses response_format json_schema and parses it", async () => {
    const c = fakeClaudeFetch();
    const res = await new AI({ provider: "openrouter", apiKey: "k", model: "openai/gpt-4o", fetch: c.fetch }).analyze(stats(), "ar");
    assert.equal(res.source, "ai");
    assert.deepEqual(res.tips, ["نم بدري"]);
    const rf = c.requests[0]!.body.response_format;
    assert.equal(rf.type, "json_schema");
    assert.equal(rf.json_schema.strict, true);
    assert.deepEqual(rf.json_schema.schema.required, ["summary", "good_things", "bad_things", "tips"]);
  });

  test("retries 429/5xx and errors returned inside a 200 body", async () => {
    let n = 0;
    const ai = new AI({
      provider: "openrouter", apiKey: "k", model: "m", sleep: async () => {},
      fetch: async () => {
        n++;
        if (n === 1) return new Response("{}", { status: 429 });
        if (n === 2) return new Response(JSON.stringify({ error: { code: 502, message: "upstream" } }), { status: 200 });
        return new Response(JSON.stringify({ choices: [{ message: { content: "تمام" } }] }));
      },
    });
    assert.equal(await ai.complete({ system: "s", messages: [{ role: "user", content: "x" }], maxTokens: 10, effort: "low" }), "تمام");
    assert.equal(n, 3);
  });

  test("bad key → friendly local fallback, never throws to the user", async () => {
    const ai = new AI({ provider: "openrouter", apiKey: "bad", model: "m", fetch: async () => new Response(JSON.stringify({ error: { code: 401, message: "No auth credentials found" } }), { status: 401 }) });
    const r = await ai.replyToEntry(E("2026-10-01", 1), [], extra());
    assert.ok(r.length > 10);
    const rep = await ai.analyze(stats(), "en");
    assert.equal(rep.source, "local");
    assert.match(rep.summary, /You logged/);
  });
});

describe("AI: Anthropic & others", () => {
  test("Anthropic request shape (messages API, fallbacks, effort)", async () => {
    const c = fakeClaudeFetch("هلا");
    const ai = new AI({ provider: "anthropic", apiKey: "k", model: "claude-opus-5-5", fetch: c.fetch });
    assert.equal(await ai.replyToEntry(E("2026-10-01", 4), [], extra()), "هلا");
    const r = c.requests[0]!;
    assert.equal(r.url, "https://api.anthropic.com/v1/messages");
    assert.equal(r.body.fallbacks, "default");
    assert.equal(r.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
    assert.equal(r.body.output_config.effort, "low");
    assert.equal(typeof r.body.system, "string");
  });

  test("OpenAI-compatible base URL (e.g. local Ollama)", async () => {
    const c = fakeClaudeFetch("hi");
    await new AI({ provider: "openai", apiKey: "k", model: "llama3", baseUrl: "http://localhost:11434/v1", fetch: c.fetch }).replyToEntry(E("2026-10-01", 3), [], extra("en"));
    assert.equal(c.requests[0]!.url, "http://localhost:11434/v1/chat/completions");
    assert.equal(c.requests[0]!.headers["X-Title"], undefined, "OpenRouter headers only for OpenRouter");
  });

  test("disabled without key", async () => {
    const off = new AI({ provider: "openrouter", apiKey: "", model: "x" });
    assert.equal(off.enabled, false);
    assert.equal(off.label, "off");
    assert.ok((await off.replyToEntry(E("2026-10-01", 5), [], extra("en"))).length > 5);
    await assert.rejects(off.chat([], "hi", [], "x"), /disabled/);
  });

  test("parseInsight handles code fences and chatter", () => {
    const j = { summary: "s", good_things: ["a"], bad_things: [], tips: ["t"] };
    assert.deepEqual(parseInsight(JSON.stringify(j)), j);
    assert.deepEqual(parseInsight("```json\n" + JSON.stringify(j) + "\n```"), j);
    assert.deepEqual(parseInsight("Here you go: " + JSON.stringify(j) + " hope it helps"), j);
    assert.equal(parseInsight("not json"), null);
  });

  test("local insight is data-driven in both languages", () => {
    assert.match(localInsight(stats(20), "ar").summary, /سجّلت 20 يوم/);
    assert.match(localInsight(stats(20), "en").summary, /You logged 20 of 20 days/);
  });

  test("chat turns are normalized (start with user, alternate)", () => {
    const t = normalizeTurns([{ role: "assistant", content: "a" }, { role: "user", content: "1" }, { role: "user", content: "2" }, { role: "assistant", content: "b" }, { role: "user", content: "" }]);
    assert.deepEqual(t, [{ role: "user", content: "1\n2" }, { role: "assistant", content: "b" }]);
  });
});

describe("HTML report", () => {
  test("Arabic: RTL, all sections, escapes user text, no NaN/undefined", () => {
    const st = stats(30);
    st.entries[0]!.highlight = `<script>alert("x")</script>`;
    const html = buildReportHTML({ name: `<img src=x onerror=alert(1)>`, stats: st, insight: { ...localInsight(st), source: "local" }, unlocked: ["first"], generatedAt: "now", lang: "ar" });
    assert.match(html, /<html lang="ar" dir="rtl">/);
    assert.ok(!html.includes(`<script>alert`), "user text escaped");
    assert.ok(!html.includes(`<img src=x`), "name escaped");
    for (const s of ["المزاج يوم بيوم", "خريطة الأيام", "توزيع المزاج", "أيام الأسبوع", "وش يأثر على مزاجك", "النوم والطاقة", "أسئلة اليوم", "الإنجازات", "السجل اليومي"]) assert.ok(html.includes(s), s);
    assert.ok(!/NaN|undefined/.test(html.replace(/<script>[\s\S]*?<\/script>/g, "")), "no NaN/undefined in markup");
    assert.ok(html.length < 400_000, `report size ${html.length}`);
  });

  test("English: LTR and English labels", () => {
    const st = stats(30);
    const html = buildReportHTML({ name: "Sara", stats: st, insight: { ...localInsight(st, "en"), source: "local" }, unlocked: [], generatedAt: "now", lang: "en" });
    assert.match(html, /<html lang="en" dir="ltr">/);
    for (const s of ["Mood day by day", "Calendar", "Mood by weekday", "What affects your mood?", "Daily questions", "Daily log", "Exercise"]) assert.ok(html.includes(s), s);
    assert.ok(!/[؀-ۿ]/.test(html.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/data:image[^)"]+/g, "").replace(/رياضة|نكتة/g, "")), "no stray Arabic UI text");
  });

  test("handles an empty period", () => {
    const st = computeStats([], [], { start: "2026-10-01", end: "2026-10-07" }, new Set(), "2026-10-07");
    const html = buildReportHTML({ name: "x", stats: st, insight: { summary: "لا شيء", good_things: [], bad_things: [], tips: [] }, unlocked: [], generatedAt: "now" });
    assert.ok(html.includes("نحتاج يومين"));
    assert.ok(!/NaN/.test(html));
  });
});
