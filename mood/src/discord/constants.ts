/**
 * ثوابت Discord API v10.
 * نعرّفها هنا بدل enums مكتبة discord-api-types لأن المكتبة dev-only (للأنواع فقط)
 * والبوت يشتغل بدون أي مكتبة خارجية.
 */
export const API_BASE = "https://discord.com/api/v10";
export const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

export const Intents = {
  Guilds: 1 << 0,
  DirectMessages: 1 << 12,
} as const;

export const GatewayOp = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  PresenceUpdate: 3,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const;

/** أكواد إغلاق ما ينفع نعيد الاتصال بعدها (توكن غلط، intents غلط…). */
export const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
/** أكواد تخلي الجلسة باطلة: نسوي identify جديد بدل resume. */
export const RESET_SESSION_CODES = new Set([4007, 4009]);

export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  Autocomplete: 4,
  ModalSubmit: 5,
} as const;

export const ResponseType = {
  Pong: 1,
  ChannelMessage: 4,
  DeferredChannelMessage: 5,
  DeferredUpdateMessage: 6,
  UpdateMessage: 7,
  AutocompleteResult: 8,
  Modal: 9,
} as const;

export const ComponentType = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  TextInput: 4,
} as const;

export const ButtonStyle = {
  Primary: 1,
  Secondary: 2,
  Success: 3,
  Danger: 4,
  Link: 5,
} as const;

export const TextInputStyle = { Short: 1, Paragraph: 2 } as const;

export const MessageFlags = { Ephemeral: 1 << 6 } as const;

export const OptionType = {
  Subcommand: 1,
  String: 3,
  Integer: 4,
  Boolean: 5,
  User: 6,
} as const;

export const ActivityType = { Custom: 4 } as const;

/** أكواد أخطاء JSON مهمة. */
export const ErrorCode = {
  UnknownInteraction: 10062,
  CannotSendToUser: 50007,
  InteractionAlreadyAcknowledged: 40060,
} as const;
