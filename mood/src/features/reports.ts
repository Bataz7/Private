/** التقارير: بناء التقرير (Embed + ملف HTML)، الإرسال التلقائي، /report /history /insights. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { APIInteraction, APIMessageComponentInteraction } from "discord-api-types/v10";
import type { MoodApp } from "../app.ts";
import type { MessagePayload } from "../discord/api.ts";
import { ButtonStyle } from "../discord/constants.ts";
import { interactionUser } from "../discord/interaction.ts";
import type { FileUpload } from "../discord/rest.ts";
import { ACCENT, mood } from "../moods.ts";
import { buildReportHTML } from "../report.ts";
import { computeStats, describeCorr, mean, type PeriodStats } from "../stats.ts";
import { addDays, arabicDate, diffDays, WEEKDAYS_AR } from "../time.ts";
import { bulletList, button, clip, row } from "../ui.ts";
import { tagsLine } from "./checkin.ts";

export const PERIODS = [
  { days: 7, label: "أسبوع" },
  { days: 30, label: "شهر" },
  { days: 90, label: "3 شهور" },
  { days: 365, label: "سنة" },
] as const;

const periodLabel = (days: number) => PERIODS.find((p) => p.days === days)?.label ?? `${days} يوم`;

export function periodStats(app: MoodApp, uid: string, start: string, end: string): PeriodStats {
  const days = diffDays(end, start) + 1;
  const entries = app.db.entriesBetween(uid, start, end);
  const prev = app.db.entriesBetween(uid, addDays(start, -days), addDays(start, -1));
  return computeStats(entries, prev, { start, end }, app.db.allDays(uid), app.today(uid));
}

/** شريط المزاج: إيموجي لكل يوم (لين 28 يوم) أو لكل أسبوع للفترات الطويلة. */
export function moodStrip(app: MoodApp, st: PeriodStats): string {
  if (!st.count) return "—";
  if (st.days <= 28) {
    const by = new Map(st.entries.map((e) => [e.day, e.mood]));
    const cells: string[] = [];
    for (let d = st.start; d <= st.end; d = addDays(d, 1)) {
      const m = by.get(d);
      cells.push(m ? app.moodEmoji(m) : "▫️");
    }
    return clip(cells.join(""), 1024);
  }
  // متوسط كل أسبوع
  const weeks: string[] = [];
  for (let s = st.start; s <= st.end; s = addDays(s, 7)) {
    const e = addDays(s, 6);
    const w = st.entries.filter((x) => x.day >= s && x.day <= e);
    weeks.push(w.length ? app.moodEmoji(mean(w.map((x) => x.mood))) : "▫️");
  }
  return clip(weeks.join(""), 1024) + "\n-# كل وجه = متوسط أسبوع";
}

export interface BuiltReport {
  payload: MessagePayload;
  file: FileUpload;
  path: string;
  stats: PeriodStats;
}

export async function buildReport(app: MoodApp, uid: string, start: string, end: string, title: string): Promise<BuiltReport> {
  const name = await app.name(uid);
  const st = periodStats(app, uid, start, end);
  const insight = await app.ai.analyze(st);
  const html = buildReportHTML({
    name,
    stats: st,
    insight,
    unlocked: app.unlocked(uid),
    title: `${title} — ${name}`,
    generatedAt: new Date(app.now()).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: app.tz(uid), dateStyle: "medium", timeStyle: "short" }),
  });

  mkdirSync(app.reportsDir, { recursive: true });
  const fileName = `mood-report-${end}-${st.days}d.html`;
  const path = join(app.reportsDir, `${uid}-${fileName}`);
  writeFileSync(path, html);

  const avgDef = mood(st.avg || 3);
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (st.count) {
    fields.push({ name: "المتوسط", value: `${app.moodEmoji(st.avg)} **${st.avg.toFixed(1)}**/5`, inline: true });
    fields.push({
      name: "مقارنة بالفترة قبل",
      value: st.delta === null ? "—" : `${st.delta > 0.05 ? "📈" : st.delta < -0.05 ? "📉" : "➖"} ${st.delta >= 0 ? "+" : ""}${st.delta.toFixed(1)}${st.changePct !== null ? ` (${st.changePct >= 0 ? "+" : ""}${st.changePct.toFixed(0)}%)` : ""}`,
      inline: true,
    });
    fields.push({ name: "أيام حلوة", value: `${st.goodPct}% · ${st.count}/${st.days} يوم`, inline: true });
    fields.push({ name: "المزاج", value: moodStrip(app, st) });
    // مجموع الـ embed لازم ≤ 6000 حرف — نقص القوائم (التفاصيل الكاملة في ملف HTML)
    if (insight.good_things.length) fields.push({ name: "🌟 اللي يحسّن مزاجك", value: bulletList(insight.good_things, 4, 600) });
    if (insight.bad_things.length) fields.push({ name: "⚡ اللي يضايقك", value: bulletList(insight.bad_things, 4, 600) });
    if (insight.tips.length) fields.push({ name: "💡 نصائح", value: bulletList(insight.tips, 3, 700) });
  }

  const payload: MessagePayload = {
    embeds: [{
      color: st.count ? avgDef.embed : ACCENT,
      title: `${app.emojis.t("mood_report")} ${title} — ${name}`,
      description: `-# ${arabicDate(start)} ← ${arabicDate(end)}\n${clip(insight.summary, 1500)}`,
      fields,
      footer: { text: `🔥 السلسلة: ${st.streak} يوم (الأفضل ${st.bestStreak}) · افتح الملف المرفق للتقرير الكامل بالرسوم` },
    }],
    components: [reportButtons(app, uid, st.days)],
  };
  return { payload, file: { name: fileName, data: html, contentType: "text/html" }, path, stats: st };
}

