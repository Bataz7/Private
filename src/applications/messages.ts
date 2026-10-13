import { EmbedBuilder } from '../lib/djs/index.js';
import type { Language } from './questions.js';

// The three messages an applicant receives in DMs: received, accepted, rejected. Normal embeds (not panels).
// البوت عربي دائمًا: say() يرجّع النص العربي مهما كانت لغة النموذج.
// A custom message written in the form settings replaces the default paragraph only; the details stay.

const TEXT = {
  receivedTitle: { ar: '✅ تم استلام تقديمك', en: '✅ Application received' },
  receivedBody: { ar: 'شكرًا {user} على اهتمامك تنضم لنا. وصلنا تقديمك وهو الحين عند الإدارة للمراجعة.', en: 'Thank you {user} for your interest in joining us. Your application reached us and is now with the management team for review.' },
  accepted: { ar: 'مقبول', en: 'Accepted' },
  rejected: { ar: 'غير مقبول', en: 'Not accepted' },
  underReview: { ar: '⏳ قيد المراجعة', en: '⏳ Under review' },
  form: { ar: '📝 النموذج', en: '📝 Form' },
  number: { ar: '🔖 رقم التقديم', en: '🔖 Reference' },
  sentAt: { ar: '📅 وقت الإرسال', en: '📅 Sent' },
  status: { ar: '📊 الحالة', en: '📊 Status' },
  decidedAt: { ar: '📅 تاريخ القرار', en: '📅 Decision date' },
  next: { ar: '🧭 الخطوات القادمة', en: '🧭 What happens next' },
  receivedNext: {
    ar: '**١.** الفريق يراجع إجاباتك بعناية.\n**٢.** يطلع القرار وتوصلك النتيجة هنا في الخاص.\n**٣.** ما يحتاج تقدّم مرة ثانية، تقديم واحد يكفي.',
    en: '**1.** The team reviews your answers carefully.\n**2.** A decision is made and the result is sent to you here in DMs.\n**3.** You do not need to apply again. One application is enough.',
  },
  keepDm: { ar: '💡 خلّ الخاص من هذا السيرفر مفتوح عشان توصلك النتيجة.', en: '💡 Keep DMs from this server open so the result can reach you.' },
  acceptedTitle: { ar: '🎉 مبروك! تم قبول تقديمك', en: '🎉 Congratulations! You were accepted' },
  acceptedBody: { ar: 'يسعدنا نبلغك إن تقديمك في **{form}** في سيرفر **{server}** انقبل. حيّاك معنا في الفريق!', en: 'We are happy to tell you that your application for **{form}** in **{server}** was accepted. Welcome to the team!' },
  roles: { ar: '🎖️ الرتب الممنوحة', en: '🎖️ Roles granted' },
  acceptedNext: {
    ar: '**١.** ادخل السيرفر وتعرّف على الرومات الجديدة اللي انفتحت لك.\n**٢.** اقرأ قوانين الفريق وتعليماته.\n**٣.** تواصل مع الإدارة لو احتجت أي مساعدة في بدايتك.',
    en: '**1.** Head to the server and look at the channels now open to you.\n**2.** Read the team rules and guidelines.\n**3.** Contact management if you need any help getting started.',
  },
  rejectedTitle: { ar: 'نتيجة تقديمك', en: 'Your application result' },
  rejectedBody: { ar: 'نشكرك على وقتك واهتمامك تنضم لـ **{server}**. بعد المراجعة، للأسف ما انقبل تقديمك في **{form}** هالمرة.', en: 'Thank you for your time and your interest in joining **{server}**. After review, we are sorry to say your application for **{form}** was not accepted this time.' },
  reason: { ar: '📌 السبب', en: '📌 Reason' },
  retry: { ar: '🔁 التقديم مرة أخرى', en: '🔁 Applying again' },
  retryAt: { ar: 'تقدر تقدّم من جديد {when}.', en: 'You can apply again {when}.' },
  retryAnytime: { ar: 'تقدر تقدّم من جديد متى ما انفتح التقديم.', en: 'You can apply again whenever applications are open.' },
  rejectedTip: { ar: '💬 هذا القرار مو نهاية الطريق، راجع إجاباتك وحسّن تقديمك وجرّب مرة ثانية.', en: '💬 This is not the end. Review your answers, improve your application and try again.' },
  footer: { ar: 'إدارة {server}', en: '{server} management' },
} as const;

