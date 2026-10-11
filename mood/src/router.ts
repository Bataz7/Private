/** يوزّع التفاعلات على الدوال المناسبة مع صلاحيات ومعالجة أخطاء. */
import type {
  APIInteraction,
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
} from "discord-api-types/v10";
import type { MoodApp } from "./app.ts";
import { isAllowed } from "./config.ts";
import { ErrorCode, InteractionType, ResponseType } from "./discord/constants.ts";
import { commandOptions, interactionUser, optValue } from "./discord/interaction.ts";
import { DiscordAPIError } from "./discord/rest.ts";
import { onCheckinCommand, onEdit, onEntryModal, onMoodButton, onSnooze, onTags } from "./features/checkin.ts";
import { onTalkCommand } from "./features/companion.ts";
import { onAchievementsCommand, onAdminCommand, onAdminSendButton, onExportCommand, onForgetButton, onForgetCommand, onHelpCommand } from "./features/misc.ts";
import { onHistoryCommand, onInsightsCommand, onReportButton, onReportCommand } from "./features/reports.ts";
import { onLanguageCommand, onSettingsAutocomplete, onSettingsCommand } from "./features/settings.ts";
import { L } from "./i18n.ts";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{15,21}$/;

async function command(app: MoodApp, i: APIInteraction): Promise<unknown> {
  const name = (i.data as { name: string }).name;
  const { options } = commandOptions(i);
  const user = optValue<string>(options, "user");
  switch (name) {
    case "checkin": return onCheckinCommand(app, i, user);
    case "report": return onReportCommand(app, i, optValue<number>(options, "period") ?? 7, user);
    case "insights": return onInsightsCommand(app, i, user);
    case "history": return onHistoryCommand(app, i, optValue<number>(options, "days") ?? 7, user);
    case "achievements": return onAchievementsCommand(app, i, user);
    case "talk": return onTalkCommand(app, i, optValue<string>(options, "message"), optValue<boolean>(options, "reset"));
    case "settings": return onSettingsCommand(app, i);
    case "language": return onLanguageCommand(app, i);
    case "export": return onExportCommand(app, i);
    case "forget": return onForgetCommand(app, i);
    case "help": return onHelpCommand(app, i);
    case "admin": return onAdminCommand(app, i);
  }
  return app.discord.reply(i, { content: (await app.t(interactionUser(i).id)).unknownCommand }, { ephemeral: true });
}

async function component(app: MoodApp, i: APIMessageComponentInteraction): Promise<unknown> {
  const [kind, a = "", b = ""] = i.data.custom_id.split(":");
  switch (kind) {
    case "ci": if (DAY.test(a) && /^[1-5]$/.test(b)) return onMoodButton(app, i, a, Number(b)); break;
    case "sz": if (DAY.test(a)) return onSnooze(app, i, a); break;
    case "ed": if (DAY.test(a)) return onEdit(app, i, a); break;
    case "tg": if (DAY.test(a)) return onTags(app, i, a); break;
    case "rp": if (ID.test(a) && /^\d{1,3}$/.test(b)) return onReportButton(app, i, a, Math.min(365, Number(b))); break;
    case "del": return onForgetButton(app, i, a === "yes");
    case "ad": if (a === "ci" && ID.test(b)) return onAdminSendButton(app, i, b); break;
  }
  return app.discord.reply(i, { content: (await app.t(interactionUser(i).id)).staleButton }, { ephemeral: true });
}

async function modal(app: MoodApp, i: APIModalSubmitInteraction): Promise<unknown> {
  const [kind, a = "", b = ""] = i.data.custom_id.split(":");
  if (kind === "cm" && DAY.test(a) && /^[1-5]$/.test(b)) return onEntryModal(app, i, a, Number(b));
  return app.discord.reply(i, { content: "🤔" }, { ephemeral: true });
}

export async function handleInteraction(app: MoodApp, i: APIInteraction): Promise<void> {
  const started = Date.now();
  let label = `type ${i.type}`;
  try {
    if (i.type === InteractionType.Ping) {
      await app.discord.rest.post(`/interactions/${i.id}/${i.token}/callback`, { body: { type: ResponseType.Pong }, auth: false });
      return;
    }
    const uid = interactionUser(i).id;
    if (i.type === InteractionType.Autocomplete) {
      if (isAllowed(app.config, uid)) await onSettingsAutocomplete(app, i);
      else await app.discord.autocomplete(i, []);
      return;
    }
    if (!isAllowed(app.config, uid)) {
      // الغريب ما عنده لغة محفوظة: نستخدم لغة ديسكورد حقه
      const lang = (i as { locale?: string }).locale?.startsWith("ar") ? "ar" : (i as { locale?: string }).locale ? "en" : app.config.defaultLang;
      await app.discord.reply(i, { content: L(lang).privateBot }, { ephemeral: true });
      return;
    }
    switch (i.type) {
      case InteractionType.ApplicationCommand:
        label = `/${(i.data as { name: string }).name}`;
        await command(app, i);
        break;
      case InteractionType.MessageComponent:
        label = `component ${i.data.custom_id}`;
        await component(app, i);
        break;
      case InteractionType.ModalSubmit:
        label = `modal ${i.data.custom_id}`;
        await modal(app, i);
        break;
    }
    app.log.debug(`${label} by ${uid} in ${Date.now() - started}ms`);
  } catch (e) {
    app.log.error(`interaction failed (${label}):`, e instanceof Error ? e.stack ?? e.message : e);
    await reportError(app, i);
  }
}

/** نحاول نعلم المستخدم إن صار خطأ — رد جديد أو متابعة لو سبق ورديّنا. */
async function reportError(app: MoodApp, i: APIInteraction): Promise<void> {
  const content = await app.t(interactionUser(i).id).then((t) => t.error).catch(() => L(app.config.defaultLang).error);
  try {
    await app.discord.reply(i, { content }, { ephemeral: true });
  } catch (e) {
    if (e instanceof DiscordAPIError && (e.code === ErrorCode.InteractionAlreadyAcknowledged || e.status === 400)) {
      await app.discord.followup(i, { content }, { ephemeral: true }).catch(() => undefined);
    }
  }
}
