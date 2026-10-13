/** ثوابت بنفس أسماء discord.js (عشان الكود القديم يشتغل بدون تغيير). */
export const GatewayIntentBits = {
  Guilds: 1 << 0, GuildMembers: 1 << 1, GuildModeration: 1 << 2, GuildEmojisAndStickers: 1 << 3, GuildIntegrations: 1 << 4,
  GuildWebhooks: 1 << 5, GuildInvites: 1 << 6, GuildVoiceStates: 1 << 7, GuildPresences: 1 << 8, GuildMessages: 1 << 9,
  GuildMessageReactions: 1 << 10, GuildMessageTyping: 1 << 11, DirectMessages: 1 << 12, DirectMessageReactions: 1 << 13,
  DirectMessageTyping: 1 << 14, MessageContent: 1 << 15, GuildScheduledEvents: 1 << 16,
} as const;

export const Partials = { User: 0, Channel: 1, GuildMember: 2, Message: 3, Reaction: 4 } as const;

export const Events = {
  ClientReady: "clientReady", InteractionCreate: "interactionCreate", MessageCreate: "messageCreate",
  MessageDelete: "messageDelete", MessageUpdate: "messageUpdate", VoiceStateUpdate: "voiceStateUpdate",
  GuildMemberAdd: "guildMemberAdd", GuildMemberRemove: "guildMemberRemove", GuildMemberUpdate: "guildMemberUpdate",
  GuildCreate: "guildCreate", GuildDelete: "guildDelete", Error: "error", Warn: "warn",
} as const;

export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5, Premium: 6 } as const;
export type ButtonStyle = (typeof ButtonStyle)[keyof typeof ButtonStyle];
export const TextInputStyle = { Short: 1, Paragraph: 2 } as const;
export type TextInputStyle = (typeof TextInputStyle)[keyof typeof TextInputStyle];

export const MessageFlags = {
  Crossposted: 1 << 0, IsCrosspost: 1 << 1, SuppressEmbeds: 1 << 2, SourceMessageDeleted: 1 << 3, Urgent: 1 << 4,
  HasThread: 1 << 5, Ephemeral: 1 << 6, Loading: 1 << 7, SuppressNotifications: 1 << 12, IsVoiceMessage: 1 << 13,
  IsComponentsV2: 1 << 15,
} as const;
// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace MessageFlags {
  type IsComponentsV2 = 32768;
  type Ephemeral = 64;
}

export const ChannelType = {
  GuildText: 0, DM: 1, GuildVoice: 2, GroupDM: 3, GuildCategory: 4, GuildAnnouncement: 5, AnnouncementThread: 10,
  PublicThread: 11, PrivateThread: 12, GuildStageVoice: 13, GuildDirectory: 14, GuildForum: 15, GuildMedia: 16,
} as const;
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

export const ActivityType = { Playing: 0, Streaming: 1, Listening: 2, Watching: 3, Custom: 4, Competing: 5 } as const;
export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

export const InteractionContextType = { Guild: 0, BotDM: 1, PrivateChannel: 2 } as const;
export type InteractionContextType = (typeof InteractionContextType)[keyof typeof InteractionContextType];
export const ApplicationIntegrationType = { GuildInstall: 0, UserInstall: 1 } as const;

export const InteractionType = { Ping: 1, ApplicationCommand: 2, MessageComponent: 3, ApplicationCommandAutocomplete: 4, ModalSubmit: 5 } as const;
export const InteractionResponseType = {
  Pong: 1, ChannelMessageWithSource: 4, DeferredChannelMessageWithSource: 5, DeferredMessageUpdate: 6, UpdateMessage: 7,
  ApplicationCommandAutocompleteResult: 8, Modal: 9,
} as const;
export const ComponentType = {
  ActionRow: 1, Button: 2, StringSelect: 3, TextInput: 4, UserSelect: 5, RoleSelect: 6, MentionableSelect: 7, ChannelSelect: 8,
  Section: 9, TextDisplay: 10, Thumbnail: 11, MediaGallery: 12, File: 13, Separator: 14, Container: 17, Label: 18,
} as const;
export const ApplicationCommandOptionType = {
  Subcommand: 1, SubcommandGroup: 2, String: 3, Integer: 4, Boolean: 5, User: 6, Channel: 7, Role: 8, Mentionable: 9, Number: 10, Attachment: 11,
} as const;

export type PresenceStatusData = "online" | "idle" | "dnd" | "invisible";
export interface ActivitiesOptions { name?: string; type?: ActivityType | number; url?: string; state?: string }

