import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { GatewayOp } from "../src/discord/constants.ts";
import { Gateway, type SocketLike } from "../src/discord/gateway.ts";
import { DiscordAPIError, REST, routeKey } from "../src/discord/rest.ts";

const json = (d: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", ...headers } });

describe("REST", () => {
  test("route keys keep major params and generalize the rest", () => {
    assert.equal(routeKey("POST", "/channels/123456789012345678/messages"), "POST /channels/123456789012345678/messages");
    assert.equal(routeKey("PATCH", "/channels/123456789012345678/messages/223456789012345678"), "PATCH /channels/123456789012345678/messages/:id");
    assert.equal(routeKey("POST", "/interactions/123456789012345678/aW50ZXJhY3Rpb24/callback"), "POST /interactions/:id/:token/callback");
    assert.equal(routeKey("POST", "/webhooks/1/abc.def/messages/@original"), "POST /webhooks/1/abc.def/messages/@original", "each interaction token has its own queue");
    assert.equal(routeKey("GET", "/users/123456789012345678"), "GET /users/:id");
  });

  test("retries after 429 using retry_after and sets global lock", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const rest = new REST("t", {
      sleep: async (ms) => { sleeps.push(ms); },
      fetch: async () => (++n === 1 ? json({ retry_after: 1.5, global: true, message: "rl" }, 429) : json({ ok: true })),
    });
    assert.deepEqual(await rest.get("/users/@me"), { ok: true });
    assert.equal(n, 2);
    assert.ok(sleeps[0]! >= 1500);
  });

  test("retries 5xx and network errors, then gives up", async () => {
    let n = 0;
    const rest = new REST("t", { sleep: async () => {}, maxRetries: 2, fetch: async () => { n++; throw new Error("ECONNRESET"); } });
    await assert.rejects(rest.get("/x"), /ECONNRESET/);
    assert.equal(n, 3);
    let m = 0;
    const rest2 = new REST("t", { sleep: async () => {}, fetch: async () => (++m < 3 ? new Response("oops", { status: 502 }) : json({ fine: 1 })) });
    assert.deepEqual(await rest2.get("/x"), { fine: 1 });
  });

  test("throws DiscordAPIError with code on 4xx", async () => {
    const rest = new REST("t", { fetch: async () => json({ message: "Cannot send messages to this user", code: 50007 }, 403) });
    const err = await rest.post("/channels/1/messages", { body: {} }).catch((e) => e);
    assert.ok(err instanceof DiscordAPIError);
    assert.equal(err.code, 50007);
    assert.equal(err.status, 403);
  });

  test("waits when a bucket is exhausted", async () => {
    const sleeps: number[] = [];
    const rest = new REST("t", {
      sleep: async (ms) => { sleeps.push(ms); },
      fetch: async () => json({}, 200, { "x-ratelimit-bucket": "b1", "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "2" }),
    });
    await rest.get("/channels/1/messages");
    await rest.get("/channels/1/messages");
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0]! > 1500);
  });

  test("sends auth header except for interaction webhooks; multipart for files", async () => {
    const seen: { auth?: string; form: boolean }[] = [];
    const rest = new REST("tok", {
      fetch: async (_u, init) => {
        const h = init.headers as Record<string, string>;
        seen.push({ auth: h.authorization, form: init.body instanceof FormData });
        if (init.body instanceof FormData) {
          const p = JSON.parse(String(init.body.get("payload_json")));
          assert.deepEqual(p.attachments, [{ id: 0, filename: "r.html" }]);
          assert.equal(await (init.body.get("files[0]") as File).text(), "<html>");
        }
        return new Response(null, { status: 204 });
      },
    });
    await rest.post("/channels/1/messages", { body: { content: "x" }, files: [{ name: "r.html", data: "<html>" }] });
    await rest.post("/interactions/1/abc/callback", { body: {}, auth: false });
    assert.deepEqual(seen, [{ auth: "Bot tok", form: true }, { auth: undefined, form: false }]);
  });

  test("interaction callbacks bypass the queue and don't wait on retries", async () => {
    let n = 0;
    const order: string[] = [];
    const rest = new REST("t", {
      sleep: async () => {},
      fetch: async (url) => {
        const p = new URL(url).pathname;
        order.push(p);
        if (p.includes("/channels/")) { await new Promise((r) => setTimeout(r, 30)); return json({}); }
        n++;
        return new Response("down", { status: 503 });
      },
    });
    const slow = rest.post("/channels/1/messages", { body: {} });
    await assert.rejects(rest.post("/interactions/1/tok/callback", { body: {}, auth: false, direct: true, retries: 1 }));
    assert.equal(n, 2, "one retry only");
    await slow;
  });

  test("requests on the same route run in order", async () => {
    const order: number[] = [];
    const rest = new REST("t", {
      fetch: async (url) => {
        const k = Number(new URL(url).searchParams.get("k"));
        await new Promise((r) => setTimeout(r, k === 1 ? 20 : 0));
        order.push(k);
        return json({});
      },
    });
    await Promise.all([rest.get("/channels/1/messages", { query: { k: 1 } }), rest.get("/channels/1/messages", { query: { k: 2 } })]);
    assert.deepEqual(order, [1, 2]);
  });
});

