/** اختبار تكامل: رحلة كاملة عبر ديسكورد وهمي (مجدول ← زر ← نافذة ← تاقات ← تقارير ← تنبيهات). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ComponentType, InteractionType, MessageFlags, ResponseType } from "../src/discord/constants.ts";
import { onDirectMessage } from "../src/features/companion.ts";
import { handleInteraction } from "../src/router.ts";
import { Scheduler } from "../src/scheduler.ts";
import { callbacks, interaction, lastCallback, makeApp, OWNER, STRANGER, TARGET, type TestApp } from "./helpers.ts";

const TARGET_DM = "511111111111111111";
const OWNER_DM = "522222222222222222";
const at = (t: TestApp, iso: string) => { t.clock.now = new Date(iso); };
const toTarget = (t: TestApp) => dms(t, TARGET_DM);
const toOwner = (t: TestApp) => dms(t, OWNER_DM);
function dms(t: TestApp, ch: string) {
  return t.calls.filter((c) => c.method === "POST" && c.path === `/channels/${ch}/messages`);
}
const prompts = (t: TestApp) => toTarget(t).filter((c) => customIds(c.body).some((id) => id.startsWith("ci:")));
const customIds = (body: any): string[] => (body.components ?? body.data?.components ?? []).flatMap((r: any) => r.components.map((c: any) => c.custom_id));

function modalSubmit(day: string, mood: number, values: Record<string, string>, user = TARGET) {
  return interaction(InteractionType.ModalSubmit, {
    custom_id: `cm:${day}:${mood}`,
    components: Object.entries(values).map(([k, v]) => ({ type: 1, components: [{ type: ComponentType.TextInput, custom_id: k, value: v }] })),
  }, user, { message: { id: "600000000000000001", flags: 0, embeds: [], components: [] } });
}

describe("daily check-in flow", () => {
  test("scheduler → buttons → modal → AI reply → tags", async () => {
    const t = await makeApp();
    const sch = new Scheduler(t.app);

    at(t, "2026-10-09T11:29:00Z"); // 14:29
    await sch.tick();
    assert.equal(toTarget(t).length, 0, "not before check-in time");

    at(t, "2026-10-09T11:30:00Z"); // 14:30
    await sch.tick();
    await sch.tick();
    assert.equal(toTarget(t).length, 1, "exactly one check-in");
    const prompt = toTarget(t)[0]!.body;
    assert.match(prompt.embeds[0].description, /كيف كان يومك/);
    assert.deepEqual(customIds(prompt), ["ci:2026-10-09:5", "ci:2026-10-09:4", "ci:2026-10-09:3", "ci:2026-10-09:2", "ci:2026-10-09:1", "sz:2026-10-09"]);
    assert.match(prompt.embeds[0].footer.text, /يطّلع عليها المالك/, "transparency: target knows owner sees reports");

    // ضغط زر "كويس" ← نافذة
    await handleInteraction(t.app, interaction(InteractionType.MessageComponent, { custom_id: "ci:2026-10-09:4", component_type: 2 }));
    const modal = lastCallback(t.calls).body;
    assert.equal(modal.type, ResponseType.Modal);
    assert.equal(modal.data.custom_id, "cm:2026-10-09:4");
    assert.equal(modal.data.components.length, 5);

    // إرسال النافذة
    await handleInteraction(t.app, modalSubmit("2026-10-09", 4, { highlight: "طلعت مع الربع", problems: "", gratitude: "أهلي", sleep: "٧", energy: "8" }));
    const ack = lastCallback(t.calls).body;
    assert.equal(ack.type, ResponseType.UpdateMessage, "prompt message updated immediately");
    assert.deepEqual(ack.data.components, [], "buttons removed");
    const entry = (await t.app.db.getEntry(TARGET, "2026-10-09"))!;
    assert.equal(entry.mood, 4);
    assert.equal(entry.sleep, 7);
    assert.equal(entry.energy, 8);
    assert.equal(entry.ai_reply, "رد ذكي من مود 🌟");
    const follow = t.calls.find((c) => c.method === "POST" && c.path.startsWith("/webhooks/"))!;
    assert.equal(follow.body.embeds[0].description, "رد ذكي من مود 🌟");
    assert.ok(customIds(follow.body).includes("tg:2026-10-09"), "tag select offered");
    assert.ok(follow.body.embeds[0].fields.some((f: any) => /إنجاز جديد/.test(f.name)), "first badge unlocked");
    assert.match(t.claude.requests[0]!.body.messages[1].content, /طلعت مع الربع/, "AI sees what was written");

    // اختيار الأنشطة
    await handleInteraction(t.app, interaction(InteractionType.MessageComponent, { custom_id: "tg:2026-10-09", component_type: 3, values: ["sport", "friends", "bogus"] }, TARGET, {
      message: follow.body && { embeds: follow.body.embeds, components: follow.body.components, flags: 0 },
    }));
    assert.deepEqual((await t.app.db.getEntry(TARGET, "2026-10-09"))!.tags, ["sport", "friends"]);
    assert.equal(lastCallback(t.calls).body.type, ResponseType.UpdateMessage);

    // ما فيه تذكير لأنه سجّل
    at(t, "2026-10-09T15:00:00Z");
    await sch.tick();
    assert.equal(toTarget(t).length, 1);
  });

  test("reminder after N hours retires the old prompt; logging before time skips the prompt", async () => {
    const t = await makeApp();
    const sch = new Scheduler(t.app);
    at(t, "2026-10-10T11:30:00Z");
    await sch.tick();
    assert.equal(toTarget(t).length, 1);
    at(t, "2026-10-10T14:29:00Z");
    await sch.tick();
    assert.equal(toTarget(t).length, 1, "not yet");
    at(t, "2026-10-10T14:30:00Z");
    await sch.tick();
    await sch.tick();
    assert.equal(toTarget(t).length, 2, "one reminder");
    assert.match(toTarget(t)[1]!.body.embeds[0].description, /تذكير/);
    assert.ok(t.calls.some((c) => c.method === "PATCH" && c.path.startsWith(`/channels/${TARGET_DM}/messages/`)), "old prompt retired");

    // اليوم اللي بعده سجّل بدري بـ /checkin ← المجدول ما يرسل
    await t.app.db.upsertEntry({ user_id: TARGET, day: "2026-10-11", mood: 3 });
    at(t, "2026-10-11T11:31:00Z");
    await sch.tick();
    assert.equal(toTarget(t).length, 2);
  });

  test("snooze button re-sends after an hour", async () => {
    const t = await makeApp({ env: { REMINDER_AFTER_HOURS: "0" } });
    const sch = new Scheduler(t.app);
    at(t, "2026-10-09T11:30:00Z");
    await sch.tick();
    await handleInteraction(t.app, interaction(InteractionType.MessageComponent, { custom_id: "sz:2026-10-09", component_type: 2 }));
    assert.equal(lastCallback(t.calls).body.type, ResponseType.UpdateMessage);
    at(t, "2026-10-09T12:20:00Z");
    await sch.tick();
    assert.equal(toTarget(t).length, 1);
    at(t, "2026-10-09T12:31:00Z");
    await sch.tick();
    assert.equal(toTarget(t).length, 2);
  });

  test("paused users get no check-in", async () => {
    const t = await makeApp();
    await t.app.db.updateUser(TARGET, { paused_until: "2026-10-12" });
    at(t, "2026-10-09T11:30:00Z");
    await new Scheduler(t.app).tick();
    assert.equal(toTarget(t).length, 0);
  });

  test("closed DMs: owner warned once, no retry spam", async () => {
    const t = await makeApp({
      override: (c) => c.method === "POST" && c.path === `/channels/${TARGET_DM}/messages`
        ? new Response(JSON.stringify({ message: "Cannot send messages to this user", code: 50007 }), { status: 403 })
        : undefined,
    });
    const sch = new Scheduler(t.app);
    at(t, "2026-10-09T11:30:00Z");
    await sch.tick();
    await sch.tick();
    assert.equal(toOwner(t).length, 1);
    assert.match(toOwner(t)[0]!.body.content, /ما قدرت أرسل/);
    assert.equal(t.calls.filter((c) => c.path === `/channels/${TARGET_DM}/messages`).length, 1);
  });
});

describe("reports", () => {
  test("weekly report on Friday 21:00 to target and owner, once", async () => {
    const t = await makeApp();
    for (let k = 0; k < 6; k++) await t.app.db.upsertEntry({ user_id: TARGET, day: `2026-10-0${k + 3}`, mood: (k % 5) + 1, tags: ["sport"] });
    const sch = new Scheduler(t.app);
    at(t, "2026-10-09T18:00:00Z");
    await sch.tick();
    await sch.tick();
    const reports = toTarget(t).filter((c) => c.files.length);
    assert.equal(reports.length, 1);
    assert.match(reports[0]!.files[0]!.name, /\.html$/);
    assert.match(reports[0]!.files[0]!.text, /<html lang="ar" dir="rtl">/);
    assert.match(reports[0]!.body.embeds[0].description, /ملخص ذكي/);
    assert.equal(toOwner(t).filter((c) => c.files.length).length, 1);
  });

  test("monthly report on the 1st covers the previous month", async () => {
    const t = await makeApp({ env: { WEEKLY_REPORT_DAY: "monday" } });
    await t.app.db.upsertEntry({ user_id: TARGET, day: "2026-10-15", mood: 4 });
    at(t, "2026-11-01T18:00:00Z");
    await new Scheduler(t.app).tick();
    const r = toTarget(t).find((c) => c.files.length)!;
    assert.match(r.body.content, /تقرير شهر/);
    assert.match(r.files[0]!.name, /2026-10-31-31d/);
  });

  test("/report defers then edits original with the HTML file", async () => {
    const t = await makeApp();
    await t.app.db.upsertEntry({ user_id: TARGET, day: "2026-10-08", mood: 5 });
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "report", options: [{ name: "period", type: 4, value: 30 }] }));
    assert.equal(callbacks(t.calls)[0]!.body.type, ResponseType.DeferredChannelMessage);
    const edit = t.calls.find((c) => c.method === "PATCH" && c.path.endsWith("/messages/@original"))!;
    assert.equal(edit.files.length, 1);
    assert.match(edit.body.embeds[0].title, /تقرير الشهر/);
  });

  test("/history, /insights, /achievements, /export, /help respond", async () => {
    const t = await makeApp();
    for (let k = 1; k <= 9; k++) await t.app.db.upsertEntry({ user_id: TARGET, day: `2026-10-0${k}`, mood: k % 2 ? 5 : 2, tags: k % 2 ? ["sport"] : ["stress"], sleep: k % 2 ? 8 : 5 });
    for (const name of ["history", "insights", "achievements", "help"]) {
      await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name }));
      const cb = lastCallback(t.calls).body;
      assert.equal(cb.type, ResponseType.ChannelMessage, name);
      assert.ok(cb.data.embeds?.length, name);
    }
    const insights = callbacks(t.calls)[1]!.body.data.embeds[0];
    assert.ok(insights.fields.some((f: any) => /رياضة/.test(f.value)), "sport shows as positive");
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "export", options: [{ name: "format", type: 3, value: "csv" }] }));
    const exp = lastCallback(t.calls);
    assert.equal(exp.files.length, 1);
    assert.match(exp.files[0]!.text, /^\uFEFF?day,mood/);
    assert.equal(exp.body.data.flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
  });
});

describe("safety & alerts", () => {
  test("risk phrase → safety message to user + owner alert", async () => {
    const t = await makeApp();
    await handleInteraction(t.app, modalSubmit("2026-10-09", 1, { problems: "تعبت وودي اموت" }));
    assert.ok(toTarget(t).some((c) => /937/.test(c.body.embeds?.[0]?.description ?? "")), "help numbers sent");
    assert.ok(toOwner(t).some((c) => /تنبيه مهم/.test(c.body.embeds?.[0]?.title ?? "")), "owner alerted");
  });

  test("3 bad days in a row → one owner alert", async () => {
    const t = await makeApp();
    await t.app.db.upsertEntry({ user_id: TARGET, day: "2026-10-07", mood: 2 });
    await t.app.db.upsertEntry({ user_id: TARGET, day: "2026-10-08", mood: 1 });
    await handleInteraction(t.app, modalSubmit("2026-10-09", 2, {}));
    await handleInteraction(t.app, modalSubmit("2026-10-09", 1, {}));
    assert.equal(toOwner(t).filter((c) => /تنبيه مزاج/.test(c.body.embeds?.[0]?.title ?? "")).length, 1);
  });
});

describe("permissions, settings, chat, errors", () => {
  test("strangers are blocked", async () => {
    const t = await makeApp();
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "report" }, STRANGER));
    const cb = lastCallback(t.calls).body;
    assert.match(cb.data.content, /خاص/);
    assert.equal(cb.data.flags, MessageFlags.Ephemeral);
    await handleInteraction(t.app, interaction(InteractionType.MessageComponent, { custom_id: `rp:${TARGET}:7`, component_type: 2 }, STRANGER));
    assert.match(lastCallback(t.calls).body.data.content, /خاص/);
  });

  test("target can't view another person's report; owner can", async () => {
    const t = await makeApp();
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "report", options: [{ name: "user", type: 6, value: OWNER }] }, TARGET));
    assert.match(lastCallback(t.calls).body.data.content, /🔒/);
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "report", options: [{ name: "user", type: 6, value: TARGET }] }, OWNER));
    assert.equal(lastCallback(t.calls).body.type, ResponseType.DeferredChannelMessage);
  });

  test("/settings time, timezone autocomplete, pause", async () => {
    const t = await makeApp();
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "settings", options: [{ name: "time", type: 1, options: [{ name: "value", type: 3, value: "٢١:١٥" }] }] }));
    assert.equal((await t.app.user(TARGET)).checkin_minutes, 21 * 60 + 15);
    await handleInteraction(t.app, interaction(InteractionType.Autocomplete, { name: "settings", options: [{ name: "timezone", type: 1, options: [{ name: "value", type: 3, value: "dubai", focused: true }] }] }));
    const ac = lastCallback(t.calls).body;
    assert.equal(ac.type, ResponseType.AutocompleteResult);
    assert.ok(ac.data.choices.some((c: any) => c.value === "Asia/Dubai"));
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "settings", options: [{ name: "timezone", type: 1, options: [{ name: "value", type: 3, value: "Nowhere/Land" }] }] }));
    assert.match(lastCallback(t.calls).body.data.content, /غير معروفة/);
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "settings", options: [{ name: "pause", type: 1, options: [{ name: "days", type: 4, value: 3 }] }] }));
    assert.equal((await t.app.user(TARGET)).paused_until, "2026-10-11");
    // الهدف ما يقدر يغير إعدادات المالك
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "settings", options: [{ name: "resume", type: 1, options: [{ name: "user", type: 6, value: OWNER }] }] }));
    assert.match(lastCallback(t.calls).body.data.content, /إعداداتك أنت/);
  });

  test("free DM chat uses AI with memory and replies to the message", async () => {
    const t = await makeApp();
    await t.app.db.upsertEntry({ user_id: TARGET, day: "2026-10-08", mood: 2, problems: "ضغط شغل" });
    await onDirectMessage(t.app, { id: "650000000000000001", channel_id: TARGET_DM, content: "وش أسوي عشان أرتاح؟", author: { id: TARGET, bot: false } } as any);
    const reply = toTarget(t).at(-1)!;
    assert.equal(reply.body.content, "رد ذكي من مود 🌟");
    assert.equal(reply.body.message_reference.message_id, "650000000000000001");
    assert.match(t.claude.requests[0]!.body.messages[0].content, /ضغط شغل/, "mood context in system prompt");
    assert.equal((await t.app.db.recentChat(TARGET)).length, 2);
    // غريب يكلم البوت ← ما يرد
    await onDirectMessage(t.app, { id: "650000000000000002", channel_id: "1", content: "hi", author: { id: STRANGER } } as any);
    assert.equal(t.claude.requests.length, 1);
  });

  test("without AI key DMs get a single daily hint", async () => {
    const t = await makeApp({ ai: false });
    for (let k = 0; k < 3; k++) await onDirectMessage(t.app, { id: `65000000000000001${k}`, channel_id: TARGET_DM, content: "هلا", author: { id: TARGET } } as any);
    assert.equal(toTarget(t).length, 1);
  });

  test("handler errors are reported to the user, not thrown", async () => {
    const t = await makeApp({
      override: (c) => c.path.includes("/callback")
        ? new Response(JSON.stringify({ message: "Interaction has already been acknowledged.", code: 40060 }), { status: 400 })
        : undefined,
    });
    await assert.doesNotReject(handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "help" })));
    const follow = t.calls.find((c) => c.method === "POST" && c.path.startsWith("/webhooks/"))!;
    assert.match(follow.body.content, /صار خطأ/);
    assert.equal(follow.body.flags, MessageFlags.Ephemeral);
  });

  test("stale buttons get a friendly answer", async () => {
    const t = await makeApp();
    await handleInteraction(t.app, interaction(InteractionType.MessageComponent, { custom_id: "rp:abc:7", component_type: 2 }));
    assert.match(lastCallback(t.calls).body.data.content, /قديم/);
  });

  test("/forget asks for confirmation then deletes", async () => {
    const t = await makeApp();
    await t.app.db.upsertEntry({ user_id: TARGET, day: "2026-10-08", mood: 5 });
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "forget" }));
    assert.equal(await t.app.db.countEntries(TARGET), 1);
    await handleInteraction(t.app, interaction(InteractionType.MessageComponent, { custom_id: "del:yes", component_type: 2 }));
    assert.equal(await t.app.db.countEntries(TARGET), 0);
  });

  test("/admin overview is owner-only", async () => {
    const t = await makeApp();
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "admin", options: [{ name: "overview", type: 1 }] }, TARGET));
    assert.match(lastCallback(t.calls).body.data.content, /للمالك/);
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "admin", options: [{ name: "overview", type: 1 }] }, OWNER));
    assert.match(lastCallback(t.calls).body.data.embeds[0].title, /لوحة المالك/);
  });
});

describe("languages, daily questions, midnight & privacy", () => {
  test("/language en switches everything to English (check-in, modal, result)", async () => {
    const t = await makeApp();
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "language", options: [{ name: "language", type: 3, value: "en" }] }));
    assert.match(lastCallback(t.calls).body.data.content, /English/);
    assert.equal((await t.app.user(TARGET)).lang, "en");
    at(t, "2026-10-09T11:30:00Z");
    await new Scheduler(t.app).tick();
    const prompt = toTarget(t)[0]!.body;
    assert.match(prompt.embeds[0].description, /How was your day\?/);
    assert.match(prompt.embeds[0].description, /Today's question/);
    assert.equal(prompt.components[0].components[0].label, "Great");
    await handleInteraction(t.app, interaction(InteractionType.MessageComponent, { custom_id: "ci:2026-10-09:4", component_type: 2 }));
    const modal = lastCallback(t.calls).body.data;
    assert.match(modal.title, /Your day was Good/);
    assert.equal(modal.components[2].components[0].custom_id, "answer");
    await handleInteraction(t.app, modalSubmit("2026-10-09", 4, { highlight: "gym", answer: "my brother's joke" }));
    const follow = t.calls.find((c) => c.method === "POST" && c.path.startsWith("/webhooks/"))!;
    assert.match(follow.body.embeds[0].title, /Your day: Good/);
    assert.ok(follow.body.embeds[0].fields.some((f: any) => f.value === "my brother's joke"), "answer shown");
    assert.match(t.claude.requests[0]!.body.messages[0].content, /English/);
  });

  test("daily question is in the check-in and its answer is saved with the question id", async () => {
    const t = await makeApp();
    at(t, "2026-10-09T11:30:00Z");
    await new Scheduler(t.app).tick();
    assert.match(toTarget(t)[0]!.body.embeds[0].description, /سؤال اليوم/);
    await handleInteraction(t.app, interaction(InteractionType.MessageComponent, { custom_id: "ci:2026-10-09:5", component_type: 2 }));
    const label = lastCallback(t.calls).body.data.components[2].components[0].label;
    await handleInteraction(t.app, modalSubmit("2026-10-09", 5, { answer: "جواب حلو" }));
    const e = (await t.app.db.getEntry(TARGET, "2026-10-09"))!;
    assert.ok(e.question, "question id saved");
    assert.equal(e.answer || e.gratitude, "جواب حلو");
    assert.ok(label.length <= 45);
  });

  test("snooze after 23:00 reminds for the SAME day and doesn't swallow the next day's check-in", async () => {
    const t = await makeApp({ env: { CHECKIN_TIME: "21:00", REMINDER_AFTER_HOURS: "0" } });
    const sch = new Scheduler(t.app);
    at(t, "2026-10-09T18:00:00Z"); // 21:00
    await sch.tick();
    at(t, "2026-10-09T20:15:00Z"); // 23:15 → snooze
    await handleInteraction(t.app, interaction(InteractionType.MessageComponent, { custom_id: "sz:2026-10-09", component_type: 2 }));
    at(t, "2026-10-09T21:16:00Z"); // 00:16 next day
    await sch.tick();
    const reminder = prompts(t)[1]!;
    assert.ok(customIds(reminder.body).includes("ci:2026-10-09:5"), "reminder is for the original day");
    assert.equal((await t.app.user(TARGET)).last_prompt_day, "2026-10-09", "next day's prompt not marked as sent");
    at(t, "2026-10-10T18:00:00Z"); // 21:00 next day
    await sch.tick();
    assert.ok(customIds(prompts(t)[2]!.body).includes("ci:2026-10-10:5"), "next day's check-in still arrives");
  });

  test("21:00 check-in + 3h reminder fires after midnight", async () => {
    const t = await makeApp({ env: { CHECKIN_TIME: "21:00", REMINDER_AFTER_HOURS: "3" } });
    const sch = new Scheduler(t.app);
    at(t, "2026-10-09T18:00:00Z");
    await sch.tick();
    at(t, "2026-10-09T21:00:00Z"); // 00:00
    await sch.tick();
    assert.equal(prompts(t).length, 2);
    assert.ok(customIds(prompts(t)[1]!.body).includes("ci:2026-10-09:3"));
  });

  test("private data is hidden outside the bot's own DM (group DM / user-install context)", async () => {
    const t = await makeApp();
    await t.app.db.upsertEntry({ user_id: TARGET, day: "2026-10-08", mood: 2, problems: "سر" });
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "history" }, TARGET, { context: 2, channel: { id: "1", type: 3 } }));
    assert.equal(lastCallback(t.calls).body.data.flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "history" }, TARGET, { context: 1 }));
    assert.equal(lastCallback(t.calls).body.data.flags & MessageFlags.Ephemeral, 0, "visible in the bot's own DM");
  });

  test("/admin backup with BACKUP_KEEP=0 is refused instead of deleting files", async () => {
    const t = await makeApp({ env: { BACKUP_KEEP: "0" } });
    await handleInteraction(t.app, interaction(InteractionType.ApplicationCommand, { name: "admin", options: [{ name: "backup", type: 1 }] }, OWNER));
    assert.match(lastCallback(t.calls).body.data.content, /مطفي/);
  });
});
