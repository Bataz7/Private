/** يحوّل خيارات الرسالة بأسلوب discord.js (embeds, components, files, ephemeral, allowedMentions…) لـ JSON حق Discord. */
import type { FileUpload } from "../discord/rest.ts";
import { AttachmentBuilder, toJSON } from "./builders.ts";
import { MessageFlags } from "./enums.ts";

export interface MessageOptions {
  content?: string | null;
  embeds?: any[];
  components?: any[];
  files?: any[];
  attachments?: any[];
  flags?: number | number[] | string | string[] | null;
  ephemeral?: boolean;
  allowedMentions?: { parse?: string[]; users?: string[]; roles?: string[]; repliedUser?: boolean } | null;
  tts?: boolean;
  reply?: { messageReference: string; failIfNotExists?: boolean };
  poll?: any;
  stickers?: string[];
  fetchReply?: boolean;
  withResponse?: boolean;
  [k: string]: any;
}

let outgoing: ((body: Record<string, any>) => void) | null = null;
/** يعدّل كل رسالة قبل الإرسال (مثل استبدال الإيموجي بإيموجيات البوت). */
export function setOutgoingTransform(fn: ((body: Record<string, any>) => void) | null) {
  outgoing = fn;
}

export interface PayloadClient {
  options: { allowedMentions?: { parse?: string[]; users?: string[]; roles?: string[]; repliedUser?: boolean } | null };
}

function flagBits(f: MessageOptions["flags"]): number {
  if (f === null || f === undefined) return 0;
  if (typeof f === "number") return f;
  if (Array.isArray(f)) return (f as any[]).reduce((a: number, x: any) => a | flagBits(x), 0);
  if (typeof f === "string") return (MessageFlags as Record<string, number>)[f] ?? (/^\d+$/.test(f) ? Number(f) : 0);
  return Number((f as any).bitfield ?? 0);
}

function mentions(m: MessageOptions["allowedMentions"]) {
  if (!m) return undefined;
  const out: Record<string, unknown> = {};
  if (m.parse) out.parse = m.parse;
  if (m.users) out.users = m.users;
  if (m.roles) out.roles = m.roles;
  if (m.repliedUser !== undefined) out.replied_user = m.repliedUser;
  return out;
}

function toFile(f: any, i: number): FileUpload | null {
  if (!f) return null;
  if (f instanceof AttachmentBuilder) return { name: f.name, data: typeof f.attachment === "string" ? f.attachment : f.attachment };
  if (f instanceof Uint8Array) return { name: `file${i}.bin`, data: f };
  if (typeof f === "object" && "attachment" in f) return { name: f.name ?? `file${i}.bin`, data: f.attachment instanceof ArrayBuffer ? new Uint8Array(f.attachment) : f.attachment };
  if (typeof f === "object" && "data" in f && "name" in f) return f as FileUpload;
  return null;
}

/**
 * يرجع { body, files }. edit=true: ما نضيف allowed_mentions الافتراضي ونترك الحقول اللي ما انذكرت.
 */
export function toPayload(client: PayloadClient, options: MessageOptions | string, o: { edit?: boolean; interaction?: boolean } = {}) {
  const opt: MessageOptions = typeof options === "string" ? { content: options } : options ?? {};
  const body: Record<string, any> = {};
  if (opt.content !== undefined) body.content = opt.content ?? "";
  if (opt.tts) body.tts = true;
  if (opt.embeds !== undefined) body.embeds = (opt.embeds ?? []).map(toJSON);
  if (opt.components !== undefined) body.components = (opt.components ?? []).map(toJSON);
  let flags = flagBits(opt.flags);
  if (opt.ephemeral) flags |= MessageFlags.Ephemeral;
  if (flags || opt.flags !== undefined) body.flags = flags;
  const am = mentions(opt.allowedMentions ?? (o.edit ? undefined : client.options.allowedMentions ?? undefined));
  if (am) body.allowed_mentions = am;
  if (opt.reply?.messageReference) body.message_reference = { message_id: opt.reply.messageReference, fail_if_not_exists: opt.reply.failIfNotExists ?? false };
  if (opt.poll) body.poll = opt.poll;
  if (opt.stickers) body.sticker_ids = opt.stickers;
  if (opt.attachments !== undefined) body.attachments = opt.attachments.map((a: any) => (typeof a === "object" && a.id ? { id: a.id } : a));
  const files = (opt.files ?? []).map(toFile).filter((f): f is FileUpload => !!f);
  // ملفات جديدة مع تعديل: نحافظ على المرفقات القديمة لو انذكرت
  if (files.length && o.edit && body.attachments) {
    body.attachments = [...body.attachments, ...files.map((f, id) => ({ id, filename: f.name }))];
  }
  if (outgoing) {
    try {
      outgoing(body);
    } catch {}
  }
  return { body, files: files.length ? files : undefined };
}
