/** التقارير: بناء التقرير (Embed + ملف HTML)، الإرسال التلقائي، /report /history /insights. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { APIInteraction, APIMessageComponentInteraction } from "discord-api-types/v10";
import type { MoodApp } from "../app.ts";
import type { MessagePayload } from "../discord/api.ts";
import { ButtonStyle } from "../discord/constants.ts";
import { interactionUser, shouldHide } from "../discord/interaction.ts";
import type { FileUpload } from "../discord/rest.ts";
import { L, type Lang, type Messages } from "../i18n.ts";
import { ACCENT, mood } from "../moods.ts";
import { buildReportHTML } from "../report.ts";
import { computeStats, describeCorr, mean, type PeriodStats } from "../stats.ts";
import { addDays, diffDays, localDate, monthName, WEEKDAYS } from "../time.ts";
import { bulletList, button, clip, row } from "../ui.ts";
import { tagsLine } from "./checkin.ts";

export const PERIODS = [7, 30, 90, 365] as const;

export async function periodStats(app: MoodApp, uid: string, start: string, end: string): Promise<PeriodStats> {
  const days = diffDays(end, start) + 1;
  const [entries, prev, allDays, today] = await Promise.all([
    app.db.entriesBetween(uid, start, end),
    app.db.entriesBetween(uid, addDays(start, -days), addDays(start, -1)),
    app.db.allDays(uid),
    app.today(uid),
  ]);
  return computeStats(entries, prev, { start, end }, allDays, today);
}

/**
 * شريط المزاج: إيموجي لكل يوم (لين 28 يوم) أو لكل أسبوع للفترات الطويلة.
 * لو طلع أطول من حد الحقل (1024) نستخدم الإيموجي العادي الأقصر بدل الخاص.
 */
export function moodStrip(app: MoodApp, st: PeriodStats, lang: Lang): string {
  if (!st.count) return "—";
  const cells: number[] = [];
  let note = "";
  if (st.days <= 28) {
    const by = new Map(st.entries.map((e) => [e.day, e.mood]));
    for (let d = st.start; d <= st.end; d = addDays(d, 1)) cells.push(by.get(d) ?? 0);
  } else {
    for (let s = st.start; s <= st.end; s = addDays(s, 7)) {
      const e = addDays(s, 6);
      const w = st.entries.filter((x) => x.day >= s && x.day <= e);
      cells.push(w.length ? Math.round(mean(w.map((x) => x.mood))) : 0);
    }
    note = `\n${L(lang).weekAvgNote}`;
  }
  const render = (custom: boolean) => cells.map((m) => (m ? (custom ? app.moodEmoji(m) : mood(m).fallback) : "▫️")).join("");
  const max = 1024 - note.length;
  let s = render(true);
  if (s.length > max) s = render(false);
  if (s.length > max) s = [...s].slice(0, max / 2).join(""); // نقص على حدود الإيموجي، مو بنصه
  return s + note;
}

export interface BuiltReport {
  payload: MessagePayload;
  file: FileUpload;
  path: string;
  stats: PeriodStats;
}

