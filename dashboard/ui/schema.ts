/**
 * تعريف أقسام اللوحة.  حقل = [المفتاح، النوع، إضافي].  الأنواع:
 *   tx نص · ta نص طويل · bo مفتاح · ch روم · rl رتبة · cat كاتجوري · sel قائمة ثابتة · interval مدة · num رقم · preset قالب
 *   qs أسئلة · ar ردود · sc اختصارات · lg لوقات · sec حماية · bw كلمات محظورة · pn عقوبة
 * (قسم "لغة البوت" محذوف: البوت عربي فقط.)
 */
import { COLORS, EMBEDS } from "../lib/store.ts";

export type Field = [key: string, type: string, extra?: string | boolean];
export interface Group { key: string; icon: string | null; fields: Field[] }
export interface Section { icon: string; slots?: string[]; slot_names?: string; vars?: string[]; mirror?: boolean; modes?: boolean; note_icon?: string; groups: Group[] }

export const CARD_STYLES = ["royal", "neon", "glass", "minimal", "sunset", "aurora"];
export const OPTIONS: Record<string, string[]> = { colors: COLORS, embeds: EMBEDS, cardstyles: CARD_STYLES };
export const INTERVALS = [5, 10, 15, 30, 45];
const NUM10 = Array.from({ length: 10 }, (_, i) => String(i + 1));

const G = (key: string, icon: string | null, ...fields: Field[]): Group => ({ key, icon, fields });

export const SECTIONS: Record<string, Section> = {
  welcome: { icon: "user-plus", slots: ["1", "2"], slot_names: "tabs", vars: ["{server}", "{user}", "{count}"], mirror: true, groups: [
    G("msg", "message", ["channel_id", "ch"], ["status", "bo"]),
    G("card", "image", ["card", "bo", true], ["card_style", "sel", "cardstyles"], ["card_bg", "tx"], ["card_title", "tx"], ["card_sub", "tx"]),
    G("look", "palette", ["color", "sel", "colors"], ["embed_type", "sel", "embeds"], ["image_url", "tx"], ["embed_text", "ta"], ["outside_text", "ta"]),
    G("opts", "settings", ["show_avatar", "bo"], ["ignore_bots", "bo"], ["disable_mention", "bo"])] },
  tickets: { icon: "ticket", slots: NUM10, modes: true, mirror: true, groups: [
    G("general", "ticket", ["name", "tx"], ["category_id", "cat"], ["image_url", "tx"]),
    G("roles", "users", ["support_role_id", "rl"], ["ticket_mod_role_id", "rl"]),
    G("channels", "folder", ["log_channel_id", "ch"], ["rating_channel_id", "ch"]),
    G("messages", "message", ["welcome_msg", "ta"]),
    G("questions", "list", ["preset", "preset"], ["questions", "qs"], ["max_open", "num"])] },
  apply: { icon: "clipboard", slots: NUM10, modes: true, groups: [
    G("general", "clipboard", ["name", "tx"], ["admin_role_id", "rl"], ["review_channel_id", "ch"]),
    G("roles", "tag", ["given1", "rl"], ["given2", "rl"], ["removed_role_id", "rl"]),
    G("messages", "message", ["accept_msg", "ta"], ["reject_msg", "ta"]),
    G("questions", "list", ["questions", "qs"])] },
  rolestatus: { icon: "activity", groups: [
    G("channels", "folder", ["panel_channel_id", "ch"], ["channel_id", "ch"]),
    G("roles", "tag", ["ping_role_id", "rl"], ["manager_role_id", "rl"]),
    G("messages", "message", ["start_msg", "ta"], ["end_msg", "ta"], ["vote_msg", "ta"])] },
  identity: { icon: "id-card", groups: [
    G("channels", "folder", ["panel_channel_id", "ch"], ["admins_channel_id", "ch"]),
    G("roles", "tag", ["add_role_id", "rl"], ["rem_role_id", "rl"]),
    G("opts", "settings", ["change_nick", "bo", true])] },
  weapons: { icon: "crosshair", groups: [G("channels", "folder", ["panel_channel", "ch"], ["log_channel", "ch"])] },
  traffic: { icon: "traffic", groups: [
    G("roles", "tag", ["police_role", "rl"]),
    G("channels", "folder", ["control_channel", "ch"], ["citizen_channel", "ch"], ["log_channel", "ch"])] },
  bank: { icon: "landmark", groups: [
    G("panels", "layers", ["account_panel_channel_id", "ch"], ["citizens_panel_channel_id", "ch"], ["staff_panel_channel_id", "ch"]),
    G("ops", "coins", ["loan_channel_id", "ch"], ["log_channel_id", "ch"], ["bank_staff_role_id", "rl"])] },
  realestate: { icon: "building", groups: [
    G("panels", "layers", ["citizen_channel", "ch"], ["admin_channel", "ch"]),
    G("ops", "folder", ["requests_channel", "ch"], ["market_channel", "ch"], ["logs_channel", "ch"])] },
  activation: { icon: "check-circle", groups: [
    G("channels", "folder", ["panel_channel_id", "ch"], ["staff_channel_id", "ch"]),
    G("roles", "tag", ["staff_role_id", "rl"], ["add_role_id", "rl"], ["remove_role_id", "rl"])] },
  replies: { icon: "message", groups: [G("main", null, ["items", "ar"])] },
  autorole: { icon: "tag", groups: [G("main", null, ["role_id", "rl"])] },
  shortcuts: { icon: "bolt", groups: [G("main", null, ["items", "sc"])] },
  logs: { icon: "logs", groups: [G("main", null, ["logs", "lg"])] },
  security: { icon: "shield", note_icon: "warn", groups: [G("main", null, ["sec", "sec"])] },
  badwords: { icon: "ban", note_icon: "warn", groups: [G("main", null, ["words", "bw"], ["punishment", "pn"])] },
  azkar: { icon: "moon", groups: [G("main", null, ["channel_id", "ch"], ["interval", "interval"], ["status", "bo"])] },
  levels: { icon: "trending", vars: ["{user}", "{level}", "{next-level}", "{xp}"], groups: [G("main", null, ["channel_id", "ch"], ["message", "ta"])] },
  embed: { icon: "send", groups: [
    G("target", "folder", ["channel_id", "ch"], ["color", "sel", "colors"]),
    G("content", "message", ["title", "tx"], ["description", "ta"], ["image_url", "tx"], ["outside_text", "ta"])] },
};

