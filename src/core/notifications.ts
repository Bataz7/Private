import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type GuildMember } from '../lib/djs/index.js';
import { env } from '../config/env.js';
import { supabase } from '../supabase/client.js';
import { StaffNotification, type NotificationDelivery, type NotificationLevel, type StaffNotificationRead } from '../models/StaffNotification.js';
import { Staff } from '../models/Staff.js';
import { getSettings } from '../services/settings.service.js';
import { createLog } from '../services/log.service.js';
import { assertAdministrator, isAdministrator } from '../utils/permissions.js';
import { logDbIssue, orSetupMissing } from './db.js';

export type { NotificationDelivery, NotificationLevel };
export const NOTIFICATION_LEVELS: Record<NotificationLevel, { emoji: string; color: number; en: string; ar: string }> = {
  info: { emoji: '📨', color: 0x8175f5, en: 'Message from management', ar: 'رسالة من الإدارة' },
  warning: { emoji: '⚠️', color: 0xe0b04f, en: 'Notice from management', ar: 'تنبيه من الإدارة' },
  important: { emoji: '🔴', color: 0xe9697b, en: 'Important notice', ar: 'إشعار مهم' },
};
export type NotificationTarget = 'user' | 'staff' | 'role';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const clean = (value: unknown) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();

export type SendNotificationInput = {
  guildId: string;
  sender: { id: string; username: string };
  target: NotificationTarget;
  recipientUserId?: string;
  roleId?: string;
  delivery: NotificationDelivery;
  level: NotificationLevel;
  title?: string;
  message: string;
};
export type SendNotificationResult = { recipients: number; saved: number; sent: number; failed: string[]; delivery: NotificationDelivery };

/** Owners and administrators only (checked again here, live, on top of the route or command check). */
export async function sendNotification(client: Client, input: SendNotificationInput): Promise<SendNotificationResult> {
  await assertAdministrator(client, input.guildId, input.sender.id);
  const message = clean(input.message);
  const title = clean(input.title).slice(0, 120);
  if (!message) throw new Error('Write a message first.');
  if (message.length > 2000) throw new Error('The message cannot exceed 2000 characters.');
  if (!['dashboard', 'discord', 'both'].includes(input.delivery)) throw new Error('Choose a valid delivery method.');
  const level: NotificationLevel = input.level in NOTIFICATION_LEVELS ? input.level : 'info';

  const guild = client.guilds.cache.get(input.guildId) || await client.guilds.fetch(input.guildId);
  const settings = await getSettings(input.guildId).catch(() => null);
  // Only staff and administrators of this server can receive one, so this can never become a mass DM to ordinary members.
  const isTeam = (member: GuildMember | null | undefined): member is GuildMember => Boolean(member && !member.user.bot && (isAdministrator(member) || (settings?.staffRoleId && member.roles.cache.has(settings.staffRoleId))));

  let recipients: GuildMember[] = [];
  if (input.target === 'user') {
    const id = String(input.recipientUserId || '');
    const member = /^\d{15,22}$/.test(id) ? await guild.members.fetch(id).catch(() => null) : null;
    if (!isTeam(member)) throw new Error('Choose a staff member or administrator of this server.');
    recipients = [member];
  } else if (input.target === 'staff') {
    const rows = await Staff.find({ guildId: input.guildId, active: true });
    const fetched = rows.length ? await guild.members.fetch({ user: rows.map(row => row.userId).slice(0, 100) }).catch(() => null) : null;
    recipients = [...(fetched?.values() ?? [])].filter(isTeam);
  } else {
    const role = guild.roles.cache.get(String(input.roleId || ''));
    if (!role || role.id === guild.id) throw new Error('Choose a role.');
    if (guild.members.cache.size < guild.memberCount) await guild.members.fetch().catch(() => undefined);
    recipients = [...role.members.values()].filter(isTeam).slice(0, 100);
  }
  if (!recipients.length) throw new Error('Nobody matches that choice.');

  const ar = settings?.botLanguage === 'ar';
  const meta = NOTIFICATION_LEVELS[level];
  const heading = title || (ar ? meta.ar : meta.en);

  let saved = 0;
  if (input.delivery !== 'discord') {
    for (const member of recipients) {
      await StaffNotification.create({ guildId: input.guildId, recipientUserId: member.id, senderUserId: input.sender.id, senderName: input.sender.username, type: input.target === 'user' ? 'admin_note' : 'announcement', level, delivery: input.delivery, title: heading, message, link: '/dashboard/notifications', readBy: [] })
        .catch(error => orSetupMissing(error, 'Notifications'));
      saved += 1;
    }
  }

  let sent = 0;
  const failed: string[] = [];
  if (input.delivery !== 'dashboard') {
    const link = /^https?:\/\//.test(env.dashboardUrl) ? `${env.dashboardUrl}/dashboard/notifications` : '';
    const payload = {
      allowedMentions: { parse: [] as never[] },
      embeds: [new EmbedBuilder().setColor(meta.color).setAuthor({ name: `${ar ? meta.ar : meta.en} · ${guild.name}` }).setTitle(heading.slice(0, 256)).setDescription(message.slice(0, 4000)).setFooter({ text: `${ar ? 'من' : 'From'} ${input.sender.username} · Rift` })],
      ...(link ? { components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(link).setLabel(ar ? 'فتح الداشبورد' : 'Open dashboard').setEmoji('📥'))] } : {}),
    };
    for (const member of recipients) {
      const ok = await member.send(payload).then(() => true).catch(() => false);
      if (ok) sent += 1; else failed.push(member.displayName);
      // Discord throttles DMs to many people in a row.
      if (recipients.length > 5) await sleep(350);
    }
  }
  await createLog(input.guildId, 'NOTIFICATION_SENT', input.sender.id, input.sender.id, { target: input.target, recipients: recipients.length, delivery: input.delivery, level }).catch(() => undefined);
  return { recipients: recipients.length, saved, sent, failed, delivery: input.delivery };
}

