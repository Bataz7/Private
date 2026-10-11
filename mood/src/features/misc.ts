/** /achievements /export /forget /help /admin */
import type { APIInteraction, APIMessageComponentInteraction } from "discord-api-types/v10";
import { ACHIEVEMENTS } from "../achievements.ts";
import type { MoodApp } from "../app.ts";
import { isOwner, isTarget } from "../config.ts";
import { ButtonStyle } from "../discord/constants.ts";
import { commandOptions, interactionUser, optValue } from "../discord/interaction.ts";
import type { Entry } from "../db.ts";
import { ACCENT, mood, tagById } from "../moods.ts";
import { addDays, arabicDate, formatMinutes, zoned } from "../time.ts";
import { button, progressBar, row } from "../ui.ts";
import { periodStats } from "./reports.ts";
import { sendCheckin } from "./checkin.ts";

export async function onAchievementsCommand(app: MoodApp, i: APIInteraction, requested?: string) {
  const me = interactionUser(i).id;
  const uid = requested ?? me;
  if (!app.canView(me, uid)) return app.discord.reply(i, { content: "🔒" }, { ephemeral: true });
  app.checkAchievements(uid);
  const got = new Set(app.unlocked(uid));
  const { streak, best } = app.streaks(uid);
  const lines = ACHIEVEMENTS.map((a) => got.has(a.code) ? `${a.emoji} **${a.title}** — ${a.description}` : `🔒 ~~${a.title}~~ — ${a.description}`);
  await app.discord.reply(i, {
    embeds: [{
      color: ACCENT,
      title: `${app.emojis.t("mood_trophy")} إنجازات ${await app.name(uid)}`,
      description: `${progressBar(got.size, ACHIEVEMENTS.length, 16)} **${got.size}/${ACHIEVEMENTS.length}**\n${app.emojis.t("mood_fire")} السلسلة الحالية: **${streak}** · الأفضل: **${best}**\n\n${lines.join("\n")}`,
    }],
  }, { ephemeral: Boolean(i.guild_id) });
}

function toCSV(rows: Entry[]): string {
  const cols = ["day", "mood", "mood_label", "energy", "sleep", "tags", "highlight", "problems", "gratitude", "ai_reply"];
  const q = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((e) => [e.day, e.mood, mood(e.mood).label, e.energy, e.sleep, e.tags.map((t) => tagById(t)?.label ?? t).join("|"), e.highlight, e.problems, e.gratitude, e.ai_reply].map(q).join(","));
  return "\uFEFF" + [cols.join(","), ...body].join("\n"); // BOM عشان Excel يقرأ العربي صح
}

export async function onExportCommand(app: MoodApp, i: APIInteraction) {
  const me = interactionUser(i).id;
  const { options } = commandOptions(i);
  const format = optValue<string>(options, "format") ?? "csv";
  const uid = optValue<string>(options, "user") ?? me;
  if (!app.canView(me, uid)) return app.discord.reply(i, { content: "🔒" }, { ephemeral: true });
  const rows = app.db.allEntries(uid);
  const stamp = app.today(uid);
  const file = format === "json"
    ? { name: `mood-${stamp}.json`, data: JSON.stringify({ user: uid, exported_at: new Date().toISOString(), entries: rows, achievements: app.db.achievements(uid) }, null, 2), contentType: "application/json" }
    : { name: `mood-${stamp}.csv`, data: toCSV(rows), contentType: "text/csv" };
  await app.discord.reply(i, { content: `📦 بياناتك (${rows.length} تسجيل)` }, { ephemeral: true, files: [file] });
}

export async function onForgetCommand(app: MoodApp, i: APIInteraction) {
  const uid = interactionUser(i).id;
  await app.discord.reply(i, {
    content: `⚠️ متأكد تبي تحذف **كل** بياناتك؟ (${app.db.countEntries(uid)} تسجيل + الإنجازات + الدردشة)\nما ينفع نرجعها بعدين. تقدر تاخذ نسخة قبل بـ \`/export\`.`,
    components: [row(button("del:yes", "احذف كل شي", { style: ButtonStyle.Danger, emoji: { name: "🗑️" } }), button("del:no", "لا، خلها", { emoji: { name: "↩️" } }))],
  }, { ephemeral: true });
}

export async function onForgetButton(app: MoodApp, i: APIMessageComponentInteraction, yes: boolean) {
  const uid = interactionUser(i).id;
  if (yes) {
    app.db.deleteUserData(uid);
    app.log.info(`user ${uid} deleted their data`);
  }
  await app.discord.update(i, { content: yes ? "🗑️ انحذفت كل بياناتك. نبدأ صفحة جديدة 🌱" : "👍 ما حذفت شي.", components: [] });
}

