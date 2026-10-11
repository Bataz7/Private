/** /achievements /export /forget /help /admin */
import type { APIInteraction, APIMessageComponentInteraction } from "discord-api-types/v10";
import { ACHIEVEMENTS } from "../achievements.ts";
import type { MoodApp } from "../app.ts";
import { isOwner, isTarget } from "../config.ts";
import { ButtonStyle } from "../discord/constants.ts";
import { commandOptions, interactionUser, optValue, shouldHide } from "../discord/interaction.ts";
import { L, type Lang } from "../i18n.ts";
import { ACCENT, mood, tagById } from "../moods.ts";
import { questionById, questionText } from "../questions.ts";
import type { Entry } from "../store/types.ts";
import { addDays, formatMinutes, localDate, zoned } from "../time.ts";
import { memory, mb } from "../system.ts";
import { button, progressBar, row } from "../ui.ts";
import { sendCheckin } from "./checkin.ts";
import { periodStats } from "./reports.ts";

export async function onAchievementsCommand(app: MoodApp, i: APIInteraction, requested?: string) {
  const me = interactionUser(i).id;
  const lang = await app.lang(me);
  const t = L(lang);
  const uid = requested ?? me;
  if (!app.canView(me, uid)) return app.discord.reply(i, { content: t.noAccess }, { ephemeral: true });
  await app.checkAchievements(uid);
  const got = new Set(await app.unlocked(uid));
  const { streak, best } = await app.streaks(uid);
  const lines = ACHIEVEMENTS.map((a) => (got.has(a.code) ? `${a.emoji} **${a.title[lang]}** — ${a.description[lang]}` : `🔒 ~~${a.title[lang]}~~ — ${a.description[lang]}`));
  await app.discord.reply(i, {
    embeds: [{
      color: ACCENT,
      title: t.achTitle(app.emojis.t("mood_trophy"), await app.name(uid)),
      description: `${progressBar(got.size, ACHIEVEMENTS.length, 16)} **${got.size}/${ACHIEVEMENTS.length}**\n${t.achStreak(app.emojis.t("mood_fire"), streak, best)}\n\n${lines.join("\n")}`,
    }],
  }, { ephemeral: shouldHide(i) });
}

export function toCSV(rows: Entry[], lang: Lang = "ar"): string {
  const cols = ["day", "mood", "mood_label", "energy", "sleep", "tags", "highlight", "problems", "gratitude", "question", "answer", "ai_reply"];
  const q = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((e) => {
    const qq = e.question ? questionById(e.question) : undefined;
    return [e.day, e.mood, mood(e.mood).label[lang], e.energy, e.sleep, e.tags.map((x) => tagById(x)?.label[lang] ?? x).join("|"),
      e.highlight, e.problems, e.gratitude, qq ? questionText(qq, lang) : "", e.answer, e.ai_reply].map(q).join(",");
  });
  return "﻿" + [cols.join(","), ...body].join("\n"); // BOM عشان Excel يقرأ العربي صح
}

export async function onExportCommand(app: MoodApp, i: APIInteraction) {
  const me = interactionUser(i).id;
  const lang = await app.lang(me);
  const { options } = commandOptions(i);
  const format = optValue<string>(options, "format") ?? "csv";
  const uid = optValue<string>(options, "user") ?? me;
  if (!app.canView(me, uid)) return app.discord.reply(i, { content: L(lang).noAccess }, { ephemeral: true });
  const rows = await app.db.allEntries(uid);
  const stamp = await app.today(uid);
  const file = format === "json"
    ? { name: `mood-${stamp}.json`, data: JSON.stringify({ user: uid, exported_at: new Date().toISOString(), entries: rows, achievements: await app.db.achievements(uid) }, null, 2), contentType: "application/json" }
    : { name: `mood-${stamp}.csv`, data: toCSV(rows, lang), contentType: "text/csv" };
  await app.discord.reply(i, { content: L(lang).exportReady(rows.length) }, { ephemeral: true, files: [file] });
}

export async function onForgetCommand(app: MoodApp, i: APIInteraction) {
  const uid = interactionUser(i).id;
  const t = await app.t(uid);
  await app.discord.reply(i, {
    content: t.forgetConfirm(await app.db.countEntries(uid)),
    components: [row(button("del:yes", t.forgetYes, { style: ButtonStyle.Danger, emoji: { name: "🗑️" } }), button("del:no", t.forgetNo, { emoji: { name: "↩️" } }))],
  }, { ephemeral: true });
}

