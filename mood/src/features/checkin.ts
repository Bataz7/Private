/** السؤال اليومي: الرسالة، الأزرار، النافذة (مع سؤال اليوم)، التاقات، التأجيل، التعديل. */
import type { APIInteraction, APIMessageComponentInteraction, APIModalSubmitInteraction } from "discord-api-types/v10";
import type { MoodApp } from "../app.ts";
import { isOwner } from "../config.ts";
import { ButtonStyle } from "../discord/constants.ts";
import { interactionUser, isEphemeralMessage, modalValues, shouldHide } from "../discord/interaction.ts";
import { L, type Lang } from "../i18n.ts";
import { ACCENT, MOODS, mood, TAGS, tagById } from "../moods.ts";
import { GRATITUDE, questionById, questionFor, questionText, type Question } from "../questions.ts";
import { detectRisk } from "../safety.ts";
import type { Entry } from "../store/types.ts";
import { addDays, diffDays, localDate, toLatinDigits } from "../time.ts";
import { button, clip, row, select, textInput } from "../ui.ts";
import { checkLowMood, sendSafety } from "./alerts.ts";

// ─────────── رسالة السؤال ───────────

export async function checkinMessage(app: MoodApp, uid: string, day: string, opts: { reminder?: boolean } = {}) {
  const u = await app.user(uid);
  const lang = app.langOf(u);
  const t = L(lang);
  const name = await app.name(uid);
  const z = app.zonedFor(u);
  const { streak } = await app.streaks(uid);
  const yesterday = await app.db.getEntry(uid, addDays(day, -1));
  const q = questionFor(uid, day);

  const lines = [opts.reminder ? t.reminderLine : "", t.howWasDay, t.pickFace].filter(Boolean);
  lines.push("", t.questionOfDay(questionText(q, lang)));
  if (yesterday) lines.push(t.yesterdayWas(`${app.moodEmoji(yesterday.mood)} ${mood(yesterday.mood).label[lang]}`));
  if (streak >= 2) lines.push(t.streakLine(app.emojis.t("mood_fire"), streak));

  const owners = app.config.ownerIds.filter((o) => o !== uid);
  const ownerNames = owners.length ? (await Promise.all(owners.map((o) => app.name(o)))).join(lang === "en" ? ", " : "، ") : "";

  return {
    embeds: [{
      color: ACCENT,
      author: { name: `${t.greet(Math.floor(z.minutes / 60))} ${name} 👋` },
      description: lines.join("\n"),
      footer: { text: t.checkinFooter(localDate(day, lang), ownerNames) },
    }],
    components: moodButtons(app, day, lang),
  };
}

export function moodButtons(app: MoodApp, day: string, lang: Lang) {
  return [
    row(...MOODS.map((m) => button(`ci:${day}:${m.value}`, m.label[lang], { emoji: app.emojis.c(m.key) }))),
    row(button(`sz:${day}`, L(lang).remindMe, { emoji: { name: "⏰" } })),
  ];
}

/**
 * يرسل السؤال في الخاص.
 * - السؤال العادي يسجّل last_prompt_day/at (عشان التذكير يعرف متى انسأل).
 * - التذكير/التأجيل يسجّل last_reminder_day بس — وما يلمس يوم ثاني (إصلاح منتصف الليل).
 */
export async function sendCheckin(app: MoodApp, uid: string, opts: { reminder?: boolean; day?: string } = {}): Promise<boolean> {
  const day = opts.day ?? (await app.today(uid));
  if (opts.reminder) await retirePrompt(app, uid, (await app.t(uid)).retiredPrompt);
  const msg = await app.dm(uid, await checkinMessage(app, uid, day, opts));
  const ids = msg ? { last_prompt_channel: msg.channel_id, last_prompt_message: msg.id } : {};
  if (opts.reminder) await app.db.updateUser(uid, { last_reminder_day: day, ...ids });
  else await app.db.updateUser(uid, { last_prompt_day: day, last_prompt_at: app.now().toISOString(), ...ids });
  if (msg) app.log.info(`${opts.reminder ? "reminder" : "check-in"} for ${day} sent to ${uid}`);
  return Boolean(msg);
}