export function reportButtons(app: MoodApp, uid: string, active: number) {
  return row(...PERIODS.map((p) => button(`rp:${uid}:${p.days}`, p.label, {
    style: p.days === active ? ButtonStyle.Primary : ButtonStyle.Secondary,
    ...(p.days === 7 ? { emoji: app.emojis.c("mood_report") } : {}),
  })));
}

// ─────────── إرسال تلقائي ───────────

export async function sendWeekly(app: MoodApp, uid: string): Promise<void> {
  const { start, end } = app.range(uid, 7);
  const r = await buildReport(app, uid, start, end, "تقرير الأسبوع");
  await app.dm(uid, { content: "📬 تقريرك الأسبوعي وصل!", ...r.payload }, [r.file]);
  await app.notifyOwners({ content: `📬 التقرير الأسبوعي لـ <@${uid}>`, ...r.payload, components: [] }, uid, [r.file]);
  app.log.info(`weekly report sent for ${uid}`);
}

export async function sendMonthly(app: MoodApp, uid: string): Promise<void> {
  const today = app.today(uid);
  const end = addDays(today, -1);
  const start = `${end.slice(0, 7)}-01`;
  const monthName = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { month: "long", timeZone: "UTC" }).format(new Date(`${start}T12:00:00Z`));
  const r = await buildReport(app, uid, start, end, `تقرير شهر ${monthName}`);
  await app.dm(uid, { content: `🗓️ تقرير شهر ${monthName} جاهز!`, ...r.payload }, [r.file]);
  await app.notifyOwners({ content: `🗓️ التقرير الشهري لـ <@${uid}>`, ...r.payload, components: [] }, uid, [r.file]);
  app.log.info(`monthly report sent for ${uid}`);
}

// ─────────── الأوامر ───────────

function resolveTarget(app: MoodApp, i: APIInteraction, requested?: string): string | null {
  const me = interactionUser(i).id;
  const target = requested ?? (app.config.targetIds.includes(me) || app.db.countEntries(me) ? me : app.config.targetIds[0] ?? me);
  return app.canView(me, target) ? target : null;
}

export async function onReportCommand(app: MoodApp, i: APIInteraction, days: number, requested?: string) {
  const uid = resolveTarget(app, i, requested);
  if (!uid) return app.discord.reply(i, { content: "🔒 ما تقدر تشوف تقرير هالشخص." }, { ephemeral: true });
  const ephemeral = Boolean(i.guild_id);
  await app.discord.defer(i, ephemeral);
  const { start, end } = app.range(uid, days);
  const r = await buildReport(app, uid, start, end, `تقرير ${periodLabel(days)}`);
  await app.discord.editOriginal(i, r.payload, [r.file]);
}

export async function onReportButton(app: MoodApp, i: APIMessageComponentInteraction, uid: string, days: number) {
  if (!app.canView(interactionUser(i).id, uid)) return app.discord.reply(i, { content: "🔒" }, { ephemeral: true });
  await app.discord.defer(i, Boolean(i.guild_id));
  const { start, end } = app.range(uid, days);
  const r = await buildReport(app, uid, start, end, `تقرير ${periodLabel(days)}`);
  await app.discord.editOriginal(i, r.payload, [r.file]);
}

