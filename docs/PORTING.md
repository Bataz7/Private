# دليل تحويل الأنظمة من Python إلى TypeScript

The bot is being rewritten from Python (discord.py, `cogs/*.py`) to TypeScript on **Bun** with **zero runtime dependencies**, hard target **< 20 MB RAM** for the whole process. The reference implementation is `src/features/police.ts`. Read it first.

## Rules
1. **Behaviour parity.** Port every command, panel, button, select, modal, listener and background loop of the Python cog. Same features, same Arabic texts (improve wording only if clearly broken). All user-facing text is Arabic. Command/option/choice names are Arabic (they are already Arabic in the Python files — keep the exact same names from `@app_commands.command(name=…)`, `Group(name=…)`, `@app_commands.rename(...)` and `Choice(name=…)`).
2. **Data compatibility.** Use the *same* SQLite files, tables, columns and JSON files/shapes as the Python cog (they live in `data/`, existing servers keep their data). Keep `CREATE TABLE IF NOT EXISTS` statements identical; add missing columns with `sql.addColumn(...)`. Keep the same `custom_id` strings for persistent panels/buttons so messages already posted keep working.
3. **Memory.** No per-member caches that grow without bound, no loading whole tables into memory, no large arrays kept around. Prefer SQL queries on demand. Background loops: `setInterval(fn, ms).unref()` and guard against overlap. No image rendering libraries — where Python drew an image (Pillow), use an embed or Components V2 container instead.
4. **No new dependencies.** Only Bun built-ins and `src/core`, `src/discord`.
5. Each system is one file `src/features/<name>.ts` exporting `default function setup(bot: Bot): void`. It is already listed in `src/features/index.ts` (a stub exists — replace it). If a file gets very large you may split helpers into `src/features/<name>/*.ts`.
6. Must pass `./node_modules/.bin/tsc --noEmit` (strict). Use `any` for raw Discord payloads where convenient.
7. Don't touch other agents' files. Only edit your feature files (and you may add tests under `tests/<name>.test.ts`, run with `bun test`). If you need something added to core, write it inside your feature file instead and mention it in your report.

## IDs — important
Discord IDs don't fit in JS numbers. **Always keep IDs as strings.**
- `db(file)` (from `src/core/db.ts`) returns a `Sql` wrapper whose rows already convert big integers to **strings** and small ones to numbers. Bind IDs as strings; SQLite converts them for `INTEGER` columns. If a Python table declared an ID column **without a type** (e.g. `CREATE TABLE x (guild_id, ...)`) or as TEXT, check how Python stored it (int vs str) and bind accordingly (`BigInt(id)` for untyped columns that hold integers).
- `JsonStore` / `parseJson` keep 16+ digit numbers as strings. Python JSON files may have IDs as ints or strings, and dict keys are strings — compare with `String(x)`.
- Python's `str(guild.id)` keys → just the string ID.

