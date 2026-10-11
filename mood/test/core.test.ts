import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ACHIEVEMENTS, evaluate } from "../src/achievements.ts";
import { ConfigError, isAllowed, isOwner, loadConfig } from "../src/config.ts";
import type { Entry } from "../src/store/types.ts";
import { detectRisk, normalizeArabic } from "../src/safety.ts";
import { bestStreak, commonThemes, computeStats, currentStreak, pearson, tagImpacts, trendPerWeek } from "../src/stats.ts";
import { addDays, arabicTime, diffDays, isoWeekKey, parseHHMM, parseWeekday, toLatinDigits, weekdayOf, zoned } from "../src/time.ts";
import { parseNumber } from "../src/features/checkin.ts";

const E = (day: string, mood: number, extra: Partial<Entry> = {}): Entry => ({
  user_id: "1", day, mood, energy: null, sleep: null, highlight: "", problems: "", gratitude: "", tags: [], question: "", answer: "", ai_reply: "", created_at: "", updated_at: "", ...extra,
});

describe("time", () => {
  test("zoned converts to the user's timezone", () => {
    const z = zoned(new Date("2026-10-09T11:30:00Z"), "Asia/Riyadh");
    assert.deepEqual(z, { day: "2026-10-09", hhmm: "14:30", minutes: 870, weekday: 5 });
    assert.equal(zoned(new Date("2026-10-09T22:30:00Z"), "Asia/Riyadh").day, "2026-10-10");
  });
  test("day math", () => {
    assert.equal(addDays("2026-02-28", 1), "2026-03-01");
    assert.equal(addDays("2026-01-01", -1), "2025-12-31");
    assert.equal(diffDays("2026-03-01", "2026-02-27"), 2);
    assert.equal(weekdayOf("2026-10-09"), 5);
    assert.equal(isoWeekKey("2026-01-01"), "2026-W01");
    assert.equal(isoWeekKey("2026-12-31"), "2026-W53");
  });
  test("parsing times, weekdays and Arabic digits", () => {
    assert.equal(parseHHMM("14:30"), 870);
    assert.equal(parseHHMM("٢:٣٠"), 150);
    assert.equal(parseHHMM("25:00"), null);
    assert.equal(parseHHMM("abc"), null);
    assert.equal(parseWeekday("الجمعة"), 5);
    assert.equal(parseWeekday("Friday"), 5);
    assert.equal(parseWeekday("0"), 0);
    assert.equal(parseWeekday("someday"), null);
    assert.equal(toLatinDigits("٧.٥ ساعات"), "7.5 ساعات");
    assert.equal(arabicTime(870), "2:30 الظهر");
    assert.equal(arabicTime(150), "2:30 الفجر");
  });
});

describe("config", () => {
  const base = { DISCORD_TOKEN: "x", TARGET_USER_ID: "111111111111111111" };
  test("defaults", () => {
    const c = loadConfig(base);
    assert.equal(c.checkinMinutes, 870);
    assert.equal(c.timezone, "Asia/Riyadh");
    assert.equal(c.weeklyReportDay, 5);
    assert.equal(c.aiProvider, "none");
    assert.equal(c.defaultLang, "ar");
    assert.deepEqual(c.targetIds, ["111111111111111111"]);
  });
  test("AI provider auto-detection", () => {
    const or = loadConfig({ ...base, OPENROUTER_API_KEY: "sk-or-x" });
    assert.equal(or.aiProvider, "openrouter");
    assert.equal(or.aiModel, "openai/gpt-4o");
    assert.equal(or.aiBaseUrl, "https://openrouter.ai/api/v1");
    const an = loadConfig({ ...base, ANTHROPIC_API_KEY: "sk-ant-x" });
    assert.equal(an.aiProvider, "anthropic");
    assert.equal(an.aiModel, "claude-opus-5-5");
    const custom = loadConfig({ ...base, OPENAI_API_KEY: "k", AI_BASE_URL: "http://localhost:11434/v1/", AI_MODEL: "llama3" });
    assert.equal(custom.aiProvider, "openai");
    assert.equal(custom.aiBaseUrl, "http://localhost:11434/v1");
    assert.equal(custom.aiModel, "llama3");
    assert.equal(loadConfig({ ...base, AI_PROVIDER: "openrouter" }).aiProvider, "none", "no key → off");
    assert.throws(() => loadConfig({ ...base, AI_PROVIDER: "skynet" }), /AI_PROVIDER/);
    assert.throws(() => loadConfig({ ...base, DEFAULT_LANG: "fr" }), /DEFAULT_LANG/);
    assert.equal(loadConfig({ ...base, DEFAULT_LANG: "EN" }).defaultLang, "en");
  });
  test("owner fallback only for a single target (no data leaks between targets)", () => {
    const one = loadConfig({ ...base });
    assert.ok(isOwner(one, "111111111111111111"));
    const two = loadConfig({ ...base, TARGET_USER_ID: "111111111111111111,222222222222222222" });
    assert.ok(!isOwner(two, "111111111111111111"));
    assert.ok(!isOwner(two, "222222222222222222"));
    assert.ok(isAllowed(two, "222222222222222222"));
  });
  test("multiple targets & dedupe", () => {
    assert.deepEqual(loadConfig({ ...base, TARGET_USER_ID: "111111111111111111, 222222222222222222,111111111111111111" }).targetIds.length, 2);
  });
  test("validation errors are friendly", () => {
    assert.throws(() => loadConfig({ ...base, DISCORD_TOKEN: "" }), ConfigError);
    assert.throws(() => loadConfig({ ...base, TARGET_USER_ID: "abc" }), /مو ID صحيح/);
    assert.throws(() => loadConfig({ ...base, TIMEZONE: "Mars/Base" }), /منطقة زمنية/);
    assert.throws(() => loadConfig({ ...base, CHECKIN_TIME: "2.5pm" }), /HH:MM/);
    assert.throws(() => loadConfig({ ...base, REMINDER_AFTER_HOURS: "99" }), ConfigError);
  });
});