/** يبني التقرير بلغة القارئ (viewer) عن بيانات الشخص (uid). */
export async function buildReport(app: MoodApp, uid: string, start: string, end: string, title: (lang: Lang) => string, viewer = uid): Promise<BuiltReport> {
  const lang = await app.lang(viewer);
  const t = L(lang);
  const name = await app.name(uid);
  const st = await periodStats(app, uid, start, end);
  const insight = await app.ai.analyze(st, lang);
  const heading = title(lang);
  const html = buildReportHTML({
    name, stats: st, insight, lang,
    unlocked: await app.unlocked(uid),
    title: `${heading} — ${name}`,
    generatedAt: app.now().toLocaleString(lang === "en" ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn", { timeZone: app.tzOf(await app.user(uid)), dateStyle: "medium", timeStyle: "short" }),
  });

  mkdirSync(app.reportsDir, { recursive: true });
  const fileName = `mood-report-${end}-${st.days}d.html`;
  const path = join(app.reportsDir, `${uid}-${lang}-${fileName}`);
  writeFileSync(path, html);

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (st.count) {
    fields.push({ name: t.fAvg, value: `${app.moodEmoji(st.avg)} **${st.avg.toFixed(1)}**/5`, inline: true });
    fields.push({
      name: t.fVsPrev,
      value: st.delta === null ? "—" : `${st.delta > 0.05 ? "📈" : st.delta < -0.05 ? "📉" : "➖"} ${st.delta >= 0 ? "+" : ""}${st.delta.toFixed(1)}${st.changePct !== null ? ` (${st.changePct >= 0 ? "+" : ""}${st.changePct.toFixed(0)}%)` : ""}`,
      inline: true,
    });
    fields.push({ name: t.fGoodDays, value: t.goodDaysVal(st.goodPct, st.count, st.days), inline: true });
    fields.push({ name: t.fMood, value: moodStrip(app, st, lang) });
    // مجموع الـ embed لازم ≤ 6000 حرف — نقص القوائم (التفاصيل الكاملة في ملف HTML)
    if (insight.good_things.length) fields.push({ name: t.fLiftsMood, value: bulletList(insight.good_things, 4, 600) });
    if (insight.bad_things.length) fields.push({ name: t.fLowersMood, value: bulletList(insight.bad_things, 4, 600) });
    if (insight.tips.length) fields.push({ name: t.fTips, value: bulletList(insight.tips, 3, 700) });
  }

  const payload: MessagePayload = {
    embeds: [{
      color: st.count ? mood(st.avg).embed : ACCENT,
      title: clip(`${app.emojis.t("mood_report")} ${heading} — ${name}`, 256),
      description: `-# ${localDate(start, lang)} ← ${localDate(end, lang)}\n${clip(insight.summary, 1500)}`,
      fields,
      footer: { text: t.reportFooter(st.streak, st.bestStreak) },
    }],
    components: [reportButtons(app, uid, st.days, lang)],
  };
  return { payload, file: { name: fileName, data: html, contentType: "text/html" }, path, stats: st };
}

export function reportButtons(app: MoodApp, uid: string, active: number, lang: Lang) {
  return row(...PERIODS.map((d) => button(`rp:${uid}:${d}`, L(lang).period(d), {
    style: d === active ? ButtonStyle.Primary : ButtonStyle.Secondary,
    ...(d === 7 ? { emoji: app.emojis.c("mood_report") } : {}),
  })));
}

// ─────────── إرسال تلقائي ───────────

type Intro = (t: Messages, lang: Lang, self: boolean) => string;

/** يرسل التقرير للشخص، ونسخة لكل مالك — كل واحد بلغته. */
async function deliver(app: MoodApp, uid: string, start: string, end: string, title: (l: Lang) => string, intro: Intro): Promise<void> {
  const uLang = await app.lang(uid);
  const cache = new Map<Lang, BuiltReport>();
  const get = async (lang: Lang, viewer: string) => {
    let r = cache.get(lang);
    if (!r) {
      r = await buildReport(app, uid, start, end, title, viewer);
      cache.set(lang, r);
    }
    return r;
  };
  const mine = await get(uLang, uid);
  await app.dm(uid, { content: intro(L(uLang), uLang, true), ...mine.payload }, [mine.file]);
  for (const oid of app.config.ownerIds) {
    if (oid === uid) continue;
    const oLang = await app.lang(oid);
    const r = await get(oLang, oid);
    try {
      await app.discord.sendDM(oid, { content: intro(L(oLang), oLang, false).replace("{uid}", uid), ...r.payload, components: [] }, [r.file]);
    } catch (e) {
      app.log.warn(`could not send report to owner ${oid}:`, (e as Error).message);
    }
  }
}

export async function sendWeekly(app: MoodApp, uid: string): Promise<void> {
  const { start, end } = await app.range(uid, 7);
  await deliver(app, uid, start, end, (l) => L(l).periodTitle(7), (t, _l, self) => (self ? t.weeklyArrived : t.weeklyForOwner(uid)));
  app.log.info(`weekly report sent for ${uid}`);
}

export async function sendMonthly(app: MoodApp, uid: string): Promise<void> {
  const end = addDays(await app.today(uid), -1);
  const start = `${end.slice(0, 7)}-01`;
  await deliver(app, uid, start, end, (l) => L(l).monthTitle(monthName(start, l)), (t, l, self) => (self ? t.monthlyArrived(monthName(start, l)) : t.monthlyForOwner(uid)));
  app.log.info(`monthly report sent for ${uid}`);
}

// ─────────── الأوامر ───────────

async function resolveTarget(app: MoodApp, i: APIInteraction, requested?: string): Promise<string | null> {
  const me = interactionUser(i).id;
  const target = requested ?? (app.config.targetIds.includes(me) || (await app.db.countEntries(me)) ? me : app.config.targetIds[0] ?? me);
  return app.canView(me, target) ? target : null;
}

export async function onReportCommand(app: MoodApp, i: APIInteraction, days: number, requested?: string) {
  const me = interactionUser(i).id;
  const uid = await resolveTarget(app, i, requested);
  if (!uid) return app.discord.reply(i, { content: (await app.t(me)).noAccess }, { ephemeral: true });
  await app.discord.defer(i, shouldHide(i));
  const { start, end } = await app.range(uid, days);
  const r = await buildReport(app, uid, start, end, (l) => L(l).periodTitle(days), me);
  await app.discord.editOriginal(i, r.payload, [r.file]);
}

export async function onReportButton(app: MoodApp, i: APIMessageComponentInteraction, uid: string, days: number) {
  const me = interactionUser(i).id;
  if (!app.canView(me, uid)) return app.discord.reply(i, { content: (await app.t(me)).noAccess }, { ephemeral: true });
  await app.discord.defer(i, shouldHide(i));
  const { start, end } = await app.range(uid, days);
  const r = await buildReport(app, uid, start, end, (l) => L(l).periodTitle(days), me);
  await app.discord.editOriginal(i, r.payload, [r.file]);
}

export async function onHistoryCommand(app: MoodApp, i: APIInteraction, days: number, requested?: string) {
  const me = interactionUser(i).id;
  const lang = await app.lang(me);
  const t = L(lang);
  const uid = await resolveTarget(app, i, requested);
  if (!uid) return app.discord.reply(i, { content: t.noAccess }, { ephemeral: true });
  const { start, end } = await app.range(uid, days);
  const rows = (await app.db.entriesBetween(uid, start, end)).reverse();
  const lines = rows.map((e) => {
    const parts = [`${app.moodEmoji(e.mood)} **${localDate(e.day, lang)}** — ${mood(e.mood).label[lang]}`];
    const meta = [e.sleep !== null ? t.sleepShort(e.sleep) : "", e.energy !== null ? `⚡ ${e.energy}/10` : "", e.tags.length ? tagsLine(e.tags, lang) : ""].filter(Boolean).join(" · ");
    if (meta) parts.push(`-# ${meta}`);
    if (e.highlight) parts.push(`> 🌟 ${clip(e.highlight, 90)}`);
    if (e.problems) parts.push(`> ⚡ ${clip(e.problems, 90)}`);
    if (e.answer || e.gratitude) parts.push(`> 💭 ${clip(e.answer || e.gratitude, 90)}`);
    return parts.join("\n");
  });
  let desc = "";
  for (const l of lines) {
    if (desc.length + l.length > 3900) { desc += "\n…"; break; }
    desc += (desc ? "\n\n" : "") + l;
  }
  await app.discord.reply(i, {
    embeds: [{ color: ACCENT, title: t.historyTitle(days, await app.name(uid)), description: desc || t.historyEmpty }],
  }, { ephemeral: shouldHide(i) });
}

export async function onInsightsCommand(app: MoodApp, i: APIInteraction, requested?: string) {
  const me = interactionUser(i).id;
  const lang = await app.lang(me);
  const t = L(lang);
  const uid = await resolveTarget(app, i, requested);
  if (!uid) return app.discord.reply(i, { content: t.noAccess }, { ephemeral: true });
  const { start, end } = await app.range(uid, 90);
  const st = await periodStats(app, uid, start, end);
  const name = await app.name(uid);
  const hide = shouldHide(i);
  if (st.count < 5) return app.discord.reply(i, { content: t.insightsNeed(st.count) }, { ephemeral: hide });

  const wd = WEEKDAYS[lang];
  const f: { name: string; value: string; inline?: boolean }[] = [];
  const up = st.tags.filter((x) => x.delta > 0.15).slice(0, 4);
  const down = st.tags.filter((x) => x.delta < -0.15).reverse().slice(0, 4);
  if (up.length) f.push({ name: t.fLifts, value: up.map((x) => `${x.emoji} ${x.label[lang]} **+${x.delta.toFixed(1)}** ${t.times(x.count)}`).join("\n"), inline: true });
  if (down.length) f.push({ name: t.fLowers, value: down.map((x) => `${x.emoji} ${x.label[lang]} **${x.delta.toFixed(1)}** ${t.times(x.count)}`).join("\n"), inline: true });
  if (st.bestWeekday !== null) {
    f.push({ name: t.fWeekdays, value: t.weekdaysVal(wd[st.bestWeekday]!, st.weekdayAvg[st.bestWeekday]!.toFixed(1), wd[st.worstWeekday!]!, st.weekdayAvg[st.worstWeekday!]!.toFixed(1)) });
  }
  if (st.sleepAvg !== null) {
    const c = describeCorr(st.sleepCorr, lang);
    f.push({ name: t.fSleepI(app.emojis.t("mood_sleep")), value: [t.sleepAvgLine(st.sleepAvg.toFixed(1)), st.sleepGood !== null && st.sleepBad !== null ? t.sleepGoodBad(st.sleepGood.toFixed(1), st.sleepBad.toFixed(1)) : "", c ? t.withMood(c) : ""].filter(Boolean).join("\n") });
  }
  if (st.energyAvg !== null) {
    const c = describeCorr(st.energyCorr, lang);
    f.push({ name: t.fEnergyI(app.emojis.t("mood_energy")), value: t.energyAvgLine(st.energyAvg.toFixed(1)) + (c ? ` · ${t.withMood(c)}` : "") });
  }
  if (st.trend !== null) f.push({ name: t.fTrend, value: st.trend > 0.05 ? t.trendUp(st.trend.toFixed(2)) : st.trend < -0.05 ? t.trendDown(st.trend.toFixed(2)) : t.trendFlat });
  f.push({ name: t.fVolatility, value: st.volatility < 0.7 ? t.volLow : st.volatility < 1.1 ? t.volMid : t.volHigh });
  await app.discord.reply(i, {
    embeds: [{ color: ACCENT, title: t.insightsTitle(name), description: t.basedOn(st.count), fields: f }],
    components: [reportButtons(app, uid, 0, lang)],
  }, { ephemeral: hide });
}