## Core API cheat-sheet
```ts
import type { Bot } from "../discord/client.ts";
import type { Ctx } from "../discord/ctx.ts";
import type { CMember } from "../discord/cache.ts";
import { ButtonStyle, ChannelType, MessageFlags, P, ComponentType } from "../discord/constants.ts";
import { db, JsonStore, TTL } from "../core/db.ts";
import { o } from "../core/opts.ts";
import { COLORS, colorOf, embed, field, row, button, linkButton, select, userSelect, roleSelect, channelSelect,
         input, modal, container, section, text, thumb, sep, gallery, V2, mention, ts, now, dur, fmt, clip, emo } from "../core/ui.ts";
import { E } from "../core/emojis.ts";      // E("ticket_close") → custom emoji string or fallback
import { log } from "../core/log.ts";       // log.info/warn/error/err(scope, e) — English console

const sql = db("tickets.db");               // sql.all/get/value/run/exec/tx/addColumn
const store = new JsonStore("tickets_data.json"); // store.get() (cached by mtime) / store.save(data)

export default function setup(bot: Bot) {
  bot.command({
    name: "تذكرة", description: "إدارة التذاكر", perms: P.ManageGuild /* default_member_permissions; omit = everyone */,
    options: [o.sub("اعداد", "…", [o.int("الرقم", "…", { min: 1, max: 10 }), o.role("رتبة_الدعم", "…", { required: false })])],
    run: async (ctx) => { if (ctx.sub === "اعداد") { … } },
    autocomplete: async (ctx) => ctx.autocomplete([{ name: "…", value: "…" }]),
  });
  bot.component("ticket:close:", async (ctx) => { … });   // prefix match on custom_id (longest prefix wins)
  bot.modal("ticket:modal:", async (ctx) => { ctx.fields.get("q1") });
  bot.on("GUILD_MEMBER_ADD", async (d, { member, guild }) => { … });
  bot.on("ready", () => { … });                           // once, after all guilds arrived
  bot.on("shutdown", () => { … });                        // save state
}
```
Options (`o.*`) are **required by default** — pass `{ required: false }` for optional ones (they're auto-sorted after required ones). Types: `o.str o.int o.num o.bool o.user o.role o.channel({types}) o.mentionable o.attachment o.choice(name, desc, [["label","value"]]) o.sub o.group`.

### Ctx (interaction)
- reading: `ctx.sub`, `ctx.group`, `ctx.str(n)`, `ctx.int(n)`, `ctx.bool(n)`, `ctx.id(n)` (user/role/channel id), `ctx.memberOpt(n)` (CMember with roles), `ctx.userOpt(n)`, `ctx.roleOpt(n)`, `ctx.channelOpt(n)`, `ctx.attachment(n)`, `ctx.values` (select values), `ctx.selectedMembers()`, `ctx.customId`, `ctx.fields` (modal Map), `ctx.message` (raw message of the component), `ctx.focused()`.
- who: `ctx.user` (CUser), `ctx.member` (CMember: `.roles: string[]`), `ctx.guildId`, `ctx.channelId`, `ctx.perms` (bigint, channel perms of the user), `ctx.isAdmin`, `ctx.can(P.ManageGuild)`, `ctx.hasRole(id)`.
- replying: `ctx.reply(textOrPayload, ephemeral?)`, `ctx.hidden(x)`, `ctx.fail("msg")` (ephemeral ❌, works before/after ack), `ctx.defer(ephemeral?)` then `ctx.edit(x)` / `ctx.followup(x, eph)`, `ctx.update(x)` (edit the component's message), `ctx.deferUpdate()`, `ctx.showModal(modal(...))`, `ctx.autocomplete([...])`, `ctx.deleteOriginal()`. A reply after ack automatically becomes a followup. Payload = `{ content, embeds, components, flags, allowed_mentions, files: [{name, data, contentType}] }`. Default allowed_mentions is none — pass `allowed_mentions: { users: [id] }` / `{ parse: ["users","roles"] }` when a ping is intended.
- Interactions must be answered within 3 s: `await ctx.defer()` before slow work (REST loops, many role edits).

### Bot helpers
`bot.send(channelId, payload)`, `bot.trySend(channelId, payload)` (null on failure), `bot.dm(userId, payload)` (null if DMs closed), `bot.edit(ch, msg, payload)`, `bot.deleteMessage(ch, msg)`, `bot.react(ch, msg, emoji)`, `bot.member(gid, uid, fresh?)` → CMember|null (cache then REST), `bot.userById(id)`, `bot.allMembers(gid)` (async iterator over REST pages — don't store them all), `bot.membersWithRole(gid, rid, limit)`, `bot.addRole/removeRole(gid, uid, rid, reason)`, `bot.setNick`, `bot.timeout(gid, uid, seconds|null, reason)`, `bot.kick`, `bot.ban(gid, uid, reason, deleteSeconds)`, `bot.unban`, `bot.editMember(gid, uid, body, reason)`, `bot.guild(gid)` (CGuild: name, icon, ownerId, memberCount, roles Map, channels Map, voice Map userId→channelId), `bot.role(gid, rid)`, `bot.channel(id)`, `bot.guildOfChannel(id)`, `bot.basePerms(gid, roles, uid)`, `bot.channelPerms(gid, ch, roles, uid)`, `bot.topPosition(gid, roles)`, `bot.topRole(gid, roles)`, `bot.me(gid)`, `bot.canManageRole(gid, rid)`, `bot.canModerate(gid, member)`, `bot.avatar(userOrMember, size)`, `bot.guildIcon(guild)`, `bot.name(member)`, `bot.rest.get/post/patch/put/delete(path, { body, query, reason, files })` for anything else (e.g. create channel: `bot.rest.post(\`/guilds/${gid}/channels\`, { body: {...} })`), `bot.cache`, `bot.user` (bot's user), `bot.appId`, `bot.ready`.

### Events (`bot.on(name, (d, extra) => …)`)
Raw Gateway payload `d` + `extra` with cached "before" state:
- `GUILD_CREATE` {guild} · `GUILD_JOIN` (bot added to a new server) · `GUILD_UPDATE` {before, guild} · `GUILD_DELETE` {guild}
- `CHANNEL_CREATE/UPDATE/DELETE` {before, guild} · `GUILD_ROLE_CREATE/UPDATE/DELETE` {before, guild}
- `GUILD_MEMBER_ADD` {member, guild} · `GUILD_MEMBER_UPDATE` {before, member} · `GUILD_MEMBER_REMOVE` {before, guild}
- `VOICE_STATE_UPDATE` {before: channelId|null, after: channelId|null, beforeFlags, member, guild}
- `MESSAGE_CREATE` {message} · `MESSAGE_UPDATE` {before: CMessage?} · `MESSAGE_DELETE` {before} · `MESSAGE_DELETE_BULK` {before[]}
- anything else raw: `GUILD_BAN_ADD`, `GUILD_BAN_REMOVE`, `GUILD_AUDIT_LOG_ENTRY_CREATE`, `INVITE_CREATE`, `INVITE_DELETE`, `MESSAGE_REACTION_ADD/REMOVE`, `WEBHOOKS_UPDATE`, `GUILD_EMOJIS_UPDATE`, …
Intents enabled: guilds, members, moderation (bans + audit log events), invites, voice states, guild messages, reactions, DMs, message content.

### Python → TS equivalents
| discord.py | here |
|---|---|
| `discord.ui.View(timeout=None)` persistent + `bot.add_view` | just register `bot.component(prefix, …)` once — any message with that custom_id works forever |
| non-persistent View with state in the object | encode the needed ids in `custom_id` (max 100 chars) or keep a small `Map` with TTL/cleanup |
| `interaction.response.send_message(..., ephemeral=True)` | `ctx.reply(x, true)` |
| `interaction.response.edit_message` | `ctx.update(x)` |
| `interaction.followup.send` | `ctx.followup(x, eph)` or `ctx.reply` after ack |
| `channel.send` | `bot.send(channelId, x)` |
| `member.add_roles` | `bot.addRole(gid, uid, rid, reason)` |
| `guild.get_member(id)` | `await bot.member(gid, id)` |
| `role.members` | `await bot.membersWithRole(gid, rid)` (REST, use sparingly; defer first) |
| `tasks.loop(minutes=5)` | `setInterval(…, 300_000).unref()` started in setup, skip work until `bot.ready` |
| `discord.File(io.BytesIO(...))` | `files: [{ name: "x.html", data: "<html>…", contentType: "text/html" }]` |
| `discord.Color.green()` | `COLORS.green` / numbers like `0x2ecc71` |
| `datetime.now().strftime(...)` | `new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })` or `ts(now(), "f")` |
| `app_commands.checks.has_permissions(administrator=True)` | `perms: P.Administrator` on the command **and** check `ctx.isAdmin` in run |

Python Arabic strings from `core/strings.py` bilingual tables (`tr(x, "key")`) → just use the Arabic text inline.

### Dashboard jobs
The web dashboard is a separate process (TSX). When it needs the bot to *do* something (send a ticket/apply panel, etc.) it enqueues a job in `data/dashboard_jobs.db`. In your feature register a handler:
```ts
import { onJob } from "../core/jobs.ts";
onJob("ticket-panel", async (guildId, payload) => { await sendPanel(...); return "تم إرسال البانل"; }); // throw new Error("رسالة عربية") on failure
```
Plain settings the dashboard edits directly in the SQLite/JSON files — your feature must therefore read settings from the DB/JSON on use (or with a short TTL cache), not only once at startup.
