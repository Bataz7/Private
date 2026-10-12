/** ثوابت Discord API v10 — معرّفة هنا بدل أي مكتبة عشان البوت يشتغل بدون اعتماديات. */
export const API_BASE = "https://discord.com/api/v10";
export const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
export const CDN = "https://cdn.discordapp.com";

export const Intents = {
  Guilds: 1 << 0,
  GuildMembers: 1 << 1,
  GuildModeration: 1 << 2,
  GuildInvites: 1 << 6,
  GuildVoiceStates: 1 << 7,
  GuildMessages: 1 << 9,
  GuildMessageReactions: 1 << 10,
  DirectMessages: 1 << 12,
  DirectMessageReactions: 1 << 13,
  MessageContent: 1 << 15,
} as const;

export const GatewayOp = {
  Dispatch: 0, Heartbeat: 1, Identify: 2, PresenceUpdate: 3, Resume: 6, Reconnect: 7,
  RequestGuildMembers: 8, InvalidSession: 9, Hello: 10, HeartbeatAck: 11,
} as const;

/** أكواد إغلاق ما ينفع نعيد الاتصال بعدها (توكن غلط، intents غلط…). */
export const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
/** أكواد تخلي الجلسة باطلة: identify جديد بدل resume. */
export const RESET_SESSION_CODES = new Set([4007, 4009]);

export const InteractionType = { Ping: 1, Command: 2, Component: 3, Autocomplete: 4, Modal: 5 } as const;

export const ResponseType = {
  Pong: 1, Message: 4, DeferredMessage: 5, DeferredUpdate: 6, Update: 7, Autocomplete: 8, Modal: 9,
} as const;

export const ComponentType = {
  Row: 1, Button: 2, StringSelect: 3, TextInput: 4, UserSelect: 5, RoleSelect: 6, MentionableSelect: 7,
  ChannelSelect: 8, Section: 9, TextDisplay: 10, Thumbnail: 11, MediaGallery: 12, File: 13, Separator: 14,
  Container: 17, Label: 18,
} as const;

export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 } as const;
export const TextInputStyle = { Short: 1, Paragraph: 2 } as const;
export const MessageFlags = { Ephemeral: 1 << 6, SuppressEmbeds: 1 << 2, ComponentsV2: 1 << 15 } as const;

export const OptionType = {
  Subcommand: 1, Group: 2, String: 3, Integer: 4, Boolean: 5, User: 6, Channel: 7, Role: 8,
  Mentionable: 9, Number: 10, Attachment: 11,
} as const;

export const ChannelType = {
  Text: 0, DM: 1, Voice: 2, Category: 4, News: 5, NewsThread: 10, PublicThread: 11, PrivateThread: 12,
  Stage: 13, Forum: 15,
} as const;

/** صلاحيات ديسكورد (bigint). */
export const P = {
  CreateInvite: 1n << 0n, KickMembers: 1n << 1n, BanMembers: 1n << 2n, Administrator: 1n << 3n,
  ManageChannels: 1n << 4n, ManageGuild: 1n << 5n, AddReactions: 1n << 6n, ViewAuditLog: 1n << 7n,
  ViewChannel: 1n << 10n, SendMessages: 1n << 11n, ManageMessages: 1n << 13n, EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n, ReadMessageHistory: 1n << 16n, MentionEveryone: 1n << 17n, Connect: 1n << 20n,
  Speak: 1n << 21n, MuteMembers: 1n << 22n, MoveMembers: 1n << 24n, ChangeNickname: 1n << 26n,
  ManageNicknames: 1n << 27n, ManageRoles: 1n << 28n, ManageWebhooks: 1n << 29n,
  ManageExpressions: 1n << 30n, ModerateMembers: 1n << 40n,
} as const;
export const ALL_PERMS = (1n << 53n) - 1n;

export const ErrorCode = {
  UnknownMessage: 10008, UnknownMember: 10007, UnknownUser: 10013, UnknownInteraction: 10062,
  MissingAccess: 50001, CannotSendToUser: 50007, MissingPermissions: 50013, AlreadyAcknowledged: 40060,
} as const;

/** أنواع أحداث سجل التدقيق (audit log) اللي نستخدمها. */
export const AuditAction = {
  GuildUpdate: 1, ChannelCreate: 10, ChannelUpdate: 11, ChannelDelete: 12, OverwriteCreate: 13,
  OverwriteUpdate: 14, OverwriteDelete: 15, MemberKick: 20, MemberPrune: 21, MemberBanAdd: 22,
  MemberBanRemove: 23, MemberUpdate: 24, MemberRoleUpdate: 25, MemberMove: 26, MemberDisconnect: 27,
  BotAdd: 28, RoleCreate: 30, RoleUpdate: 31, RoleDelete: 32, InviteCreate: 40, InviteDelete: 42,
  WebhookCreate: 50, WebhookUpdate: 51, WebhookDelete: 52, MessageDelete: 72, MessageBulkDelete: 73,
} as const;