describe("stats", () => {
  test("streaks", () => {
    const days = new Set(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-09"]);
    assert.equal(currentStreak(days, "2026-10-09"), 1);
    assert.equal(currentStreak(days, "2026-10-08"), 3, "yesterday counts if today not logged yet");
    assert.equal(bestStreak(days), 3);
  });
  test("pearson & trend", () => {
    assert.ok(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])! > 0.99);
    assert.ok(pearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])! < -0.99);
    assert.equal(pearson([1, 2], [1, 2]), null);
    const rising = [1, 2, 3, 4, 5].map((m, i) => E(addDays("2026-10-01", i), m));
    assert.ok(Math.abs(trendPerWeek(rising)! - 7) < 1e-9);
  });
  test("tag impact", () => {
    const es = [E("2026-10-01", 5, { tags: ["sport"] }), E("2026-10-02", 5, { tags: ["sport"] }), E("2026-10-03", 1, { tags: ["stress"] }), E("2026-10-04", 1, { tags: ["stress"] })];
    const t = tagImpacts(es);
    assert.equal(t[0]!.id, "sport");
    assert.equal(t[0]!.delta, 2);
    assert.equal(t.at(-1)!.id, "stress");
  });
  test("computeStats end-to-end", () => {
    const es = [E("2026-10-05", 2, { sleep: 5 }), E("2026-10-06", 4, { sleep: 8 }), E("2026-10-07", 5, { sleep: 8.5 }), E("2026-10-08", 1, { sleep: 4 })];
    const prev = [E("2026-09-30", 3)];
    const st = computeStats(es, prev, { start: "2026-10-02", end: "2026-10-08" }, new Set(es.map((e) => e.day)), "2026-10-08");
    assert.equal(st.days, 7);
    assert.equal(st.count, 4);
    assert.equal(st.avg, 3);
    assert.equal(st.delta, 0);
    assert.equal(st.goodPct, 50);
    assert.equal(st.dist[5], 1);
    assert.equal(st.sleepGood, 8.25);
    assert.equal(st.sleepBad, 4.5);
    assert.ok(st.sleepCorr! > 0.9);
    assert.equal(st.streak, 4);
    assert.ok(!Number.isNaN(st.volatility));
  });
  test("common themes", () => {
    assert.deepEqual(commonThemes(["رحت الجيم", "رحت الجيم", "نمت"]), ["رحت الجيم (×2)"]);
    assert.deepEqual(commonThemes(["gym gym", "Gym day"], "en"), ['"gym" came up often (×3)']);
  });
});

describe("achievements", () => {
  test("evaluates badges", () => {
    const es = Array.from({ length: 7 }, (_, k) => E(addDays("2026-10-01", k), k === 0 ? 1 : 5, { gratitude: "أهلي" }));
    const got = evaluate({ entries: es, streak: 7, bestStreak: 7 }).map((a) => a.code);
    for (const c of ["first", "streak3", "streak7", "great5", "comeback", "grateful"]) assert.ok(got.includes(c), c);
    assert.ok(!got.includes("goodweek"), "first day was bad");
    assert.equal(new Set(ACHIEVEMENTS.map((a) => a.code)).size, ACHIEVEMENTS.length, "codes unique");
  });
});

describe("safety", () => {
  test("detects risk phrases in Arabic & English", () => {
    for (const s of ["أبي أموت", "ودي انتحر", "ما ابي اعيش", "بأذي نفسي", "تعبت من الحياة", "I want to die", "thinking about suicide"]) {
      assert.ok(detectRisk(s), s);
    }
  });
  test("no false alarm on normal sentences", () => {
    for (const s of ["يومي كان ممل", "مت ضحك من الربع 😂", "نفسي آكل بيتزا", "الجو يموت من الحر", ""]) assert.ok(!detectRisk(s), s);
  });
  test("normalizes Arabic", () => {
    assert.equal(normalizeArabic("أَبِي"), "ابي");
  });
});

describe("modal number parsing", () => {
  test("parses Arabic digits, rounds, rejects out of range", () => {
    assert.equal(parseNumber("٧", 0, 24), 7);
    assert.equal(parseNumber("7.4 ساعات", 0, 24), 7.5);
    assert.equal(parseNumber("", 0, 24), null);
    assert.equal(parseNumber("30", 0, 24), "invalid");
    assert.equal(parseNumber("8", 1, 10, 1), 8);
  });
});
