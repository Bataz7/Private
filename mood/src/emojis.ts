/**
 * ايموجيات البوت الخاصة: نرفعها تلقائياً كـ Application Emojis
 * (تشتغل في الخاص وفي أي سيرفر بدون ما تحتاج صلاحيات).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DiscordClient } from "./discord/api.ts";
import type { Logger } from "./log.ts";

export const EMOJI_DIR = fileURLToPath(new URL("../assets/emojis/", import.meta.url));

/** إيموجي احتياطي لو ما انرفعت الخاصة. */
export const FALLBACK: Record<string, string> = {
  mood_great: "😄", mood_good: "🙂", mood_okay: "😐", mood_bad: "😕", mood_awful: "😢",
  mood_report: "📊", mood_fire: "🔥", mood_heart: "💛", mood_sleep: "😴", mood_energy: "⚡", mood_trophy: "🏆",
};

export interface ComponentEmoji {
  id?: string;
  name: string;
}

export class EmojiStore {
  private readonly ids = new Map<string, string>();

  /** يرفع الناقص ويحفظ المعرفات. أي خطأ ما يوقف البوت — نرجع للإيموجي العادي. */
  async sync(discord: DiscordClient, log: Logger, dir = EMOJI_DIR): Promise<void> {
    try {
      const existing = await discord.listAppEmojis();
      for (const e of existing) if (e.id && e.name) this.ids.set(e.name, e.id);
      const files = readdirSync(dir).filter((f) => f.endsWith(".png"));
      let uploaded = 0;
      for (const f of files) {
        const name = f.slice(0, -4);
        if (this.ids.has(name)) continue;
        try {
          const created = await discord.createAppEmoji(name, readFileSync(dir + f));
          if (created.id) this.ids.set(name, created.id);
          uploaded++;
        } catch (e) {
          log.warn(`could not upload emoji ${name}:`, (e as Error).message);
        }
      }
      log.info(`\x1b[32m✓\x1b[0m emojis    ${this.ids.size} ready${uploaded ? ` (${uploaded} uploaded now)` : ""}`);
    } catch (e) {
      log.warn("emoji sync failed, using standard emojis:", (e as Error).message);
    }
  }

  set(name: string, id: string): void {
    this.ids.set(name, id);
  }

  /** للنص: <:name:id> أو الإيموجي العادي */
  t(name: string): string {
    const id = this.ids.get(name);
    return id ? `<:${name}:${id}>` : (FALLBACK[name] ?? "•");
  }

  /** للأزرار والقوائم */
  c(name: string): ComponentEmoji {
    const id = this.ids.get(name);
    return id ? { id, name } : { name: FALLBACK[name] ?? "•" };
  }

  get count(): number {
    return this.ids.size;
  }
}
