/**
 * إيموجيات ريفايف الخاصة (Application Emojis).
 *   E("log_ban") → "<:rv_log_ban:123…>" أو بديل عادي لو ما انرفعت للحين.
 *   syncEmojis(bot) يرفع الناقص بس (عند التشغيل).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { log } from "./log.ts";
import type { Bot } from "../discord/client.ts";

const FALLBACK: Record<string, string> = {
  log_join: "📥", log_leave: "📤", log_ban: "🔨", log_unban: "🔓", log_kick: "👢", log_timeout: "⏳", log_untimeout: "⏱️",
  log_role: "🏷️", log_role_add: "➕", log_role_remove: "➖", log_msg_delete: "🗑️", log_msg_edit: "✏️", log_reaction: "⭐",
  log_channel_create: "📁", log_channel_delete: "🗑️", log_channel_edit: "📝", log_role_create: "🆕", log_role_delete: "🗑️",
  log_server: "⚙️", log_voice: "🎙️", log_invite: "🔗", log_bot: "🤖",
  ticket: "🎫", ticket_open: "📬", ticket_close: "🔒", ticket_reopen: "🔓", ticket_claim: "🙋", ticket_transcript: "📄",
  ticket_rating: "⭐", ticket_user_add: "➕", ticket_user_remove: "➖", ticket_rename: "✏️", ticket_delete: "🗑️",
  ticket_priority: "🚩", ticket_support: "🛟", ticket_panel: "🗂️", ticket_note: "📝", ticket_notify: "🔔",
  ticket_unclaim: "🔓", ticket_lock: "🔒", ticket_user: "👤", ticket_time: "🕒", ticket_questions: "❓",
  success: "✅", error: "❌", warning: "⚠️", info: "ℹ️", loading: "🔄", pending: "⏳", locked: "🔒", on: "🟢", off: "🔴",
  shield: "🛡️", shield_on: "🛡️", shield_off: "🚫", antibot: "🤖", antilink: "🔗", antiraid: "🔨", badword: "🚫", admin: "👑", alert: "🚨",
  bank: "🏦", money: "💰", card: "💳", loan: "📋", transfer: "↔️", levels: "📈", xp: "✨", trophy: "🏆",
  identity: "🪪", weapon: "🔫", traffic: "🚦", realestate: "🏠", key: "🔑", apply: "📝", activation: "✅", rpstatus: "🎭", location: "📍",
  logo: "🌴", crown: "👑", star: "⭐", bolt: "⚡", welcome: "👋", azkar: "🌙", settings: "⚙️", heart: "❤️", chart: "📊",
  globe: "🌐", bot: "🤖", users: "👥", message: "💬", shortcut: "⚡", palette: "🎨",
  calendar: "📅", folder: "📁", user: "👤", link: "🔗", eye: "👁️", image: "🖼️", copy: "📋", search: "🔍", list: "📋",
};

const IDS_FILE = join(config.EMOJI_DIR, "ids.json");
let ids: Record<string, string> = load();

function load(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(IDS_FILE, "utf8"));
  } catch {
    return {};
  }
}

/** الإيموجي جاهز للنص: E("ticket_close") */
export function E(short: string): string {
  const name = short.startsWith("rv_") ? short : `rv_${short}`;
  const id = ids[name];
  return id ? `<:${name}:${id}>` : FALLBACK[name.slice(3)] ?? "▫️";
}

export async function syncEmojis(bot: Bot): Promise<string> {
  let manifest: { name: string; file: string }[];
  try {
    manifest = JSON.parse(readFileSync(join(config.EMOJI_DIR, "manifest.json"), "utf8"));
  } catch {
    return "no emoji pack";
  }
  const existing: { items: { name: string; id: string }[] } = await bot.rest.get(`/applications/${bot.appId}/emojis`);
  for (const e of existing.items ?? []) ids[e.name] = e.id;
  const todo = manifest.filter((e) => !ids[e.name]);
  for (const e of todo) {
    try {
      const data = readFileSync(join(config.EMOJI_DIR, e.file)).toString("base64");
      const made = await bot.rest.post(`/applications/${bot.appId}/emojis`, { body: { name: e.name, image: `data:image/png;base64,${data}` } });
      ids[e.name] = made.id;
    } catch (err) {
      log.warn("emojis", `${e.name}: ${(err as Error).message}`);
    }
  }
  ids = Object.fromEntries(Object.entries(ids).filter(([k]) => k.startsWith("rv_")));
  try {
    writeFileSync(IDS_FILE, JSON.stringify(ids, null, 1));
  } catch {}
  const ready = manifest.filter((e) => ids[e.name]).length;
  return `${ready}/${manifest.length} ready${todo.length ? ` (+${todo.length} uploaded)` : ""}`;
}
