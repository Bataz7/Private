/** السؤال اليومي: الرسالة، الأزرار، النافذة، التاقات، التأجيل، التعديل. */
import type {
  APIInteraction,
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
} from "discord-api-types/v10";
import type { MoodApp } from "../app.ts";
import { isOwner } from "../config.ts";
import type { Entry } from "../db.ts";
import { ButtonStyle } from "../discord/constants.ts";
import { interactionUser, isEphemeralMessage, modalValues } from "../discord/interaction.ts";
import { ACCENT, MOODS, mood, TAGS, tagById } from "../moods.ts";
import { detectRisk } from "../safety.ts";
import { addDays, arabicDate, diffDays, toLatinDigits } from "../time.ts";
import { button, clip, row, select, textInput } from "../ui.ts";
import { checkLowMood, sendSafety } from "./alerts.ts";

// ─────────── رسالة السؤال ───────────

function greeting(hour: number): string {
  if (hour < 5) return "سهرانين؟";
  if (hour < 12) return "صباح الخير";
  if (hour < 17) return "هلا والله";
  return "مساء الخير";
}

export async function checkinMessage(app: MoodApp, uid: string, day: string, opts: { reminder?: boolean } = {}) {
  const name = await app.name(uid);
  const z = app.zonedNow(uid);
  const { streak } = app.streaks(uid);
  const yesterday = app.db.getEntry(uid, addDays(day, -1));

  const lines = [
    opts.reminder ? "تذكير لطيف 🌙 ما قلت لي للحين…" : "",
    "## كيف كان يومك؟",
    "اختر الوجه اللي يوصف يومك، وبعدها احكِ لي وش صار 💬",
  ];
  if (yesterday) lines.push(`-# أمس كان ${app.moodEmoji(yesterday.mood)} ${mood(yesterday.mood).label}`);
  if (streak >= 2) lines.push(`-# ${app.emojis.t("mood_fire")} سلسلتك ${streak} يوم — لا تقطعها!`);

  const owners = app.config.ownerIds.filter((o) => o !== uid);
  const ownerNote = owners.length ? ` · تقاريرك يطّلع عليها ${(await Promise.all(owners.map((o) => app.name(o)))).join("، ")}` : "";

  return {
    embeds: [{
      color: ACCENT,
      author: { name: `${greeting(Math.floor(z.minutes / 60))} ${name} 👋` },
      description: lines.filter(Boolean).join("\n"),
      footer: { text: `${arabicDate(day)} · إجاباتك تنحفظ في تقاريرك${ownerNote}` },
    }],
    components: moodButtons(app, day),
  };
}

export function moodButtons(app: MoodApp, day: string) {
  return [
    row(...MOODS.map((m) => button(`ci:${day}:${m.value}`, m.label, { emoji: app.emojis.c(m.key) }))),
    row(button(`sz:${day}`, "ذكّرني بعد ساعة", { emoji: { name: "⏰" } })),
  ];
}

/** يرسل السؤال اليومي في الخاص ويسجّل إنه انسأل. */
export async function sendCheckin(app: MoodApp, uid: string, opts: { reminder?: boolean } = {}): Promise<boolean> {
  const day = app.today(uid);
  if (opts.reminder) await retirePrompt(app, uid, "⏰ أرسلت لك تذكير جديد تحت 👇");
  const msg = await app.dm(uid, await checkinMessage(app, uid, day, opts));
  // نعلّم إنه انسأل حتى لو الخاص مقفل — عشان ما نعيد المحاولة كل دقيقة
  app.db.updateUser(uid, {
    last_prompt_day: day,
    ...(msg ? { last_prompt_channel: msg.channel_id, last_prompt_message: msg.id } : {}),
    ...(opts.reminder ? { last_reminder_day: day } : {}),
  });
  if (msg) app.log.info(`${opts.reminder ? "reminder" : "check-in"} sent to ${uid}`);
  return Boolean(msg);
}