class FakeSocket implements SocketLike {
  readyState = 1;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  sent: any[] = [];
  closed: number | null = null;
  readonly url: string;
  constructor(url: string) { this.url = url; }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close(code = 1000) { this.closed = code; this.readyState = 3; }
  recv(p: object) { this.onmessage?.({ data: JSON.stringify(p) }); }
  drop(code: number) { this.readyState = 3; this.onclose?.({ code }); }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const gw = new Gateway({ token: "tok", intents: 4096, socketFactory: (u) => { const s = new FakeSocket(u); sockets.push(s); return s; }, random: () => 0 });
  return { gw, sockets };
}

describe("Gateway", () => {
  test("hello → identify, heartbeat with ack, dispatch events", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const { gw, sockets } = setup();
    const events: string[] = [];
    gw.on("dispatch", (name: string) => events.push(name));
    gw.connect();
    const s = sockets[0]!;
    s.recv({ op: GatewayOp.Hello, d: { heartbeat_interval: 1000 } });
    assert.equal(s.sent[0].op, GatewayOp.Identify);
    assert.equal(s.sent[0].d.intents, 4096);
    t.mock.timers.tick(1);
    assert.equal(s.sent.at(-1).op, GatewayOp.Heartbeat);
    s.recv({ op: GatewayOp.HeartbeatAck });
    s.recv({ op: GatewayOp.Dispatch, t: "READY", s: 1, d: { session_id: "sess", resume_gateway_url: "wss://resume.example" } });
    s.recv({ op: GatewayOp.Dispatch, t: "INTERACTION_CREATE", s: 2, d: {} });
    assert.deepEqual(events, ["READY", "INTERACTION_CREATE"]);
    assert.equal(gw.seq, 2);
    t.mock.timers.tick(1000);
    assert.equal(s.sent.filter((p) => p.op === GatewayOp.Heartbeat).length, 2);
    gw.destroy();
  });

  test("zombie connection (no ack) → reconnect and resume on resume url", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const { gw, sockets } = setup();
    gw.connect();
    const s = sockets[0]!;
    s.recv({ op: GatewayOp.Hello, d: { heartbeat_interval: 1000 } });
    s.recv({ op: GatewayOp.Dispatch, t: "READY", s: 5, d: { session_id: "sess", resume_gateway_url: "wss://resume.example" } });
    t.mock.timers.tick(1); // beat (no ack)
    t.mock.timers.tick(1000); // next beat → zombie
    assert.equal(s.closed, 4000);
    t.mock.timers.tick(10);
    const s2 = sockets[1]!;
    assert.match(s2.url, /^wss:\/\/resume\.example/);
    s2.recv({ op: GatewayOp.Hello, d: { heartbeat_interval: 1000 } });
    assert.deepEqual(s2.sent[0], { op: GatewayOp.Resume, d: { token: "tok", session_id: "sess", seq: 5 } });
    gw.destroy();
  });

  test("op 7 reconnect resumes; non-resumable invalid session identifies fresh", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const { gw, sockets } = setup();
    gw.connect();
    sockets[0]!.recv({ op: GatewayOp.Hello, d: { heartbeat_interval: 45000 } });
    sockets[0]!.recv({ op: GatewayOp.Dispatch, t: "READY", s: 1, d: { session_id: "s", resume_gateway_url: "wss://r" } });
    sockets[0]!.recv({ op: GatewayOp.Reconnect });
    t.mock.timers.tick(1);
    sockets[1]!.recv({ op: GatewayOp.Hello, d: { heartbeat_interval: 45000 } });
    assert.equal(sockets[1]!.sent[0].op, GatewayOp.Resume);
    sockets[1]!.recv({ op: GatewayOp.InvalidSession, d: false });
    t.mock.timers.tick(5000);
    sockets[2]!.recv({ op: GatewayOp.Hello, d: { heartbeat_interval: 45000 } });
    assert.equal(sockets[2]!.sent[0].op, GatewayOp.Identify);
    assert.equal(gw.sessionId, null);
    gw.destroy();
  });

  test("unexpected close reconnects with backoff; fatal close stops", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const { gw, sockets } = setup();
    let fatal = 0;
    gw.on("fatal", (code: number) => { fatal = code; });
    gw.connect();
    sockets[0]!.drop(1006);
    t.mock.timers.tick(1000);
    assert.equal(sockets.length, 2, "reconnected");
    sockets[1]!.drop(4004);
    t.mock.timers.tick(60_000);
    assert.equal(fatal, 4004);
    assert.equal(sockets.length, 2, "no reconnect after fatal");
  });
});

void mock;
