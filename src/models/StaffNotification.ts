import { SupabaseModel } from '../supabase/model.js';

export type NotificationLevel = 'info' | 'warning' | 'important';
export type NotificationDelivery = 'dashboard' | 'discord' | 'both';
export type StaffNotificationRead = { userId: string; readAt: string };
export type StaffNotificationDoc = {
  id: number; guildId: string; recipientUserId: string | null; senderUserId: string; senderName: string; type: string;
  level: NotificationLevel; delivery: NotificationDelivery; title: string; message: string; link: string;
  readBy: StaffNotificationRead[]; createdAt: Date; updatedAt: Date;
};
export const StaffNotification = new SupabaseModel<StaffNotificationDoc>({
  table: 'staff_notifications',
  columns: { id: 'id', guildId: 'guild_id', recipientUserId: 'recipient_user_id', senderUserId: 'sender_user_id', senderName: 'sender_name', type: 'type', level: 'level', delivery: 'delivery', title: 'title', message: 'message', link: 'link', readBy: 'read_by', createdAt: 'created_at', updatedAt: 'updated_at' },
  dates: ['createdAt', 'updatedAt'],
  defaults: { recipientUserId: null, senderName: '', type: 'admin_note', level: 'info', delivery: 'both', title: '', link: '', readBy: [] }
});