/** نشيل الأزرار من رسالة السؤال القديمة (عشان ما تتكدس). */
export async function retirePrompt(app: MoodApp, uid: string, note: string): Promise<void> {
  const u = app.user(uid);
  if (!u.last_prompt_channel || !u.last_prompt_message) return;
  try {
    await app.discord.editMessage(u.last_prompt_channel, u.last_prompt_message, {
      embeds: [{ color: ACCENT, description: note }],
      components: [],
    });
  } catch {
    /* الرسالة انحذفت أو قديمة */
  }
  app.db.updateUser(uid, { last_prompt_channel: null, last_prompt_message: null });
}

// ─────────── الضغط على وجه ← نافذة التفاصيل ───────────

/**
 * اليوم اللي ينسجل له التسجيل: يوم السؤال لو خلال يومين (رد متأخر بعد منتصف الليل)،
 * أو يوم قديم لو هو تعديل لتسجيل موجود (لين 30 يوم)، وإلا اليوم الحالي.
 */
function resolveDay(app: MoodApp, uid: string, day: string): string {
  const today = app.today(uid);
  const d = diffDays(today, day);
  if (d >= 0 && d <= 2) return day;
  if (d > 2 && d <= 30 && app.db.getEntry(uid, day)) return day;
  return today;
}

export function entryModal(day: string, m: number, prev?: Entry) {
  const def = mood(m);
  const good = m >= 4;
  return {
    custom_id: `cm:${day}:${m}`,
    title: clip(`يومك كان ${def.label} ${def.fallback} — احكِ لي`, 45),
    components: [
      textInput("highlight", good ? "وش أكثر شي خلّى يومك حلو؟" : "وش أبرز شي صار اليوم؟", {
        paragraph: true, max: 600, placeholder: "طلعت مع الربع، خلصت شغلي بدري، ولا شي مميز…", value: prev?.highlight,
      }),
      textInput("problems", "فيه مشاكل أو أشياء ضايقتك؟", {
        paragraph: true, max: 600, placeholder: "اكتب اللي في خاطرك، أو خلها فاضية 🤍", value: prev?.problems,
      }),
      textInput("gratitude", "شي واحد ممتن له اليوم 🙏", { max: 150, placeholder: "أهلي، صحتي، قهوة الصبح…", value: prev?.gratitude }),
      textInput("sleep", "كم ساعة نمت؟ (اختياري)", { max: 4, placeholder: "7", value: prev?.sleep?.toString() }),
      textInput("energy", "طاقتك من 1 إلى 10 (اختياري)", { max: 2, placeholder: "6", value: prev?.energy?.toString() }),
    ],
  };
}

export async function onMoodButton(app: MoodApp, i: APIMessageComponentInteraction, day: string, m: number) {
  const uid = interactionUser(i).id;
  const d = resolveDay(app, uid, day);
  await app.discord.modal(i, entryModal(d, m, app.db.getEntry(uid, d)));
}

export async function onSnooze(app: MoodApp, i: APIMessageComponentInteraction, day: string) {
  const uid = interactionUser(i).id;
  const at = new Date(app.now().getTime() + 60 * 60_000);
  app.db.setMeta(`snooze:${uid}`, at.toISOString());
  await app.discord.update(i, {
    embeds: [{ color: ACCENT, description: `⏰ تمام! بذكّرك بعد ساعة.\n-# ${arabicDate(day)}` }],
    components: [row(...MOODS.map((x) => button(`ci:${day}:${x.value}`, "", { emoji: app.emojis.c(x.key) })))],
  });
}

export async function onEdit(app: MoodApp, i: APIMessageComponentInteraction, day: string) {
  const uid = interactionUser(i).id;
  const e = app.db.getEntry(uid, day);
  await app.discord.reply(i, {
    content: `✏️ عدّل تسجيل **${arabicDate(day)}**${e ? ` (كان ${app.moodEmoji(e.mood)} ${mood(e.mood).label})` : ""} — اختر الوجه:`,
    components: [moodButtons(app, day)[0]],
  }, { ephemeral: isEphemeralMessage(i) || Boolean(i.guild_id) });
}

// ─────────── حفظ التسجيل ───────────

export function parseNumber(raw: string | undefined, min: number, max: number, step = 0.5): number | null | "invalid" {
  const s = toLatinDigits((raw ?? "").trim()).replace(",", ".").replace(/[^\d.]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < min || n > max) return "invalid";
  return Math.round(n / step) * step;
}