export const PermissionFlagsBits = {
  CreateInstantInvite: 1n << 0n, KickMembers: 1n << 1n, BanMembers: 1n << 2n, Administrator: 1n << 3n, ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n, AddReactions: 1n << 6n, ViewAuditLog: 1n << 7n, PrioritySpeaker: 1n << 8n, Stream: 1n << 9n,
  ViewChannel: 1n << 10n, SendMessages: 1n << 11n, SendTTSMessages: 1n << 12n, ManageMessages: 1n << 13n, EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n, ReadMessageHistory: 1n << 16n, MentionEveryone: 1n << 17n, UseExternalEmojis: 1n << 18n,
  ViewGuildInsights: 1n << 19n, Connect: 1n << 20n, Speak: 1n << 21n, MuteMembers: 1n << 22n, DeafenMembers: 1n << 23n,
  MoveMembers: 1n << 24n, UseVAD: 1n << 25n, ChangeNickname: 1n << 26n, ManageNicknames: 1n << 27n, ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n, ManageGuildExpressions: 1n << 30n, ManageEmojisAndStickers: 1n << 30n, UseApplicationCommands: 1n << 31n,
  RequestToSpeak: 1n << 32n, ManageEvents: 1n << 33n, ManageThreads: 1n << 34n, CreatePublicThreads: 1n << 35n,
  CreatePrivateThreads: 1n << 36n, UseExternalStickers: 1n << 37n, SendMessagesInThreads: 1n << 38n,
  UseEmbeddedActivities: 1n << 39n, ModerateMembers: 1n << 40n, ViewCreatorMonetizationAnalytics: 1n << 41n,
  UseSoundboard: 1n << 42n, CreateGuildExpressions: 1n << 43n, CreateEvents: 1n << 44n, UseExternalSounds: 1n << 45n,
  SendVoiceMessages: 1n << 46n, SendPolls: 1n << 49n, UseExternalApps: 1n << 50n,
} as const;
export type PermissionResolvable = bigint | keyof typeof PermissionFlagsBits | PermissionResolvable[] | PermissionsBitField | string | number;

export const ALL_PERMISSIONS = Object.values(PermissionFlagsBits).reduce((a, b) => a | b, 0n);

export class PermissionsBitField {
  static Flags = PermissionFlagsBits;
  static All = ALL_PERMISSIONS;
  bitfield: bigint;
  constructor(bits: PermissionResolvable = 0n) {
    this.bitfield = PermissionsBitField.resolve(bits);
  }
  static resolve(bits: PermissionResolvable): bigint {
    if (typeof bits === "bigint") return bits;
    if (typeof bits === "number") return BigInt(bits);
    if (bits instanceof PermissionsBitField) return bits.bitfield;
    if (Array.isArray(bits)) return bits.reduce<bigint>((a, b) => a | PermissionsBitField.resolve(b), 0n);
    if (typeof bits === "string") {
      if (/^\d+$/.test(bits)) return BigInt(bits);
      const flag = (PermissionFlagsBits as Record<string, bigint>)[bits];
      if (flag === undefined) throw new RangeError(`Unknown permission: ${bits}`);
      return flag;
    }
    return 0n;
  }
  /** مثل discord.js: الأدمن يملك كل الصلاحيات (checkAdmin افتراضياً true). */
  has(bits: PermissionResolvable, checkAdmin = true): boolean {
    const b = PermissionsBitField.resolve(bits);
    if (checkAdmin && (this.bitfield & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return true;
    return (this.bitfield & b) === b;
  }
  any(bits: PermissionResolvable, checkAdmin = true): boolean {
    const b = PermissionsBitField.resolve(bits);
    if (checkAdmin && (this.bitfield & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return true;
    return (this.bitfield & b) !== 0n;
  }
  missing(bits: PermissionResolvable): string[] {
    const want = PermissionsBitField.resolve(bits);
    return Object.entries(PermissionFlagsBits).filter(([, v]) => (want & v) === v && !this.has(v)).map(([k]) => k);
  }
  toArray(): string[] {
    return Object.entries(PermissionFlagsBits).filter(([, v]) => (this.bitfield & v) === v).map(([k]) => k);
  }
  serialize(): Record<string, boolean> {
    return Object.fromEntries(Object.entries(PermissionFlagsBits).map(([k, v]) => [k, (this.bitfield & v) === v]));
  }
  valueOf() {
    return this.bitfield;
  }
  toJSON() {
    return this.bitfield.toString();
  }
}