export async function onHelpCommand(app: MoodApp, i: APIInteraction) {
  const me = interactionUser(i).id;
  const owner = isOwner(app.config, me);
  const t = app.emojis.t.bind(app.emojis);
  const lines = [
    `${t("mood_great")} **Mood Bot** يسألك كل يوم: كيف كان يومك؟ ويطلع لك تقارير عن مزاجك ووش يأثر عليه.`,
    "",
    "**الأوامر**",
    "`/checkin` — سجّل يومك الحين",
    "`/report` — تقرير (أسبوع/شهر/3 شهور/سنة) مع ملف HTML بالرسوم",
    "`/insights` — وش يرفع مزاجك ووش ينزله (أنشطة، نوم، أيام)",
    "`/history` — آخر الأيام باختصار",
    "`/achievements` — إنجازاتك وسلسلتك 🔥",
    "`/talk` — دردش مع مود 🤖 (أو كلمني بالخاص مباشرة)",
    "`/settings` — وقت السؤال، المنطقة الزمنية، التذكير، الإجازة",
    "`/export` — نزّل بياناتك CSV أو JSON",
    "`/forget` — احذف كل بياناتك",
  ];
  if (owner) lines.push("`/admin` — لوحة المالك (نظرة عامة، إرسال السؤال، نسخة احتياطية)");
  lines.push("", `-# الذكاء الاصطناعي: ${app.ai.enabled ? "✅ شغّال" : "❌ مطفي"} · البوت مو بديل عن مختص 💛`);
  await app.discord.reply(i, { embeds: [{ color: ACCENT, description: lines.join("\n") }] }, { ephemeral: true });
}

export async function onAdminCommand(app: MoodApp, i: APIInteraction) {
  const me = interactionUser(i).id;
  if (!isOwner(app.config, me)) return app.discord.reply(i, { content: "🔒 هذا الأمر للمالك بس." }, { ephemeral: true });
  const { sub, options } = commandOptions(i);

  if (sub === "checkin") {
    const uid = optValue<string>(options, "user");
    if (!uid) return app.discord.reply(i, { content: "حدد الشخص" }, { ephemeral: true });
    await app.discord.defer(i, true);
    const ok = await sendCheckin(app, uid);
    return app.discord.editOriginal(i, { content: ok ? `📨 أرسلت السؤال لـ <@${uid}>` : `⚠️ ما قدرت أرسل لـ <@${uid}>` });
  }
  if (sub === "backup") {
    const file = app.db.backup(`${app.dataDir}/backups`, zoned(app.now(), app.config.timezone).day, app.config.backupKeep);
    return app.discord.reply(i, { content: `💾 سويت نسخة احتياطية:\n\`${file}\`` }, { ephemeral: true });
  }

  // overview
  const lines: string[] = [];
  for (const uid of app.config.targetIds) {
    const u = app.user(uid);
    const z = app.zonedNow(u);
    const st = periodStats(app, uid, addDays(z.day, -6), z.day);
    const last = app.db.entriesBetween(uid, addDays(z.day, -30), z.day).at(-1);
    const flags = [
      app.isPaused(u, z.day) ? "🏖️ إجازة" : "",
      u.dm_failed ? "⚠️ الخاص مقفل" : "",
      last && last.day === z.day ? "✅ سجّل اليوم" : u.last_prompt_day === z.day ? "⏳ انسأل وما رد" : `🕑 ${formatMinutes(app.checkinMinutes(u))}`,
    ].filter(Boolean).join(" · ");
    lines.push(
      `**<@${uid}>** — ${flags}\n` +
      `الأسبوع: ${st.count ? `${app.moodEmoji(st.avg)} ${st.avg.toFixed(1)}/5 (${st.count} أيام)` : "—"} · 🔥 ${st.streak}` +
      (last ? ` · آخر تسجيل: ${arabicDate(last.day)} ${app.moodEmoji(last.mood)}` : ""),
    );
  }
  const up = Math.floor((Date.now() - app.startedAt) / 60_000);
  await app.discord.reply(i, {
    embeds: [{
      color: ACCENT,
      title: "🛠️ لوحة المالك",
      description: lines.join("\n\n") || "ما فيه أشخاص في TARGET_USER_ID",
      footer: { text: `شغّال من ${Math.floor(up / 60)}س ${up % 60}د · AI: ${app.ai.enabled ? app.ai.model : "مطفي"} · ايموجيات: ${app.emojis.count}` },
    }],
    components: app.config.targetIds.slice(0, 5).map((uid) => row(button(`rp:${uid}:7`, "تقرير الأسبوع", { emoji: app.emojis.c("mood_report") }), button(`ad:ci:${uid}`, "أرسل السؤال الحين", { emoji: { name: "📨" } }))),
  }, { ephemeral: true });
}

export async function onAdminSendButton(app: MoodApp, i: APIMessageComponentInteraction, uid: string) {
  if (!isOwner(app.config, interactionUser(i).id) || !isTarget(app.config, uid)) return app.discord.reply(i, { content: "🔒" }, { ephemeral: true });
  await app.discord.defer(i, true);
  const ok = await sendCheckin(app, uid);
  await app.discord.editOriginal(i, { content: ok ? `📨 أرسلت السؤال لـ <@${uid}>` : `⚠️ ما قدرت أرسل لـ <@${uid}>` });
}
