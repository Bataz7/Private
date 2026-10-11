/** /settings — كل شخص يحدد وقته ومنطقته الزمنية والتذكير والإجازة. */
import type { APIInteraction } from "discord-api-types/v10";
import type { MoodApp } from "../app.ts";
import { isOwner } from "../config.ts";
import { commandOptions, focusedOption, interactionUser, optValue } from "../discord/interaction.ts";
import { ACCENT } from "../moods.ts";
import { addDays, arabicDate, arabicTime, formatMinutes, isValidTimeZone, parseHHMM } from "../time.ts";

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

export async function settingsEmbed(app: MoodApp, uid: string) {
  const u = app.user(uid);
  const z = app.zonedNow(u);
  const cm = app.checkinMinutes(u);
  const rh = app.reminderHours(u);
  const paused = app.isPaused(u, z.day);
  return {
    color: ACCENT,
    title: `⚙️ إعدادات ${await app.name(uid)}`,
    fields: [
      { name: "🕑 وقت السؤال", value: `${formatMinutes(cm)} (${arabicTime(cm)})`, inline: true },
      { name: "🌍 المنطقة الزمنية", value: app.tz(u), inline: true },
      { name: "⏰ التذكير", value: rh > 0 ? `بعد ${rh} ساعة` : "مطفي", inline: true },
      { name: "🏖️ الإجازة", value: paused ? `موقف لين ${arabicDate(u.paused_until!)}` : "شغّال ✅", inline: true },
      { name: "🕐 الوقت عندك الحين", value: z.hhmm, inline: true },
      { name: "📬 السؤال اليوم", value: u.last_prompt_day === z.day ? "انرسل ✓" : z.minutes < cm ? `باقي ${Math.floor((cm - z.minutes) / 60)}س ${(cm - z.minutes) % 60}د` : "—", inline: true },
    ],
    footer: { text: "غيّرها بـ /settings time · timezone · reminder · pause · resume" },
  };
}

export async function onSettingsCommand(app: MoodApp, i: APIInteraction) {
  const me = interactionUser(i).id;
  const { sub, options } = commandOptions(i);
  const requested = optValue<string>(options, "user");
  if (requested && requested !== me && !isOwner(app.config, me)) {
    return app.discord.reply(i, { content: "🔒 تقدر تغيّر إعداداتك أنت بس." }, { ephemeral: true });
  }
  const uid = requested ?? me;
  const say = async (content: string) => app.discord.reply(i, { content, embeds: [await settingsEmbed(app, uid)] }, { ephemeral: true });

  switch (sub) {
    case "time": {
      const raw = optValue<string>(options, "value") ?? "";
      const min = parseHHMM(raw);
      if (min === null) return app.discord.reply(i, { content: "⚠️ اكتب الوقت بصيغة 24 ساعة مثل `14:30` (2:30 الظهر) أو `21:00`." }, { ephemeral: true });
      const u = app.user(uid);
      const z = app.zonedNow(u);
      // لو الوقت الجديد لسا ما جا اليوم، نسمح بالسؤال اليوم مرة ثانية
      app.db.updateUser(uid, { checkin_minutes: min, ...(min > z.minutes && !app.db.getEntry(uid, z.day) ? { last_prompt_day: null, last_reminder_day: null } : {}) });
      return say(`✅ السؤال اليومي صار الساعة **${formatMinutes(min)}** (${arabicTime(min)})`);
    }
    case "timezone": {
      const tz = (optValue<string>(options, "value") ?? "").trim();
      if (!isValidTimeZone(tz)) return app.discord.reply(i, { content: `⚠️ "${tz}" منطقة زمنية غير معروفة. جرّب مثلاً \`Asia/Riyadh\`.` }, { ephemeral: true });
      app.db.updateUser(uid, { timezone: tz });
      return say(`✅ المنطقة الزمنية صارت **${tz}**`);
    }
    case "reminder": {
      const h = optValue<number>(options, "hours") ?? 0;
      app.db.updateUser(uid, { reminder_hours: h });
      return say(h > 0 ? `✅ بذكّرك بعد **${h}** ساعة لو ما رديت` : "🔕 طفّيت التذكير");
    }
    case "pause": {
      const days = optValue<number>(options, "days") ?? 7;
      const until = addDays(app.today(uid), days - 1);
      app.db.updateUser(uid, { paused_until: until });
      return say(`🏖️ إجازة سعيدة! وقفت السؤال اليومي لين **${arabicDate(until)}**`);
    }
    case "resume":
      app.db.updateUser(uid, { paused_until: null });
      return say("✅ رجعنا! السؤال اليومي شغّال");
    default:
      return app.discord.reply(i, { embeds: [await settingsEmbed(app, uid)] }, { ephemeral: true });
  }
}