export async function onEntryModal(app: MoodApp, i: APIModalSubmitInteraction, day: string, m: number) {
  const uid = interactionUser(i).id;
  const d = resolveDay(app, uid, day);
  const v = modalValues(i);
  const warnings: string[] = [];
  const sleep = parseNumber(v.get("sleep"), 0, 24);
  const energy = parseNumber(v.get("energy"), 1, 10, 1);
  if (sleep === "invalid") warnings.push("ساعات النوم لازم رقم بين 0 و 24");
  if (energy === "invalid") warnings.push("الطاقة لازم رقم من 1 إلى 10");

  const before = app.db.getEntry(uid, d);
  const entry = app.db.upsertEntry({
    user_id: uid, day: d, mood: m,
    sleep: sleep === "invalid" ? before?.sleep ?? null : sleep,
    energy: energy === "invalid" ? before?.energy ?? null : energy,
    highlight: v.get("highlight") ?? "", problems: v.get("problems") ?? "", gratitude: v.get("gratitude") ?? "",
  });
  const def = mood(m);
  const ephemeral = isEphemeralMessage(i);

  // 1) نرد فوراً (لازم خلال 3 ثواني): نحدّث رسالة السؤال ونشيل أزرارها
  const ack = { embeds: [{ color: def.embed, description: `${app.emojis.t(def.key)} سجّلت يومك: **${def.label}**${before ? " (معدّل)" : ""}\n-# ${arabicDate(d)}` }], components: [] };
  if ((i as { message?: unknown }).message) await app.discord.update(i, ack);
  else await app.discord.defer(i, ephemeral);
  const u = app.user(uid);
  if (u.last_prompt_day === d) app.db.updateUser(uid, { last_prompt_channel: null, last_prompt_message: null });
  app.db.setMeta(`snooze:${uid}`, "");
  if (i.channel?.id && !i.guild_id) void app.discord.typing(i.channel.id);

  // 2) الإنجازات والأمان والرد الذكي
  const newBadges = app.checkAchievements(uid);
  const { streak } = app.streaks(uid);
  const risk = detectRisk(entry.highlight, entry.problems, entry.gratitude);
  const recent = app.db.entriesBetween(uid, addDays(d, -14), addDays(d, -1));
  const reply = await app.ai.replyToEntry(entry, recent, { streak, newBadges: newBadges.map((b) => b.title) });
  app.db.setAiReply(uid, d, reply);

  // 3) رسالة النتيجة + اختيار الأنشطة
  await app.discord.followup(i, entryResult(app, entry, reply, { streak, newBadges: newBadges.map((b) => `${b.emoji} **${b.title}** — ${b.description}`), warnings }), { ephemeral });

  if (risk) await sendSafety(app, uid, "entry");
  await checkLowMood(app, uid);

  if (app.config.notifyOwner && !isOwner(app.config, uid)) {
    const name = await app.name(uid);
    await app.notifyOwners({
      embeds: [{ color: def.embed, description: `${app.emojis.t(def.key)} **${name}** سجّل يومه: **${def.label}**\n-# التفاصيل في /report`, }],
    }, uid);
  }
}

