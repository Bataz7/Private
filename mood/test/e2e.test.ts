/** تشغيل البوت الحقيقي (عملية منفصلة) ضد سيرفر ديسكورد وهمي. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { MockDiscord } from "./mock-discord.ts";

const TARGET = "111111111111111111";

describe("end-to-end: real bot process against a mock Discord", () => {
  const mock = new MockDiscord();
  let proc: ReturnType<typeof spawn>;
  let output = "";

  before(async () => {
    await mock.start();
    proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/index.ts"], {
      env: {
        ...process.env,
        DISCORD_TOKEN: "e2e-token",
        TARGET_USER_ID: TARGET,
        OWNER_ID: "222222222222222222",
        DATA_DIR: mkdtempSync(join(tmpdir(), "mood-e2e-")),
        ANTHROPIC_API_KEY: "",
        DISCORD_API_URL: mock.apiUrl,
        DISCORD_GATEWAY_URL: mock.gatewayUrl,
        LOG_LEVEL: "debug",
        CHECKIN_TIME: "00:00", // يرسل السؤال فوراً
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout!.on("data", (d) => { output += d; });
    proc.stderr!.on("data", (d) => { output += d; });
  });

  after(async () => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
    await mock.stop();
  });

  test("boots: registers commands, uploads emojis, identifies, goes ready, sends the check-in", async () => {
    await mock.waitFor(() => output.includes("شغّال"));
    assert.ok(mock.requests.some((r) => r.method === "PUT" && r.path.endsWith("/commands") && r.body.length >= 10), "slash commands registered");
    assert.equal(mock.requests.filter((r) => r.method === "POST" && r.path.endsWith("/emojis")).length, 11, "11 custom emojis uploaded");
    const identify = mock.gatewayIn.find((p) => p.op === 2);
    assert.equal(identify.d.token, "e2e-token");
    assert.equal(identify.d.intents, 1 << 12);
    assert.equal(identify.d.presence.activities[0].state, "كيف كان يومك؟ 🌈");

    const checkin = await mock.waitFor(() => mock.requests.find((r) => r.method === "POST" && r.path === "/channels/511111111111111111/messages"));
    assert.match(checkin.body.embeds[0].description, /كيف كان يومك/);
    const btn = checkin.body.components[0].components[0];
    assert.ok(btn.emoji.id, "buttons use the uploaded custom emoji");
  });

  test("handles a slash command and a button over the gateway", async () => {
    mock.dispatch("INTERACTION_CREATE", { id: "400000000000000001", application_id: "999999999999999999", token: "itok", type: 2, data: { name: "help" }, user: { id: TARGET } });
    const help = await mock.waitFor(() => mock.requests.find((r) => r.path === "/interactions/400000000000000001/itok/callback"));
    assert.equal(help.body.type, 4);
    assert.match(help.body.data.embeds[0].description, /Mood Bot/);

    mock.dispatch("INTERACTION_CREATE", { id: "400000000000000002", application_id: "999999999999999999", token: "itok2", type: 3, data: { custom_id: "ci:2099-01-01:5", component_type: 2 }, user: { id: TARGET } });
    const modal = await mock.waitFor(() => mock.requests.find((r) => r.path === "/interactions/400000000000000002/itok2/callback"));
    assert.equal(modal.body.type, 9);

    mock.dispatch("INTERACTION_CREATE", { id: "400000000000000003", application_id: "999999999999999999", token: "itok3", type: 2, data: { name: "report" }, user: { id: "333333333333333333" } });
    const denied = await mock.waitFor(() => mock.requests.find((r) => r.path === "/interactions/400000000000000003/itok3/callback"));
    assert.match(denied.body.data.content, /خاص/);
  });

  test("shuts down gracefully on SIGTERM", async () => {
    proc.kill("SIGTERM");
    const code = await new Promise<number | null>((r) => proc.on("exit", (c) => r(c)));
    assert.equal(code, 0);
    assert.match(output, /إيقاف البوت/);
    assert.doesNotMatch(output, /ERROR/);
  });
});
