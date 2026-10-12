/** كل أنظمة البوت — كل ملف يصدّر setup(bot) يسجّل أوامره وأحداثه. */
import type { Bot } from "../discord/client.ts";
import police from "./police.ts";
import logs from "./logs.ts";
import welcome from "./welcome.ts";
import tickets from "./tickets.ts";
import owner from "./owner.ts";
import activation from "./activation.ts";
import applications from "./applications.ts";
import identity from "./identity.ts";
import roleplay from "./roleplay.ts";
import autoRole from "./auto_role.ts";
import replies from "./replies.ts";
import shorts from "./shorts.ts";
import shortcuts from "./shortcuts.ts";
import embed from "./embed.ts";
import security from "./security.ts";
import badwords from "./badwords.ts";
import azkar from "./azkar.ts";
import levels from "./levels.ts";
import bank from "./bank.ts";
import traffic from "./traffic.ts";
import vehicle from "./vehicle.ts";
import realEstate from "./real_estate.ts";

export const FEATURES: [string, (bot: Bot) => void][] = [
  ["police", police], ["logs", logs], ["welcome", welcome], ["tickets", tickets], ["owner", owner],
  ["activation", activation], ["applications", applications], ["identity", identity], ["roleplay", roleplay],
  ["auto_role", autoRole], ["replies", replies], ["shorts", shorts], ["shortcuts", shortcuts], ["embed", embed],
  ["security", security], ["badwords", badwords], ["azkar", azkar], ["levels", levels], ["bank", bank],
  ["traffic", traffic], ["vehicle", vehicle], ["real_estate", realEstate],
];
