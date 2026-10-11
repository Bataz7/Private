/** /settings و /language — كل شخص يحدد لغته ووقته ومنطقته الزمنية والتذكير والإجازة. */
import type { APIInteraction } from "discord-api-types/v10";
import type { MoodApp } from "../app.ts";
import { isOwner } from "../config.ts";
import { commandOptions, focusedOption, interactionUser, optValue } from "../discord/interaction.ts";
import { isLang, L } from "../i18n.ts";
import { ACCENT } from "../moods.ts";
import { addDays, formatMinutes, isValidTimeZone, localDate, localTime, parseHHMM } from "../time.ts";

const ALL_ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["Asia/Riyadh", "Asia/Dubai", "Asia/Kuwait", "Asia/Qatar", "Asia/Bahrain", "Asia/Muscat", "Africa/Cairo", "Europe/London", "America/New_York"];
  }
})();
const POPULAR = ["Asia/Riyadh", "Asia/Dubai", "Asia/Kuwait", "Asia/Qatar", "Asia/Bahrain", "Asia/Muscat", "Asia/Amman", "Asia/Baghdad", "Africa/Cairo", "Europe/London", "Europe/Istanbul", "America/New_York"];

export async function onSettingsAutocomplete(app: MoodApp, i: APIInteraction) {
  const f = focusedOption(i);
  const q = (f?.value ?? "").toLowerCase();
  const list = q ? ALL_ZONES.filter((z) => z.toLowerCase().includes(q)) : POPULAR;
  await app.discord.autocomplete(i, list.slice(0, 25).map((z) => ({ name: z, value: z })));
}

/** الإعدادات تنعرض بلغة اللي يشوفها (viewer). */
export async function settingsEmbed(app: MoodApp, uid: string, viewer = uid) {
  const u = await app.user(uid);
  const lang = await app.lang(viewer);
  const t = L(lang);
  const z = app.zonedFor(u);
  const cm = app.checkinMinutes(u);
  const rh = app.reminderHours(u);
  const paused = app.isPaused(u, z.day);
  const left = cm - z.minutes;
  return {
    color: ACCENT,
    title: t.settingsTitle(await app.name(uid)),
    fields: [
      { name: t.sTime, value: `${formatMinutes(cm)} (${localTime(cm, lang)})`, inline: true },
      { name: t.sTz, value: app.tzOf(u), inline: true },
      { name: t.sLang, value: L(app.langOf(u)).langName, inline: true },
      { name: t.sReminder, value: rh > 0 ? t.reminderAfter(rh) : t.off, inline: true },
      { name: t.sPause, value: paused ? t.pausedUntil(localDate(u.paused_until!, lang)) : t.active, inline: true },
      { name: t.sNow, value: z.hhmm, inline: true },
      { name: t.sToday, value: u.last_prompt_day === z.day ? t.sent : left > 0 ? t.remaining(Math.floor(left / 60), left % 60) : "—", inline: true },
    ],
    footer: { text: t.settingsFooter },
  };
}

export async function onSettingsCommand(app: MoodApp, i: APIInteraction) {
  const me = interactionUser(i).id;
  const { sub, options } = commandOptions(i);
  const requested = optValue<string>(options, "user");
  const t = await app.t(me);
  if (requested && requested !== me && !isOwner(app.config, me)) return app.discord.reply(i, { content: t.onlyOwnSettings }, { ephemeral: true });
  const uid = requested ?? me;
  const say = async (content: string) => app.discord.reply(i, { content, embeds: [await settingsEmbed(app, uid, me)] }, { ephemeral: true });

  switch (sub) {
    case "time": {
      const min = parseHHMM(optValue<string>(options, "value") ?? "");
      if (min === null) return app.discord.reply(i, { content: t.badTime }, { ephemeral: true });
      const u = await app.user(uid);
      const z = app.zonedFor(u);
      // لو الوقت الجديد لسا ما جا اليوم، نسمح بالسؤال اليوم مرة ثانية
      const reopen = min > z.minutes && !(await app.db.getEntry(uid, z.day));
      await app.db.updateUser(uid, { checkin_minutes: min, ...(reopen ? { last_prompt_day: null, last_reminder_day: null } : {}) });
      return say(t.timeSet(formatMinutes(min), localTime(min, await app.lang(me))));
    }
    case "timezone": {
      const tz = (optValue<string>(options, "value") ?? "").trim();
      if (!isValidTimeZone(tz)) return app.discord.reply(i, { content: t.badTz(tz) }, { ephemeral: true });
      await app.db.updateUser(uid, { timezone: tz });
      return say(t.tzSet(tz));
    }
    case "reminder": {
      const h = optValue<number>(options, "hours") ?? 0;
      await app.db.updateUser(uid, { reminder_hours: h });
      return say(h > 0 ? t.reminderSet(h) : t.reminderOff);
    }
    case "pause": {
      const days = optValue<number>(options, "days") ?? 7;
      const until = addDays(await app.today(uid), days - 1);
      await app.db.updateUser(uid, { paused_until: until });
      return say(t.pauseSet(localDate(until, await app.lang(me))));
    }
    case "resume":
      await app.db.updateUser(uid, { paused_until: null });
      return say(t.resumed);
    default:
      return app.discord.reply(i, { embeds: [await settingsEmbed(app, uid, me)] }, { ephemeral: true });
  }
}

/** /language — يغيّر لغة البوت لهالشخص (عربي / English). */
export async function onLanguageCommand(app: MoodApp, i: APIInteraction) {
  const me = interactionUser(i).id;
  const { options } = commandOptions(i);
  const value = optValue<string>(options, "language");
  const requested = optValue<string>(options, "user");
  if (requested && requested !== me && !isOwner(app.config, me)) return app.discord.reply(i, { content: (await app.t(me)).onlyOwnSettings }, { ephemeral: true });
  const uid = requested ?? me;
  if (!isLang(value)) return app.discord.reply(i, { embeds: [await settingsEmbed(app, uid, me)] }, { ephemeral: true });
  await app.db.updateUser(uid, { lang: value });
  await app.discord.reply(i, { content: L(value).langSet }, { ephemeral: true });
}