export const CUSTOM: Record<string, string> = { home: "home", language: "globe", themes: "palette", emojis: "emoji", stats: "chart", rate: "star" };
export const NAV_TOP = ["home", "language", "themes", "emojis", "stats"];
export const NAV_GROUPS: [string, string[]][] = [
  ["rp", ["rolestatus", "identity", "weapons", "traffic", "bank", "realestate"]],
  ["admin", ["tickets", "apply", "activation", "welcome", "autorole", "replies", "shortcuts", "embed", "logs", "azkar", "levels"]],
  ["sec", ["security", "badwords"]],
];
export const NAV_BOTTOM = ["rate"];

export const LOG_TYPES: Record<string, string> = { members_join_remove: "log-in", member_bans: "hammer", member_kick: "user-x", member_timeout: "clock", member_roles: "tag",
  nicknames: "pencil", messages: "message-x", reactions: "smile", voice: "mic", channels_crud: "folder-plus", channels_update: "folder-edit",
  roles_crud: "tag-plus", roles_update: "tag", invites: "link", server_updates: "settings" };
export const SEC_FEATS: Record<string, string> = { bot_add: "bot", admin_role: "crown", mass_ban: "hammer", mass_kick: "user-x", channel_delete: "folder-x",
  role_delete: "trash", role_create: "tag-plus", channel_create: "folder-plus", links: "link" };
export const PUNISHMENTS = ["timeout", "kick", "ban", "strip_roles"];
export const SC_ICONS: Record<string, string> = { ban: "hammer", kick: "user-x", toggle_role: "tag", timeout: "clock", untimeout: "timer-off",
  nickname: "pencil", clear: "trash", warn: "warn", unban: "unlock" };
export const WIDE_TYPES = new Set(["ta", "qs", "ar", "sc", "lg", "sec", "bw"]);

export const sectionIcon = (k: string) => SECTIONS[k]?.icon ?? CUSTOM[k] ?? "info";