/** نشيل الأزرار من رسالة السؤال القديمة (عشان ما تتكدس). */
export async function retirePrompt(app: MoodApp, uid: string, note: string): Promise<void> {
  const u = await app.user(uid);
  if (!u.last_prompt_channel || !u.last_prompt_message) return;
  try {
    await app.discord.editMessage(u.last_prompt_channel, u.last_prompt_message, { embeds: [{ color: ACCENT, description: note }], components: [] });
  } catch {
    /* الرسالة انحذفت أو قديمة */
  }
  await app.db.updateUser(uid, { last_prompt_channel: null, last_prompt_message: null });
}

// ─────────── الضغط على وجه ← نافذة التفاصيل ───────────

/**
 * اليوم اللي ينسجل له التسجيل: يوم السؤال لو خلال يومين (رد متأخر بعد منتصف الليل)،
 * أو يوم قديم لو هو تعديل لتسجيل موجود (لين 30 يوم)، وإلا اليوم الحالي.
 */
async function resolveDay(app: MoodApp, uid: string, day: string): Promise<string> {
  const today = await app.today(uid);
  const d = diffDays(today, day);
  if (d >= 0 && d <= 2) return day;
  if (d > 2 && d <= 30 && (await app.db.getEntry(uid, day))) return day;
  return today;
}

/** سؤال اليوم للتسجيل (لو التسجيل قديم وفيه سؤال محفوظ نستخدمه). */
function entryQuestion(uid: string, day: string, prev?: Entry): Question {
  return (prev?.question && questionById(prev.question)) || questionFor(uid, day);
}

export function entryModal(day: string, m: number, lang: Lang, q: Question, prev?: Entry) {
  const t = L(lang);
  const def = mood(m);
  const prevAnswer = q.id === GRATITUDE.id ? prev?.gratitude || prev?.answer : prev?.answer;
  return {
    custom_id: `cm:${day}:${m}`,
    title: clip(t.modalTitle(def.label[lang], def.fallback), 45),
    components: [
      textInput("highlight", m >= 4 ? t.fieldHighlightGood : t.fieldHighlight, { paragraph: true, max: 600, placeholder: t.phHighlight, value: prev?.highlight }),
      textInput("problems", t.fieldProblems, { paragraph: true, max: 600, placeholder: t.phProblems, value: prev?.problems }),
      textInput("answer", questionText(q, lang), { paragraph: true, max: 400, placeholder: t.phAnswer, value: prevAnswer }),
      textInput("sleep", t.fieldSleep, { max: 4, placeholder: "7", value: prev?.sleep?.toString() }),
      textInput("energy", t.fieldEnergy, { max: 2, placeholder: "6", value: prev?.energy?.toString() }),
    ],
  };
}

export async function onMoodButton(app: MoodApp, i: APIMessageComponentInteraction, day: string, m: number) {
  const uid = interactionUser(i).id;
  const d = await resolveDay(app, uid, day);
  const prev = await app.db.getEntry(uid, d);
  await app.discord.modal(i, entryModal(d, m, await app.lang(uid), entryQuestion(uid, d, prev), prev));
}

export async function onSnooze(app: MoodApp, i: APIMessageComponentInteraction, day: string) {
  const uid = interactionUser(i).id;
  const lang = await app.lang(uid);
  const at = new Date(app.now().getTime() + 60 * 60_000);
  // نحفظ اليوم مع الوقت عشان التذكير يكون لنفس اليوم حتى لو عدّى منتصف الليل
  await app.db.setMeta(`snooze:${uid}`, `${day}|${at.toISOString()}`);
  await app.discord.update(i, {
    embeds: [{ color: ACCENT, description: L(lang).snoozed(localDate(day, lang)) }],
    components: [row(...MOODS.map((x) => button(`ci:${day}:${x.value}`, "", { emoji: app.emojis.c(x.key) })))],
  });
}

export function parseSnooze(v: string | undefined): { day: string; at: number } | null {
  if (!v) return null;
  const [day, iso] = v.split("|");
  const at = Date.parse(iso ?? "");
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(at) ? { day, at } : null;
}

