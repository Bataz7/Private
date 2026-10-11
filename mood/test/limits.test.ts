/** يتأكد إن كل الأوامر والأزرار والنوافذ داخل حدود Discord API (عشان ما يرفضها ديسكورد). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { COMMANDS } from "../src/commands.ts";
import { checkinMessage, entryModal, entryResult } from "../src/features/checkin.ts";
import { MOODS, TAGS } from "../src/moods.ts";
import { makeApp, TARGET } from "./helpers.ts";

const NAME = /^[-_\p{L}\p{N}]{1,32}$/u;

function checkOptions(opts: any[] = [], path: string) {
  assert.ok(opts.length <= 25, `${path}: ≤25 options`);
  let seenOptional = false;
  for (const o of opts) {
    assert.match(o.name, NAME, `${path}.${o.name} name`);
    assert.equal(o.name, o.name.toLowerCase(), `${path}.${o.name} lowercase`);
    assert.ok(o.description.length >= 1 && o.description.length <= 100, `${path}.${o.name} description length`);
    if (o.type === 1 || o.type === 2) { checkOptions(o.options, `${path}.${o.name}`); continue; }
    if (o.required) assert.ok(!seenOptional, `${path}.${o.name}: required options must come first`);
    else seenOptional = true;
    for (const c of o.choices ?? []) assert.ok(c.name.length <= 100);
  }
}

function checkComponents(rows: any[], where: string) {
  assert.ok(rows.length <= 5, `${where}: ≤5 rows`);
  for (const r of rows) {
    assert.equal(r.type, 1);
    assert.ok(r.components.length >= 1 && r.components.length <= 5, `${where}: 1-5 per row`);
    const hasSelect = r.components.some((c: any) => c.type === 3);
    if (hasSelect) assert.equal(r.components.length, 1, `${where}: select alone in row`);
    for (const c of r.components) {
      if (c.custom_id) assert.ok(c.custom_id.length <= 100, `${where}: custom_id ≤100`);
      if (c.label) assert.ok(c.label.length <= 80, `${where}: label ≤80`);
      if (c.type === 2) assert.ok(c.label || c.emoji, `${where}: button needs label or emoji`);
      if (c.type === 3) {
        assert.ok(c.options.length >= 1 && c.options.length <= 25);
        assert.ok(c.max_values <= c.options.length && c.min_values <= c.max_values);
        assert.ok((c.placeholder ?? "").length <= 150);
        for (const o of c.options) assert.ok(o.label.length <= 100 && o.value.length <= 100);
      }
    }
  }
}

function checkEmbed(e: any, where: string) {
  assert.ok((e.title ?? "").length <= 256, `${where}: title`);
  assert.ok((e.description ?? "").length <= 4096, `${where}: description`);
  assert.ok((e.fields ?? []).length <= 25, `${where}: fields`);
  for (const f of e.fields ?? []) {
    assert.ok(f.name.length >= 1 && f.name.length <= 256, `${where}: field name`);
    assert.ok(f.value.length >= 1 && f.value.length <= 1024, `${where}: field value "${f.name}"`);
  }
  assert.ok((e.footer?.text ?? "").length <= 2048);
  const total = (e.title ?? "").length + (e.description ?? "").length + (e.footer?.text ?? "").length + (e.author?.name ?? "").length
    + (e.fields ?? []).reduce((n: number, f: any) => n + f.name.length + f.value.length, 0);
  assert.ok(total <= 6000, `${where}: embed total ${total} > 6000`);
}

describe("Discord API limits", () => {
  test("slash commands are valid", () => {
    assert.ok(COMMANDS.length <= 100);
    for (const c of COMMANDS as any[]) {
      assert.match(c.name, NAME);
      assert.ok(c.description.length <= 100, c.name);
      checkOptions(c.options, c.name);
    }
  });

  test("check-in message, modal and result fit the limits (worst case)", async () => {
    const t = makeApp();
    const msg = await checkinMessage(t.app, TARGET, "2026-10-09", { reminder: true });
    checkComponents(msg.components, "checkin");
    checkEmbed(msg.embeds[0], "checkin");

    for (const m of MOODS) {
      const modal = entryModal("2026-10-09", m.value, {
        user_id: TARGET, day: "2026-10-09", mood: m.value, energy: 10, sleep: 12.5,
        highlight: "x".repeat(600), problems: "y".repeat(600), gratitude: "z".repeat(150), tags: [], ai_reply: "", created_at: "", updated_at: "",
      });
      assert.ok(modal.title.length <= 45, `modal title "${modal.title}"`);
      assert.ok(modal.components.length <= 5);
      for (const r of modal.components as any[]) {
        const ti = r.components[0];
        assert.ok(ti.label.length <= 45, `text input label "${ti.label}"`);
        assert.ok((ti.placeholder ?? "").length <= 100);
        if (ti.value) assert.ok(ti.value.length <= (ti.max_length ?? 4000));
      }
    }

    const worst = {
      user_id: TARGET, day: "2026-10-09", mood: 1, energy: 1, sleep: 0,
      highlight: "ا".repeat(600), problems: "ب".repeat(600), gratitude: "ج".repeat(150),
      tags: TAGS.map((x) => x.id), ai_reply: "", created_at: "", updated_at: "",
    };
    const res = entryResult(t.app, worst, "رد ".repeat(3000), { streak: 999, newBadges: Array(16).fill("🏆 **عنوان** — وصف الإنجاز"), warnings: ["a", "b"] });
    checkComponents(res.components, "result");
    checkEmbed(res.embeds[0], "result");
  });

  test("report embed stays within limits even with a huge AI answer", async () => {
    const t = makeApp();
    for (let k = 1; k <= 28; k++) t.app.db.upsertEntry({ user_id: TARGET, day: `2026-09-${String(k).padStart(2, "0")}`, mood: (k % 5) + 1 });
    const long = (c: string) => Array(8).fill(c.repeat(400));
    t.app.ai.analyze = async () => ({ summary: "س".repeat(5000), good_things: long("ح"), bad_things: long("ض"), tips: long("ن"), source: "ai" as const });
    const { buildReport } = await import("../src/features/reports.ts");
    const r = await buildReport(t.app, TARGET, "2026-09-01", "2026-09-30", "تقرير شهر سبتمبر");
    checkEmbed((r.payload.embeds as any[])[0], "report");
    checkComponents(r.payload.components as any[], "report");
  });

  test("every tag fits a select option and is unique", () => {
    assert.ok(TAGS.length <= 25);
    assert.equal(new Set(TAGS.map((t) => t.id)).size, TAGS.length);
  });
});