// ---- Inbox ----------------------------------------------------------------------------------------

export type InboxItem = {
  id: string; guildId: string; recipientUserId: string | null; senderUserId: string; senderName: string; senderAvatar: string; type: string; level: NotificationLevel;
  delivery: NotificationDelivery; title: string; message: string; link: string; readBy: StaffNotificationRead[]; createdAt: string;
};

function rowToItem(row: Record<string, any>): InboxItem {
  return {
    id: String(row.id), guildId: row.guild_id, recipientUserId: row.recipient_user_id ?? null, senderUserId: row.sender_user_id, senderName: row.sender_name || '', senderAvatar: '',
    type: row.type, level: (row.level in NOTIFICATION_LEVELS ? row.level : 'info') as NotificationLevel, delivery: row.delivery, title: row.title || '', message: row.message, link: row.link || '',
    readBy: Array.isArray(row.read_by) ? row.read_by : [], createdAt: row.created_at,
  };
}

/** The signed-in member's own notifications, plus anything addressed to every staff member. Empty until migration 030 is applied. */
export async function listInbox(client: Client, guildId: string, userId: string) {
  if (!/^\d{15,22}$/.test(userId)) return { notifications: [] as InboxItem[], unread: 0 };
  const { data, error } = await supabase.from('staff_notifications').select('*').eq('guild_id', guildId)
    .or(`recipient_user_id.is.null,recipient_user_id.eq.${userId}`).order('created_at', { ascending: false }).limit(50);
  if (error) {
    logDbIssue(error, 'Notifications');
    return { notifications: [] as InboxItem[], unread: 0 };
  }
  const guild = client.guilds.cache.get(guildId);
  const notifications = (data ?? []).map(rowToItem).map(item => {
    const member = guild?.members.cache.get(item.senderUserId);
    const user = member?.user || client.users.cache.get(item.senderUserId);
    return { ...item, senderName: member?.displayName || user?.username || item.senderName, senderAvatar: user?.displayAvatarURL({ extension: 'png', size: 64 }) || '' };
  });
  const unread = notifications.filter(item => !item.readBy.some(read => read.userId === userId)).length;
  return { notifications, unread };
}

/** Marks one notification as read for this member. Returns false when it is not theirs (or does not exist). */
export async function markRead(guildId: string, userId: string, id: string) {
  if (!/^\d{1,18}$/.test(id)) return false;
  const { data: row, error } = await supabase.from('staff_notifications').select('*').eq('id', id).eq('guild_id', guildId).maybeSingle();
  if (error) { logDbIssue(error, 'Notifications'); return false; }
  if (!row || (row.recipient_user_id && row.recipient_user_id !== userId)) return false;
  const readBy = (Array.isArray(row.read_by) ? row.read_by : []).filter((read: StaffNotificationRead) => read.userId !== userId);
  readBy.push({ userId, readAt: new Date().toISOString() });
  const { error: updateError } = await supabase.from('staff_notifications').update({ read_by: readBy }).eq('id', id);
  if (updateError) throw new Error(updateError.message);
  return true;
}