export async function onEdit(app: MoodApp, i: APIMessageComponentInteraction, day: string) {
  const uid = interactionUser(i).id;
  const lang = await app.lang(uid);
  const e = await app.db.getEntry(uid, day);
  await app.discord.reply(i, {
    content: L(lang).editPrompt(localDate(day, lang), e ? `${app.moodEmoji(e.mood)} ${mood(e.mood).label[lang]}` : ""),
    components: [moodButtons(app, day, lang)[0]],
  }, { ephemeral: isEphemeralMessage(i) || shouldHide(i) });
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
  const lang = await app.lang(uid);
  const t = L(lang);
  const d = await resolveDay(app, uid, day);
  const v = modalValues(i);
  const warnings: string[] = [];
  const sleep = parseNumber(v.get("sleep"), 0, 24);
  const energy = parseNumber(v.get("energy"), 1, 10, 1);
  if (sleep === "invalid") warnings.push(t.badSleep);
  if (energy === "invalid") warnings.push(t.badEnergy);

  const before = await app.db.getEntry(uid, d);
  const q = entryQuestion(uid, d, before);
  const answer = (v.get("answer") ?? v.get("gratitude") ?? "").trim();
  const isGratitude = q.id === GRATITUDE.id;
  const def = mood(m);
  const ephemeral = isEphemeralMessage(i) || shouldHide(i);

  // 1) نرد فوراً (لازم خلال 3 ثواني): نحدّث رسالة السؤال ونشيل أزرارها
  const ack = { embeds: [{ color: def.embed, description: t.logged(app.emojis.t(def.key), def.label[lang], Boolean(before), localDate(d, lang)) }], components: [] };
  if ((i as { message?: unknown }).message) await app.discord.update(i, ack);
  else await app.discord.defer(i, ephemeral);

  const entry = await app.db.upsertEntry({
    user_id: uid, day: d, mood: m,
    sleep: sleep === "invalid" ? before?.sleep ?? null : sleep,
    energy: energy === "invalid" ? before?.energy ?? null : energy,
    highlight: v.get("highlight") ?? "", problems: v.get("problems") ?? "",
    gratitude: isGratitude ? answer : before?.gratitude ?? "",
    question: q.id, answer: isGratitude ? "" : answer,
  });
  const u = await app.user(uid);
  if (u.last_prompt_day === d) await app.db.updateUser(uid, { last_prompt_channel: null, last_prompt_message: null });
  if (parseSnooze(await app.db.getMeta(`snooze:${uid}`))?.day === d) await app.db.setMeta(`snooze:${uid}`, "");
  if (i.channel?.id && !i.guild_id) void app.discord.typing(i.channel.id);

  // 2) الإنجازات والأمان والرد الذكي
  const newBadges = await app.checkAchievements(uid);
  const { streak } = await app.streaks(uid);
  const risk = detectRisk(entry.highlight, entry.problems, entry.gratitude, entry.answer);
  const recent = await app.db.entriesBetween(uid, addDays(d, -14), addDays(d, -1));
  const reply = await app.ai.replyToEntry(entry, recent, { streak, newBadges: newBadges.map((b) => b.title[lang]), lang });
  await app.db.setAiReply(uid, d, reply);

  // 3) رسالة النتيجة + اختيار الأنشطة
  await app.discord.followup(i, entryResult(app, entry, reply, lang, {
    streak, warnings, newBadges: newBadges.map((b) => `${b.emoji} **${b.title[lang]}** — ${b.description[lang]}`),
  }), { ephemeral });

  if (risk) await sendSafety(app, uid, "entry");
  await checkLowMood(app, uid);

  if (app.config.notifyOwner && !isOwner(app.config, uid)) {
    const name = await app.name(uid);
    await app.notifyOwners((tt, ll) => ({ embeds: [{ color: def.embed, description: tt.ownerNotify(app.emojis.t(def.key), name, def.label[ll]) }] }), uid);
  }
}

