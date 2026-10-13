/**
 * djs — بديل خفيف لـ discord.js بنفس الواجهة اللي يستخدمها Rift، بدون أي مكتبات خارجية.
 * الاستخدام: import { Client, EmbedBuilder, … } from '../lib/djs/index.js'
 */
export * from "./enums.ts";
export * from "./collection.ts";
export * from "./builders.ts";
export * from "./structures.ts";
export * from "./interactions.ts";
export * from "./client.ts";
export * from "./localization.ts";
export { setOutgoingTransform, toPayload } from "./payload.ts";
export type { MessageOptions as MessageCreateOptions, MessageOptions as InteractionReplyOptions, MessageOptions as MessageEditOptions, MessageOptions as BaseMessageOptions } from "./payload.ts";
export type { MessageOptions as MessagePayload } from "./payload.ts";
export type Snowflake = string;
export type GuildBasedChannel = import("./structures.ts").BaseChannel;
export type PartialGuildMember = import("./structures.ts").GuildMember;
export type APIInteractionGuildMember = import("./structures.ts").GuildMember;
