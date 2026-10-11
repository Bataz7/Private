/**
 * سيرفر ديسكورد وهمي كامل (HTTP API + WebSocket Gateway) بدون مكتبات —
 * عشان نشغّل البوت الحقيقي (src/index.ts) من أوله لآخره في الاختبارات.
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";

export interface Recorded {
  method: string;
  path: string;
  body: any;
}

export class MockDiscord {
  readonly requests: Recorded[] = [];
  readonly gatewayIn: any[] = [];
  private server: Server;
  private sockets = new Set<Duplex>();
  private seq = 0;
  port = 0;

  constructor() {
    this.server = createServer((req, res) => void this.onHttp(req, res));
    this.server.on("upgrade", (req, socket) => this.onUpgrade(req, socket));
  }

  async start(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.port = (this.server.address() as { port: number }).port;
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  get apiUrl() { return `http://127.0.0.1:${this.port}/api/v10`; }
  get gatewayUrl() { return `ws://127.0.0.1:${this.port}/gateway`; }

  // ─────────── HTTP ───────────

  private async onHttp(req: IncomingMessage, res: import("node:http").ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: any = undefined;
    if (raw && (req.headers["content-type"] ?? "").includes("json")) body = JSON.parse(raw);
    else if (raw) body = { multipart: true, raw: raw.slice(0, 2000) };
    const path = (req.url ?? "").replace(/^\/api\/v10/, "").split("?")[0]!;
    this.requests.push({ method: req.method!, path, body });

    const send = (status: number, data?: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "x-ratelimit-bucket": "b", "x-ratelimit-remaining": "5", "x-ratelimit-reset-after": "0.1" });
      res.end(data === undefined ? "" : JSON.stringify(data));
    };
    if (req.headers.authorization !== "Bot e2e-token" && !path.startsWith("/interactions/") && !path.startsWith("/webhooks/")) return send(401, { message: "401: Unauthorized", code: 0 });
    if (path === "/applications/@me") return send(200, { id: "999999999999999999" });
    if (path.endsWith("/commands") && req.method === "PUT") return send(200, body);
    if (path.endsWith("/emojis") && req.method === "GET") return send(200, { items: [] });
    if (path.endsWith("/emojis") && req.method === "POST") return send(201, { id: String(800000000000000000 + this.requests.length), name: body.name });
    if (path === "/users/@me/channels") return send(200, { id: "511111111111111111", type: 1 });
    if (/^\/users\/\d+$/.test(path)) return send(200, { id: path.split("/")[2], username: "sara", global_name: "سارة" });
    if (/\/messages$/.test(path) && req.method === "POST") return send(200, { id: String(700000000000000000 + this.requests.length), channel_id: path.split("/")[2] });
    if (path.startsWith("/webhooks/") && req.method === "POST") return send(200, { id: "1", channel_id: "1" });
    return send(204);
  }

  // ─────────── WebSocket ───────────

  private onUpgrade(req: IncomingMessage, socket: Duplex): void {
    const key = req.headers["sec-websocket-key"];
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    let buf = Buffer.alloc(0);
    socket.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const f = decodeFrame(buf);
        if (!f) break;
        buf = buf.subarray(f.length);
        if (f.opcode === 8) { socket.end(); return; }
        if (f.opcode === 1) this.onGatewayMessage(socket, JSON.parse(f.payload.toString("utf8")));
      }
    });
    this.sendTo(socket, { op: 10, d: { heartbeat_interval: 41250 } });
  }

  private onGatewayMessage(socket: Duplex, p: any): void {
    this.gatewayIn.push(p);
    if (p.op === 1) this.sendTo(socket, { op: 11 });
    if (p.op === 2) {
      this.dispatch("READY", {
        v: 10, session_id: "e2e-session", resume_gateway_url: this.gatewayUrl,
        user: { id: "999999999999999999", username: "MoodBot", bot: true }, application: { id: "999999999999999999" },
      });
    }
  }

  private sendTo(socket: Duplex, p: object): void {
    socket.write(encodeFrame(Buffer.from(JSON.stringify(p))));
  }

  dispatch(t: string, d: unknown): void {
    for (const s of this.sockets) this.sendTo(s, { op: 0, t, s: ++this.seq, d });
  }

  async waitFor<T>(fn: () => T | undefined | false, timeoutMs = 10_000): Promise<T> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("timeout waiting for condition");
  }
}

function encodeFrame(payload: Buffer): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x81, len]) : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255]) : (() => {
    const h = Buffer.alloc(10);
    h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2);
    return h;
  })();
  return Buffer.concat([head, payload]);
}

function decodeFrame(buf: Buffer): { opcode: number; payload: Buffer; length: number } | null {
  if (buf.length < 2) return null;
  const opcode = buf[0]! & 0x0f;
  const masked = (buf[1]! & 0x80) !== 0;
  let len = buf[1]! & 0x7f;
  let off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  const maskOff = off;
  if (masked) off += 4;
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.subarray(off, off + len));
  if (masked) for (let i = 0; i < payload.length; i++) payload[i]! ^= buf[maskOff + (i % 4)]!;
  return { opcode, payload, length: off + len };
}
