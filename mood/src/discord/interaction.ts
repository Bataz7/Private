/** أدوات صغيرة لقراءة بيانات التفاعل. */
import type {
  APIApplicationCommandInteractionDataOption,
  APIInteraction,
  APIModalSubmitInteraction,
  APIUser,
} from "discord-api-types/v10";
import { MessageFlags } from "./constants.ts";

export function interactionUser(i: APIInteraction): APIUser {
  const u = i.member?.user ?? i.user;
  if (!u) throw new Error("interaction without user");
  return u;
}

/** يرجع الأوبشنات (مع دخول الـ subcommand لو موجود). */
export function commandOptions(i: APIInteraction): {
  sub?: string;
  options: Map<string, APIApplicationCommandInteractionDataOption>;
} {
  const data = i.data as { options?: APIApplicationCommandInteractionDataOption[] } | undefined;
  let opts = data?.options ?? [];
  let sub: string | undefined;
  const first = opts[0];
  if (first && (first.type === 1 || first.type === 2) && "options" in first) {
    sub = first.name;
    opts = (first.options as APIApplicationCommandInteractionDataOption[] | undefined) ?? [];
  } else if (first && first.type === 1) {
    sub = first.name;
    opts = [];
  }
  return { sub, options: new Map(opts.map((o) => [o.name, o])) };
}

export function optValue<T = string | number | boolean>(
  opts: Map<string, APIApplicationCommandInteractionDataOption>,
  name: string,
): T | undefined {
  const o = opts.get(name) as { value?: unknown } | undefined;
  return o?.value as T | undefined;
}

export function focusedOption(i: APIInteraction): { name: string; value: string } | undefined {
  const { options } = commandOptions(i);
  for (const o of options.values()) {
    const f = o as { focused?: boolean; value?: unknown; name: string };
    if (f.focused) return { name: f.name, value: String(f.value ?? "") };
  }
  return undefined;
}

export function modalValues(i: APIModalSubmitInteraction): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of i.data.components ?? []) {
    const children = "components" in row ? row.components : "component" in row ? [row.component] : [];
    for (const c of children as { custom_id?: string; value?: string }[]) {
      if (c.custom_id) out.set(c.custom_id, c.value ?? "");
    }
  }
  return out;
}

export function isEphemeralMessage(i: APIInteraction): boolean {
  const msg = (i as { message?: { flags?: number } }).message;
  return Boolean(msg?.flags && msg.flags & MessageFlags.Ephemeral);
}

export const inGuild = (i: APIInteraction) => Boolean(i.guild_id);

/**
 * هل الرد لازم يكون مخفي (ephemeral)؟ نعم في كل مكان إلا الخاص مع البوت نفسه —
 * عشان ما تنكشف بيانات المزاج في سيرفر أو قروب أو خاص مع شخص ثاني (تثبيت المستخدم).
 */
export function shouldHide(i: APIInteraction): boolean {
  const ctx = (i as { context?: number }).context;
  if (ctx !== undefined) return ctx !== 1; // 1 = BotDM
  return Boolean(i.guild_id);
}