export function entryResult(app: MoodApp, e: Entry, reply: string, lang: Lang, x: { streak: number; newBadges: string[]; warnings?: string[] }) {
  const t = L(lang);
  const def = mood(e.mood);
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (e.highlight) fields.push({ name: t.fHighlight, value: clip(e.highlight, 1024) });
  if (e.problems) fields.push({ name: t.fProblems, value: clip(e.problems, 1024) });
  const q = e.question ? questionById(e.question) : undefined;
  if (e.answer && q) fields.push({ name: clip(`💭 ${questionText(q, lang)}`, 256), value: clip(e.answer, 1024) });
  if (e.gratitude) fields.push({ name: t.fGratitude(app.emojis.t("mood_heart")), value: clip(e.gratitude, 1024) });
  if (e.sleep !== null) fields.push({ name: t.fSleep(app.emojis.t("mood_sleep")), value: t.sleepVal(e.sleep), inline: true });
  if (e.energy !== null) fields.push({ name: t.fEnergy(app.emojis.t("mood_energy")), value: `${e.energy}/10`, inline: true });
  if (e.tags.length) fields.push({ name: t.fTags, value: tagsLine(e.tags, lang) });
  if (x.newBadges.length) fields.push({ name: t.fNewBadge(app.emojis.t("mood_trophy")), value: clip(x.newBadges.join("\n"), 1024) });
  if (x.warnings?.length) fields.push({ name: t.fNote, value: x.warnings.join("\n") });

  return {
    embeds: [{
      color: def.embed,
      title: t.resultTitle(def.fallback, def.label[lang]),
      description: clip(reply, 1800), // مجموع الـ embed لازم ≤ 6000 حرف
      fields,
      footer: { text: t.resultFooter(x.streak) },
    }],
    components: [
      row(tagSelect(e, lang)),
      row(
        button(`ed:${e.day}`, t.edit, { emoji: { name: "✏️" } }),
        button(`rp:${e.user_id}:7`, t.weekReport, { emoji: app.emojis.c("mood_report"), style: ButtonStyle.Primary }),
      ),
    ],
  };
}

export function tagsLine(tags: string[], lang: Lang): string {
  return tags.map((x) => tagById(x)).filter(Boolean).map((x) => `${x!.emoji} ${x!.label[lang]}`).join(" · ") || "—";
}

function tagSelect(e: Entry, lang: Lang) {
  return select(`tg:${e.day}`, L(lang).tagPlaceholder,
    TAGS.map((x) => ({ label: x.label[lang], value: x.id, emoji: { name: x.emoji }, default: e.tags.includes(x.id) })), 0);
}

export async function onTags(app: MoodApp, i: APIMessageComponentInteraction, day: string) {
  const uid = interactionUser(i).id;
  const lang = await app.lang(uid);
  const t = L(lang);
  const values = ((i.data as { values?: string[] }).values ?? []).filter((v) => tagById(v));
  const e = await app.db.getEntry(uid, day);
  if (!e) return app.discord.reply(i, { content: t.noEntryForDay }, { ephemeral: true });
  await app.db.setTags(uid, day, values);
  const updated = (await app.db.getEntry(uid, day))!;
  const newBadges = await app.checkAchievements(uid);

  // نحدّث نفس الرسالة: حقل الأنشطة + القائمة
  const msg = i.message;
  const embed = { ...(msg.embeds[0] ?? {}) } as { fields?: { name: string; value: string; inline?: boolean }[]; footer?: unknown };
  const fields = (embed.fields ?? []).filter((f) => f.name !== t.fTags);
  if (values.length) fields.push({ name: t.fTags, value: tagsLine(values, lang) });
  for (const b of newBadges) fields.push({ name: t.fNewBadge(app.emojis.t("mood_trophy")), value: `${b.emoji} **${b.title[lang]}** — ${b.description[lang]}` });
  embed.fields = fields.slice(0, 25);
  embed.footer = { text: values.length ? t.tagsSaved(values.length) : t.tagsPrompt };
  await app.discord.update(i, { embeds: [embed], components: [row(tagSelect(updated, lang)), ...(msg.components ?? []).slice(1)] });
}

export async function onCheckinCommand(app: MoodApp, i: APIInteraction, targetId?: string) {
  const uid = interactionUser(i).id;
  const t = await app.t(uid);
  if (targetId && targetId !== uid) {
    if (!isOwner(app.config, uid)) return app.discord.reply(i, { content: t.ownerOnlySend }, { ephemeral: true });
    await app.discord.defer(i, true);
    const ok = await sendCheckin(app, targetId);
    return app.discord.editOriginal(i, { content: ok ? t.sentTo(targetId) : t.cantSendTo(targetId) });
  }
  const day = await app.today(uid);
  await app.discord.reply(i, await checkinMessage(app, uid, day), { ephemeral: shouldHide(i) });
}
