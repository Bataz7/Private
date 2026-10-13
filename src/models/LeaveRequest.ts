import { SupabaseModel } from '../supabase/model.js';

export type LeaveRequestDoc = {
  id: number; guildId: string; userId: string; startDate: Date; endDate: Date; reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'returned';
  previousRoleIds: string[]; leaveRoleId: string | null;
  /** Set once the leave has actually started (roles swapped), so the watchdog never starts it twice. */
  activatedAt: Date | null;
  /** The "request received" DM, edited when a decision is made. */
  dmMessageId: string | null;
  reviewedBy: string | null; reviewedAt: Date | null; returnedAt: Date | null; rejectionReason: string | null; decisionNote: string;
  /** A member's request for more time. The end date only changes when an administrator approves it. */
  extensionEndDate: Date | null; extensionRequestedAt: Date | null; extensionChannelId: string | null; extensionMessageId: string | null;
  endReminderAt: Date | null; endReminderTriedAt: Date | null; endReminderCount: number;
  /** The review card in the requests channel. */
  reviewChannelId: string | null; reviewMessageId: string | null;
  createdAt: Date;
};
export const LeaveRequest = new SupabaseModel<LeaveRequestDoc>({
  table: 'leave_requests',
  columns: {
    id: 'id', guildId: 'guild_id', userId: 'user_id', startDate: 'start_date', endDate: 'end_date', reason: 'reason', status: 'status', previousRoleIds: 'previous_role_ids', leaveRoleId: 'leave_role_id',
    activatedAt: 'activated_at', dmMessageId: 'dm_message_id', reviewedBy: 'reviewed_by', reviewedAt: 'reviewed_at', returnedAt: 'returned_at', rejectionReason: 'rejection_reason', decisionNote: 'decision_note',
    extensionEndDate: 'extension_end_date', extensionRequestedAt: 'extension_requested_at', extensionChannelId: 'extension_channel_id', extensionMessageId: 'extension_message_id',
    endReminderAt: 'end_reminder_at', endReminderTriedAt: 'end_reminder_tried_at', endReminderCount: 'end_reminder_count', reviewChannelId: 'review_channel_id', reviewMessageId: 'review_message_id', createdAt: 'created_at',
  },
  dates: ['startDate', 'endDate', 'activatedAt', 'reviewedAt', 'returnedAt', 'extensionEndDate', 'extensionRequestedAt', 'endReminderAt', 'endReminderTriedAt', 'createdAt'],
  defaults: {
    status: 'pending', previousRoleIds: [], leaveRoleId: null, activatedAt: null, dmMessageId: null, reviewedBy: null, reviewedAt: null, returnedAt: null, rejectionReason: null, decisionNote: '',
    extensionEndDate: null, extensionRequestedAt: null, extensionChannelId: null, extensionMessageId: null, endReminderAt: null, endReminderTriedAt: null, endReminderCount: 0, reviewChannelId: null, reviewMessageId: null,
  },
});
