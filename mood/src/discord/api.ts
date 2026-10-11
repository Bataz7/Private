/** دوال عالية المستوى فوق REST: رسائل خاصة، ردود التفاعلات، الايموجيات، الأوامر. */
import type {
  APIApplication,
  APIChannel,
  APIEmoji,
  APIInteraction,
  APIMessage,
  APIUser,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import { MessageFlags, ResponseType } from "./constants.ts";
import type { FileUpload, REST } from "./rest.ts";

export interface MessagePayload {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
  flags?: number;
  allowed_mentions?: unknown;
  message_reference?: { message_id: string; fail_if_not_exists?: boolean };
  attachments?: unknown[];
}

export class DiscordClient {
  readonly rest: REST;
  applicationId = "";
  user: APIUser | null = null;
  private readonly dmChannels = new Map<string, string>();
  private readonly users = new Map<string, { user: APIUser; at: number }>();

  constructor(rest: REST) {
    this.rest = rest;
  }

  async init(): Promise<void> {
    const app = await this.rest.get<APIApplication>("/applications/@me");
    this.applicationId = app.id;
  }

  // ─────────── المستخدمين والرسائل ───────────

  async getUser(id: string): Promise<APIUser> {
    const cached = this.users.get(id);
    if (cached && Date.now() - cached.at < 3_600_000) return cached.user;
    const user = await this.rest.get<APIUser>(`/users/${id}`);
    this.users.set(id, { user, at: Date.now() });
    return user;
  }

  async displayName(id: string): Promise<string> {
    try {
      const u = await this.getUser(id);
      return u.global_name ?? u.username;
    } catch {
      return "صديقنا";
    }
  }

  async dmChannel(userId: string): Promise<string> {
    const cached = this.dmChannels.get(userId);
    if (cached) return cached;
    const ch = await this.rest.post<APIChannel>("/users/@me/channels", { body: { recipient_id: userId } });
    this.dmChannels.set(userId, ch.id);
    return ch.id;
  }

  sendMessage(channelId: string, payload: MessagePayload, files?: FileUpload[]): Promise<APIMessage> {
    return this.rest.post<APIMessage>(`/channels/${channelId}/messages`, {
      body: { allowed_mentions: { parse: [] }, ...payload },
      files,
    });
  }

  async sendDM(userId: string, payload: MessagePayload, files?: FileUpload[]): Promise<APIMessage> {
    return this.sendMessage(await this.dmChannel(userId), payload, files);
  }

  editMessage(channelId: string, messageId: string, payload: MessagePayload): Promise<APIMessage> {
    return this.rest.patch<APIMessage>(`/channels/${channelId}/messages/${messageId}`, { body: payload });
  }

  async typing(channelId: string): Promise<void> {
    await this.rest.post(`/channels/${channelId}/typing`).catch(() => undefined);
  }

  // ─────────── التفاعلات ───────────

  private callback(i: APIInteraction, body: unknown, files?: FileUpload[]): Promise<unknown> {
    return this.rest.post(`/interactions/${i.id}/${i.token}/callback`, { body, files, auth: false });
  }

  reply(i: APIInteraction, data: MessagePayload, opts: { ephemeral?: boolean; files?: FileUpload[] } = {}) {
    const flags = (data.flags ?? 0) | (opts.ephemeral ? MessageFlags.Ephemeral : 0);
    return this.callback(i, { type: ResponseType.ChannelMessage, data: { allowed_mentions: { parse: [] }, ...data, flags } }, opts.files);
  }

  defer(i: APIInteraction, ephemeral = false) {
    return this.callback(i, { type: ResponseType.DeferredChannelMessage, data: { flags: ephemeral ? MessageFlags.Ephemeral : 0 } });
  }

  deferUpdate(i: APIInteraction) {
    return this.callback(i, { type: ResponseType.DeferredUpdateMessage });
  }

  update(i: APIInteraction, data: MessagePayload) {
    return this.callback(i, { type: ResponseType.UpdateMessage, data });
  }

  modal(i: APIInteraction, modal: { custom_id: string; title: string; components: unknown[] }) {
    return this.callback(i, { type: ResponseType.Modal, data: modal });
  }

  autocomplete(i: APIInteraction, choices: { name: string; value: string | number }[]) {
    return this.callback(i, { type: ResponseType.AutocompleteResult, data: { choices: choices.slice(0, 25) } });
  }

  followup(i: APIInteraction, data: MessagePayload, opts: { ephemeral?: boolean; files?: FileUpload[] } = {}) {
    const flags = (data.flags ?? 0) | (opts.ephemeral ? MessageFlags.Ephemeral : 0);
    return this.rest.post<APIMessage>(`/webhooks/${this.applicationId}/${i.token}`, {
      body: { allowed_mentions: { parse: [] }, ...data, flags },
      files: opts.files,
      auth: false,
    });
  }

  editOriginal(i: APIInteraction, data: MessagePayload, files?: FileUpload[]) {
    return this.rest.patch<APIMessage>(`/webhooks/${this.applicationId}/${i.token}/messages/@original`, {
      body: data,
      files,
      auth: false,
    });
  }

  // ─────────── الأوامر والايموجيات ───────────

  setGlobalCommands(commands: RESTPostAPIApplicationCommandsJSONBody[]) {
    return this.rest.put(`/applications/${this.applicationId}/commands`, { body: commands });
  }

  async listAppEmojis(): Promise<APIEmoji[]> {
    const r = await this.rest.get<{ items: APIEmoji[] }>(`/applications/${this.applicationId}/emojis`);
    return r.items ?? [];
  }

  createAppEmoji(name: string, png: Uint8Array): Promise<APIEmoji> {
    const image = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
    return this.rest.post<APIEmoji>(`/applications/${this.applicationId}/emojis`, { body: { name, image } });
  }
}
