import type { Answers, FormSettings, Language, Question } from '../applications/questions.js';

export interface ApplicationFormDoc {
  id: string;
  guildId: string;
  title: string;
  description: string;
  open: boolean;
  questions: Question[];
  settings: Partial<FormSettings>;
  panel: { channelId: string; messageId: string };
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ApplicationStatus = 'in_progress' | 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';

export interface ApplicationDoc {
  id: string;
  guildId: string;
  formId: string;
  formTitle: string;
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  source: 'dm' | 'web';
  status: ApplicationStatus;
  questions: Question[];
  answers: Answers;
  cursor: string;
  editing: boolean;
  promptMessageId: string;
  dmChannelId: string;
  lastActivityAt: Date;
  timeoutMinutes: number;
  submittedAt: Date | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  decisionReason: string;
  reviewChannelId: string;
  reviewMessageId: string;
  reviewThreadId: string;
  notes: Array<{ text: string; userId: string; name: string; createdAt: Date }>;
  votes: Array<{ userId: string; value: 'up' | 'down' }>;
  accountCreatedAt: Date | null;
  memberJoinedAt: Date | null;
  meta: { lang?: Language; color?: string; guildName?: string };
  createdAt: Date;
  updatedAt: Date;
}

// ---- Row mapping (Postgres snake_case <-> camelCase documents) ------------------------------------

const FORM_COLUMNS = {
  guildId: 'guild_id', title: 'title', description: 'description', open: 'open', questions: 'questions', settings: 'settings',
  createdBy: 'created_by', updatedBy: 'updated_by',
} as const;

const APP_COLUMNS = {
  guildId: 'guild_id', formId: 'form_id', formTitle: 'form_title', userId: 'user_id', username: 'username', displayName: 'display_name', avatar: 'avatar',
  source: 'source', status: 'status', questions: 'questions', answers: 'answers', cursor: 'cursor', editing: 'editing', promptMessageId: 'prompt_message_id',
  dmChannelId: 'dm_channel_id', lastActivityAt: 'last_activity_at', timeoutMinutes: 'timeout_minutes', submittedAt: 'submitted_at', reviewedBy: 'reviewed_by',
  reviewedAt: 'reviewed_at', decisionReason: 'decision_reason', reviewChannelId: 'review_channel_id', reviewMessageId: 'review_message_id',
  reviewThreadId: 'review_thread_id', notes: 'notes', votes: 'votes', accountCreatedAt: 'account_created_at', memberJoinedAt: 'member_joined_at', meta: 'meta',
} as const;

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value);
const date = (value: unknown) => (value ? new Date(String(value)) : null);
const dateOr = (value: unknown) => (value ? new Date(String(value)) : new Date(0));

/** Turns a partial document (camelCase, Dates) into a Postgres patch. Unknown keys are ignored. */
export function toRow(columns: Record<string, string>, patch: Record<string, unknown>) {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === 'panel') {
      const panel = value as { channelId?: string; messageId?: string };
      if (panel.channelId !== undefined) row.panel_channel_id = panel.channelId;
      if (panel.messageId !== undefined) row.panel_message_id = panel.messageId;
      continue;
    }
    const column = columns[key];
    if (column) row[column] = iso(value);
  }
  return row;
}
export const formRow = (patch: Partial<ApplicationFormDoc>) => toRow(FORM_COLUMNS, patch as Record<string, unknown>);
export const applicationRow = (patch: Partial<ApplicationDoc>) => toRow(APP_COLUMNS, patch as Record<string, unknown>);

export function formFromRow(row: Record<string, any>): ApplicationFormDoc {
  return {
    id: String(row.id), guildId: row.guild_id, title: row.title ?? '', description: row.description ?? '', open: Boolean(row.open),
    questions: Array.isArray(row.questions) ? row.questions : [], settings: row.settings && typeof row.settings === 'object' ? row.settings : {},
    panel: { channelId: row.panel_channel_id ?? '', messageId: row.panel_message_id ?? '' },
    createdBy: row.created_by ?? '', updatedBy: row.updated_by ?? '', createdAt: dateOr(row.created_at), updatedAt: dateOr(row.updated_at),
  };
}

export function applicationFromRow(row: Record<string, any>): ApplicationDoc {
  return {
    id: String(row.id), guildId: row.guild_id, formId: String(row.form_id), formTitle: row.form_title ?? '', userId: row.user_id,
    username: row.username ?? '', displayName: row.display_name ?? '', avatar: row.avatar ?? '', source: row.source === 'web' ? 'web' : 'dm',
    status: row.status, questions: Array.isArray(row.questions) ? row.questions : [], answers: row.answers && typeof row.answers === 'object' ? row.answers : {},
    cursor: row.cursor ?? '', editing: Boolean(row.editing), promptMessageId: row.prompt_message_id ?? '', dmChannelId: row.dm_channel_id ?? '',
    lastActivityAt: dateOr(row.last_activity_at), timeoutMinutes: Number(row.timeout_minutes) || 30, submittedAt: date(row.submitted_at),
    reviewedBy: row.reviewed_by ?? null, reviewedAt: date(row.reviewed_at), decisionReason: row.decision_reason ?? '',
    reviewChannelId: row.review_channel_id ?? '', reviewMessageId: row.review_message_id ?? '', reviewThreadId: row.review_thread_id ?? '',
    notes: Array.isArray(row.notes) ? row.notes : [], votes: Array.isArray(row.votes) ? row.votes : [],
    accountCreatedAt: date(row.account_created_at), memberJoinedAt: date(row.member_joined_at),
    meta: row.meta && typeof row.meta === 'object' ? row.meta : {}, createdAt: dateOr(row.created_at), updatedAt: dateOr(row.updated_at),
  };
}