export function entryResult(app: MoodApp, e: Entry, reply: string, x: { streak: number; newBadges: string[]; warnings?: string[] }) {
  const def = mood(e.mood);
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (e.highlight) fields.push({ name: "🌟 أبرز شي", value: clip(e.highlight, 1024) });
  if (e.problems) fields.push({ name: "⚡ اللي ضايقك", value: clip(e.problems, 1024) });
  if (e.gratitude) fields.push({ name: `${app.emojis.t("mood_heart")} ممتن لـ`, value: clip(e.gratitude, 1024) });
  if (e.sleep !== null) fields.push({ name: `${app.emojis.t("mood_sleep")} النوم`, value: `${e.sleep} ساعة`, inline: true });
  if (e.energy !== null) fields.push({ name: `${app.emojis.t("mood_energy")} الطاقة`, value: `${e.energy}/10`, inline: true });
  if (e.tags.length) fields.push({ name: "🏷️ الأنشطة", value: tagsLine(e.tags) });
  if (x.newBadges.length) fields.push({ name: `${app.emojis.t("mood_trophy")} إنجاز جديد!`, value: x.newBadges.join("\n") });
  if (x.warnings?.length) fields.push({ name: "⚠️ ملاحظة", value: x.warnings.join("\n") });

  return {
    embeds: [{
      color: def.embed,
      title: `${def.fallback} يومك: ${def.label}`,
      description: clip(reply, 2000), // مجموع الـ embed لازم ≤ 6000 حرف
      fields,
      footer: { text: `🔥 سلسلة التسجيل: ${x.streak} يوم · وش سويت اليوم؟ اختر من القائمة 👇` },
    }],
    components: [
      row(tagSelect(e)),
      row(
        button(`ed:${e.day}`, "تعديل", { emoji: { name: "✏️" } }),
        button(`rp:${e.user_id}:7`, "تقرير الأسبوع", { emoji: app.emojis.c("mood_report"), style: ButtonStyle.Primary }),
      ),
    ],
  };
}

export function tagsLine(tags: string[]): string {
  return tags.map((t) => tagById(t)).filter(Boolean).map((t) => `${t!.emoji} ${t!.label}`).join(" · ") || "—";
}

function tagSelect(e: Entry) {
  return select(`tg:${e.day}`, "🏷️ وش سويت اليوم؟ (تقدر تختار أكثر من واحد)",
    TAGS.map((t) => ({ label: t.label, value: t.id, emoji: { name: t.emoji }, default: e.tags.includes(t.id) })), 0);
}

export async function onTags(app: MoodApp, i: APIMessageComponentInteraction, day: string) {
  const uid = interactionUser(i).id;
  const values = ((i.data as { values?: string[] }).values ?? []).filter((v) => tagById(v));
  const e = app.db.getEntry(uid, day);
  if (!e) return app.discord.reply(i, { content: "ما لقيت تسجيل هاليوم 🤔" }, { ephemeral: true });
  app.db.setTags(uid, day, values);
  const updated = app.db.getEntry(uid, day)!;
  const newBadges = app.checkAchievements(uid);

  // نحدّث نفس الرسالة: حقل الأنشطة + القائمة
  const msg = i.message;
  const embed = { ...(msg.embeds[0] ?? {}) } as { fields?: { name: string; value: string; inline?: boolean }[]; footer?: unknown };
  const fields = (embed.fields ?? []).filter((f) => !f.name.includes("الأنشطة"));
  if (values.length) fields.push({ name: "🏷️ الأنشطة", value: tagsLine(values) });
  for (const b of newBadges) fields.push({ name: `${app.emojis.t("mood_trophy")} إنجاز جديد!`, value: `${b.emoji} **${b.title}** — ${b.description}` });
  embed.fields = fields;
  embed.footer = { text: values.length ? `🏷️ حفظت ${values.length} نشاط ✓ — كذا التقارير تعرف وش يأثر على مزاجك` : "🏷️ وش سويت اليوم؟ اختر من القائمة 👇" };
  await app.discord.update(i, { embeds: [embed], components: [row(tagSelect(updated)), ...msg.components!.slice(1)] });
}

export async function onCheckinCommand(app: MoodApp, i: APIInteraction, targetId?: string) {
  const uid = interactionUser(i).id;
  if (targetId && targetId !== uid) {
    if (!isOwner(app.config, uid)) return app.discord.reply(i, { content: "🔒 بس المالك يقدر يرسل السؤال لغيره." }, { ephemeral: true });
    await app.discord.defer(i, true);
    const ok = await sendCheckin(app, targetId);
    return app.discord.editOriginal(i, { content: ok ? `📨 أرسلت السؤال لـ <@${targetId}> في الخاص.` : `⚠️ ما قدرت أرسل لـ <@${targetId}> — الخاص مقفل؟` });
  }
  const day = app.today(uid);
  const msg = await checkinMessage(app, uid, day);
  await app.discord.reply(i, msg, { ephemeral: Boolean(i.guild_id) });
}
