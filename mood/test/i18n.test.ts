import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ACHIEVEMENTS } from "../src/achievements.ts";
import { MESSAGES } from "../src/i18n.ts";
import { MOODS, TAGS } from "../src/moods.ts";
import { ALL_QUESTIONS, GRATITUDE, QUESTIONS, questionFor } from "../src/questions.ts";
import { addDays } from "../src/time.ts";

const ARABIC = /[؀-ۿ]/;

/** ينادي كل دوال القاموس بقيم تجريبية ويرجع كل النصوص */
function flatten(obj: unknown, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix + k;
    if (typeof v === "string") out.push([key, v]);
    else if (typeof v === "function") out.push([key, String((v as (...a: unknown[]) => unknown)(3, 2, 1, 1, 1))]);
    else if (Array.isArray(v)) v.forEach((x, i) => out.push([`${key}[${i}]`, String(x)]));
    else if (v && typeof v === "object") out.push(...flatten(v, `${key}.`));
  }
  return out;
}

describe("i18n", () => {
  test("English dictionary has every key and no untranslated Arabic", () => {
    const ar = new Map(flatten(MESSAGES.ar));
    const en = new Map(flatten(MESSAGES.en));
    assert.deepEqual([...en.keys()].sort(), [...ar.keys()].sort());
    for (const [k, v] of en) {
      if (k.startsWith("helpCommands")) continue; // "/language — (عربي / English)" مقصودة
      assert.ok(!ARABIC.test(v), `en.${k} has Arabic: ${v}`);
      assert.ok(v.length > 0, `en.${k} empty`);
    }
    for (const [k, v] of ar) assert.ok(v.length > 0, `ar.${k} empty`);
  });

  test("moods, tags and achievements are translated", () => {
    for (const m of MOODS) assert.ok(m.label.ar && m.label.en && !ARABIC.test(m.label.en));
    for (const t of TAGS) assert.ok(t.label.ar && t.label.en && !ARABIC.test(t.label.en) && t.label.ar.length <= 100 && t.label.en.length <= 100);
    for (const a of ACHIEVEMENTS) assert.ok(a.title.en && a.description.en && !ARABIC.test(a.title.en + a.description.en), a.code);
  });
});

describe("daily questions", () => {
  test("every question fits Discord's 45-char modal label in both languages", () => {
    for (const q of ALL_QUESTIONS) {
      assert.ok(q.ar.length <= 45, `ar "${q.ar}" is ${q.ar.length}`);
      assert.ok(q.en.length <= 45, `en "${q.en}" is ${q.en.length}`);
      assert.ok(!ARABIC.test(q.en), q.id);
    }
    assert.equal(new Set(ALL_QUESTIONS.map((q) => q.id)).size, ALL_QUESTIONS.length, "ids unique");
    assert.ok(QUESTIONS.length >= 40);
  });

  test("deterministic, gratitude once a week, no repeats until the pool is used up", () => {
    const uid = "111111111111111111";
    assert.equal(questionFor(uid, "2026-10-09").id, questionFor(uid, "2026-10-09").id);
    const days = Array.from({ length: 7 * 20 }, (_, k) => addDays("2026-01-04", k));
    const qs = days.map((d) => questionFor(uid, d));
    for (let w = 0; w + 7 <= qs.length; w += 7) {
      assert.equal(qs.slice(w, w + 7).filter((q) => q.id === GRATITUDE.id).length, 1, `week ${w / 7}`);
    }
    const others = qs.filter((q) => q.id !== GRATITUDE.id).map((q) => q.id);
    const firstCycle = others.slice(0, QUESTIONS.length);
    assert.equal(new Set(firstCycle).size, QUESTIONS.length, "no repeats in a full cycle");
    assert.notEqual(questionFor("222222222222222222", "2026-10-10").id + questionFor("222222222222222222", "2026-10-11").id,
      questionFor(uid, "2026-10-10").id + questionFor(uid, "2026-10-11").id, "different order per person");
  });
});