export async function onForgetButton(app: MoodApp, i: APIMessageComponentInteraction, yes: boolean) {
  const uid = interactionUser(i).id;
  const t = await app.t(uid);
  if (yes) {
    await app.db.deleteUserData(uid);
    app.log.info(`user ${uid} deleted their data`);
  }
  await app.discord.update(i, { content: yes ? t.forgotten : t.notForgotten, components: [] });
}

export async function onHelpCommand(app: MoodApp, i: APIInteraction) {
  const me = interactionUser(i).id;
  const t = await app.t(me);
  const lines = [t.helpIntro(app.emojis.t("mood_great")), "", ...t.helpCommands];
  if (isOwner(app.config, me)) lines.push(t.helpAdmin);
  lines.push("", t.helpFooter(app.ai.enabled));
  await app.discord.reply(i, { embeds: [{ color: ACCENT, description: lines.join("\n") }] }, { ephemeral: true });
}

export async function onAdminCommand(app: MoodApp, i: APIInteraction) {
  const me = interactionUser(i).id;
  const lang = await app.lang(me);
  const t = L(lang);
  if (!isOwner(app.config, me)) return app.discord.reply(i, { content: t.ownerOnly }, { ephemeral: true });
  const { sub, options } = commandOptions(i);

  if (sub === "checkin") {
    const uid = optValue<string>(options, "user");
    if (!uid) return app.discord.reply(i, { content: t.chooseUser }, { ephemeral: true });
    await app.discord.defer(i, true);
    const ok = await sendCheckin(app, uid);
    return app.discord.editOriginal(i, { content: ok ? t.sentTo(uid) : t.cantSendTo(uid) });
  }
  if (sub === "backup") {
    if (app.config.backupKeep <= 0) return app.discord.reply(i, { content: t.backupDisabled }, { ephemeral: true });
    await app.discord.defer(i, true);
    const file = await app.db.backup(`${app.dataDir}/backups`, zoned(app.now(), app.config.timezone).day, app.config.backupKeep);
    return app.discord.editOriginal(i, { content: t.backupDone(file) });
  }

  // overview
  const lines: string[] = [];
  for (const uid of app.config.targetIds) {
    const u = await app.user(uid);
    const z = app.zonedFor(u);
    const st = await periodStats(app, uid, addDays(z.day, -6), z.day);
    const last = (await app.db.entriesBetween(uid, addDays(z.day, -30), z.day)).at(-1);
    const flags = [
      app.isPaused(u, z.day) ? t.flagVacation : "",
      u.dm_failed ? t.flagDmClosed : "",
      last && last.day === z.day ? t.flagLogged : u.last_prompt_day === z.day ? t.flagWaiting : `🕑 ${formatMinutes(app.checkinMinutes(u))}`,
    ].filter(Boolean).join(" · ");
    const week = st.count ? t.adminWeekVal(app.moodEmoji(st.avg), st.avg.toFixed(1), st.count) : "—";
    lines.push(`**<@${uid}>** — ${flags}\n${t.adminWeek(week, st.streak)}${last ? t.adminLast(localDate(last.day, lang), app.moodEmoji(last.mood)) : ""}`);
  }
  const up = Math.floor((Date.now() - app.startedAt) / 60_000);
  await app.discord.reply(i, {
    embeds: [{
      color: ACCENT,
      title: t.adminTitle,
      description: lines.join("\n\n") || t.adminEmpty,
      footer: { text: t.adminFooter(Math.floor(up / 60), up % 60, app.ai.label, app.db.kind, app.emojis.count, mb(memory().rss)) },
    }],
    components: app.config.targetIds.slice(0, 5).map((uid) => row(
      button(`rp:${uid}:7`, t.weekReport, { emoji: app.emojis.c("mood_report") }),
      button(`ad:ci:${uid}`, t.sendNow, { emoji: { name: "📨" } }),
    )),
  }, { ephemeral: true });
}

export async function onAdminSendButton(app: MoodApp, i: APIMessageComponentInteraction, uid: string) {
  const me = interactionUser(i).id;
  const t = await app.t(me);
  if (!isOwner(app.config, me) || !isTarget(app.config, uid)) return app.discord.reply(i, { content: t.ownerOnly }, { ephemeral: true });
  await app.discord.defer(i, true);
  const ok = await sendCheckin(app, uid);
  await app.discord.editOriginal(i, { content: ok ? t.sentTo(uid) : t.cantSendTo(uid) });
}