export async function onHistoryCommand(app: MoodApp, i: APIInteraction, days: number, requested?: string) {
  const uid = resolveTarget(app, i, requested);
  if (!uid) return app.discord.reply(i, { content: "🔒" }, { ephemeral: true });
  const { start, end } = app.range(uid, days);
  const rows = app.db.entriesBetween(uid, start, end).reverse();
  const lines = rows.map((e) => {
    const parts = [`${app.moodEmoji(e.mood)} **${arabicDate(e.day)}** — ${mood(e.mood).label}`];
    const meta = [e.sleep !== null ? `😴 ${e.sleep}س` : "", e.energy !== null ? `⚡ ${e.energy}/10` : "", e.tags.length ? tagsLine(e.tags) : ""].filter(Boolean).join(" · ");
    if (meta) parts.push(`-# ${meta}`);
    if (e.highlight) parts.push(`> 🌟 ${clip(e.highlight, 90)}`);
    if (e.problems) parts.push(`> ⚡ ${clip(e.problems, 90)}`);
    return parts.join("\n");
  });
  let desc = "";
  for (const l of lines) {
    if (desc.length + l.length > 3900) { desc += "\n…"; break; }
    desc += (desc ? "\n\n" : "") + l;
  }
  const name = await app.name(uid);
  await app.discord.reply(i, {
    embeds: [{ color: ACCENT, title: `🗓️ آخر ${days} يوم — ${name}`, description: desc || "ما فيه تسجيلات للحين. جرّب /checkin 🙂" }],
  }, { ephemeral: Boolean(i.guild_id) });
}

export async function onInsightsCommand(app: MoodApp, i: APIInteraction, requested?: string) {
  const uid = resolveTarget(app, i, requested);
  if (!uid) return app.discord.reply(i, { content: "🔒" }, { ephemeral: true });
  const { start, end } = app.range(uid, 90);
  const st = periodStats(app, uid, start, end);
  const name = await app.name(uid);
  if (st.count < 5) {
    return app.discord.reply(i, { content: `🔍 نحتاج 5 تسجيلات على الأقل عشان تطلع أنماط (عندك ${st.count}). كمّل! 💪` }, { ephemeral: Boolean(i.guild_id) });
  }
  const f: { name: string; value: string; inline?: boolean }[] = [];
  const up = st.tags.filter((t) => t.delta > 0.15).slice(0, 4);
  const down = st.tags.filter((t) => t.delta < -0.15).reverse().slice(0, 4);
  if (up.length) f.push({ name: "📈 يرفع مزاجك", value: up.map((t) => `${t.emoji} ${t.label} **+${t.delta.toFixed(1)}** (${t.count} مرات)`).join("\n"), inline: true });
  if (down.length) f.push({ name: "📉 ينزّل مزاجك", value: down.map((t) => `${t.emoji} ${t.label} **${t.delta.toFixed(1)}** (${t.count} مرات)`).join("\n"), inline: true });
  if (st.bestWeekday !== null) f.push({ name: "📅 أيام الأسبوع", value: `أحلى يوم: **${WEEKDAYS_AR[st.bestWeekday]}** (${st.weekdayAvg[st.bestWeekday]!.toFixed(1)})\nأصعب يوم: **${WEEKDAYS_AR[st.worstWeekday!]}** (${st.weekdayAvg[st.worstWeekday!]!.toFixed(1)})` });
  if (st.sleepAvg !== null) {
    const c = describeCorr(st.sleepCorr);
    f.push({ name: `${app.emojis.t("mood_sleep")} النوم`, value: `متوسطك ${st.sleepAvg.toFixed(1)} ساعة` + (st.sleepGood !== null && st.sleepBad !== null ? `\nبالأيام الحلوة ${st.sleepGood.toFixed(1)}س · بالسيئة ${st.sleepBad.toFixed(1)}س` : "") + (c ? `\n${c} مع المزاج` : "") });
  }
  if (st.energyAvg !== null) {
    const c = describeCorr(st.energyCorr);
    f.push({ name: `${app.emojis.t("mood_energy")} الطاقة`, value: `متوسطك ${st.energyAvg.toFixed(1)}/10${c ? ` · ${c} مع المزاج` : ""}` });
  }
  if (st.trend !== null) f.push({ name: "🧭 الاتجاه", value: st.trend > 0.05 ? `مزاجك يتحسن تقريباً **+${st.trend.toFixed(2)}** كل أسبوع 📈` : st.trend < -0.05 ? `مزاجك ينزل تقريباً **${st.trend.toFixed(2)}** كل أسبوع 📉 — انتبه لنفسك 💛` : "مزاجك ثابت تقريباً ➖" });
  f.push({ name: "🎢 التقلب", value: st.volatility < 0.7 ? "مزاجك مستقر 🧘" : st.volatility < 1.1 ? "تقلب متوسط 🌤️" : "مزاجك يتقلب كثير 🎢 — حاول تلاحظ وش يسبب القفزات" });
  await app.discord.reply(i, {
    embeds: [{ color: ACCENT, title: `🔍 أنماط مزاج ${name} (آخر 90 يوم)`, description: `-# مبني على ${st.count} تسجيل`, fields: f }],
    components: [reportButtons(app, uid, 0)],
  }, { ephemeral: Boolean(i.guild_id) });
}