type Key = keyof typeof TEXT;
const say = (_lang: Language, key: Key, vars: Record<string, string> = {}) => (TEXT[key].ar as string).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value);
const stamp = (date: Date) => `<t:${Math.floor(date.getTime() / 1000)}:f>`;

export type ApplicantMessageInput = {
  lang: Language;
  formTitle: string;
  reference: string;       // short application id
  guildName: string;
  guildIcon?: string | null;
  userMention: string;
  color?: number;          // form colour, used for "received"
  custom?: string;         // message written in the form settings (already filled), replaces the default paragraph
};

const fillVars = (input: ApplicantMessageInput) => ({ user: input.userMention, server: input.guildName, form: input.formTitle });
const base = (input: ApplicantMessageInput, color: number, title: string, body: string) => {
  const embed = new EmbedBuilder().setColor(color).setTitle(clip(title, 256)).setDescription(clip(body, 3500))
    .setFooter({ text: clip(`${say(input.lang, 'footer', { server: input.guildName })} · #${input.reference}`, 2048), iconURL: input.guildIcon || undefined }).setTimestamp();
  if (input.guildName) embed.setAuthor({ name: clip(input.guildName, 256), iconURL: input.guildIcon || undefined });
  if (input.guildIcon) embed.setThumbnail(input.guildIcon);
  return embed;
};

export function receivedEmbed(input: ApplicantMessageInput, submittedAt = new Date()) {
  const { lang } = input;
  return base(input, input.color || 0x8175f5,say(lang, 'receivedTitle'), input.custom || say(lang, 'receivedBody', fillVars(input))).addFields(
    { name: say(lang, 'form'), value: clip(input.formTitle, 1024), inline: true },
    { name: say(lang, 'number'), value: `\`#${input.reference}\``, inline: true },
    { name: say(lang, 'status'), value: say(lang, 'underReview'), inline: true },
    { name: say(lang, 'sentAt'), value: stamp(submittedAt), inline: false },
    { name: say(lang, 'next'), value: say(lang, 'receivedNext'), inline: false },
    { name: '​', value: say(lang, 'keepDm'), inline: false },
  );
}

export function acceptedEmbed(input: ApplicantMessageInput, extra: { roleIds?: string[]; decidedAt?: Date } = {}) {
  const { lang } = input;
  const embed = base(input, 0x4fc08d, say(lang, 'acceptedTitle'), input.custom || say(lang, 'acceptedBody', fillVars(input))).addFields(
    { name: say(lang, 'form'), value: clip(input.formTitle, 1024), inline: true },
    { name: say(lang, 'number'), value: `\`#${input.reference}\``, inline: true },
    { name: say(lang, 'status'), value: `✅ ${say(lang, 'accepted')}`, inline: true },
    { name: say(lang, 'decidedAt'), value: stamp(extra.decidedAt || new Date()), inline: false },
  );
  if (extra.roleIds?.length) embed.addFields({ name: say(lang, 'roles'), value: clip(extra.roleIds.map(id => `<@&${id}>`).join(' '), 1024), inline: false });
  return embed.addFields({ name: say(lang, 'next'), value: say(lang, 'acceptedNext'), inline: false });
}

export function rejectedEmbed(input: ApplicantMessageInput, extra: { reason?: string; retryAt?: Date | null; decidedAt?: Date } = {}) {
  const { lang } = input;
  const embed = base(input, 0xe9697b, say(lang, 'rejectedTitle'), input.custom || say(lang, 'rejectedBody', fillVars(input))).addFields(
    { name: say(lang, 'form'), value: clip(input.formTitle, 1024), inline: true },
    { name: say(lang, 'number'), value: `\`#${input.reference}\``, inline: true },
    { name: say(lang, 'status'), value: `❌ ${say(lang, 'rejected')}`, inline: true },
    { name: say(lang, 'decidedAt'), value: stamp(extra.decidedAt || new Date()), inline: false },
  );
  if (extra.reason) embed.addFields({ name: say(lang, 'reason'), value: clip(extra.reason, 1024), inline: false });
  embed.addFields({ name: say(lang, 'retry'), value: extra.retryAt ? say(lang, 'retryAt', { when: `<t:${Math.floor(extra.retryAt.getTime() / 1000)}:R>` }) : say(lang, 'retryAnytime'), inline: false });
  return embed.addFields({ name: '​', value: say(lang, 'rejectedTip'), inline: false });
}
