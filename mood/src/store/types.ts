/** واجهة التخزين الموحدة — كل أنواع قواعد البيانات تطبّقها (SQLite / PostgreSQL / MySQL / MongoDB). */

export interface Entry {
  user_id: string;
  day: string;
  mood: number;
  energy: number | null;
  sleep: number | null;
  highlight: string;
  problems: string;
  gratitude: string;
  tags: string[];
  /** معرّف سؤال اليوم */
  question: string;
  /** جواب سؤال اليوم */
  answer: string;
  ai_reply: string;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  lang: string | null;
  timezone: string | null;
  checkin_minutes: number | null;
  reminder_hours: number | null;
  paused_until: string | null;
  last_prompt_day: string | null;
  /** وقت إرسال آخر سؤال (ISO) — للتذكير */
  last_prompt_at: string | null;
  last_prompt_channel: string | null;
  last_prompt_message: string | null;
  last_reminder_day: string | null;
  dm_failed: number;
  created_at: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export type EntryInput = Pick<Entry, "user_id" | "day" | "mood"> &
  Partial<Pick<Entry, "energy" | "sleep" | "highlight" | "problems" | "gratitude" | "tags" | "question" | "answer">>;

export type UserPatch = Partial<Omit<UserRow, "id" | "created_at">>;

export interface Achievement {
  code: string;
  unlocked_at: string;
}

/** نسخة كاملة من البيانات (للنسخ الاحتياطي والنقل بين قواعد البيانات). */
export interface Dump {
  version: 2;
  exported_at: string;
  users: UserRow[];
  entries: Entry[];
  chat: (ChatTurn & { user_id: string; created_at: string })[];
  achievements: (Achievement & { user_id: string })[];
  meta: { key: string; value: string }[];
}

export type StoreKind = "sqlite" | "postgres" | "mysql" | "mongodb";

export interface Store {
  readonly kind: StoreKind;
  init(): Promise<void>;
  close(): Promise<void>;

  ensureUser(id: string): Promise<UserRow>;
  getUser(id: string): Promise<UserRow | undefined>;
  updateUser(id: string, patch: UserPatch): Promise<void>;

  upsertEntry(e: EntryInput): Promise<Entry>;
  getEntry(userId: string, day: string): Promise<Entry | undefined>;
  setTags(userId: string, day: string, tags: string[]): Promise<void>;
  setAiReply(userId: string, day: string, text: string): Promise<void>;
  /** من الأقدم للأحدث */
  entriesBetween(userId: string, start: string, end: string): Promise<Entry[]>;
  allEntries(userId: string): Promise<Entry[]>;
  allDays(userId: string): Promise<Set<string>>;
  countEntries(userId: string): Promise<number>;

  addChat(userId: string, role: ChatTurn["role"], content: string, keep?: number): Promise<void>;
  recentChat(userId: string, n?: number): Promise<ChatTurn[]>;
  clearChat(userId: string): Promise<void>;

  /** true لو انفتح لأول مرة */
  unlock(userId: string, code: string): Promise<boolean>;
  achievements(userId: string): Promise<Achievement[]>;

  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;
  /** true لو هذي أول مرة (ويسجّلها) */
  once(key: string): Promise<boolean>;

  deleteUserData(userId: string): Promise<void>;
  /** نسخة احتياطية في المجلد + حذف القديم، ويرجع مسار الملف */
  backup(dir: string, day: string, keep: number): Promise<string>;
  exportAll(): Promise<Dump>;
  importAll(dump: Dump): Promise<void>;
}

export const USER_FIELDS = [
  "lang", "timezone", "checkin_minutes", "reminder_hours", "paused_until", "last_prompt_day", "last_prompt_at",
  "last_prompt_channel", "last_prompt_message", "last_reminder_day", "dm_failed",
] as const;

export const nowIso = () => new Date().toISOString();

export function emptyUser(id: string): UserRow {
  return {
    id, lang: null, timezone: null, checkin_minutes: null, reminder_hours: null, paused_until: null,
    last_prompt_day: null, last_prompt_at: null, last_prompt_channel: null, last_prompt_message: null, last_reminder_day: null,
    dm_failed: 0, created_at: nowIso(),
  };
}

export class StoreError extends Error {}
