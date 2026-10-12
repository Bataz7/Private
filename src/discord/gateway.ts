/**
 * اتصال Gateway بـ WebSocket المدمج في Bun.
 * heartbeat مع كشف الاتصال الميت، resume تلقائي، إعادة اتصال بـ backoff، وإيقاف نهائي مع الأخطاء القاتلة.
 */
import { FATAL_CLOSE_CODES, GATEWAY_URL, GatewayOp, RESET_SESSION_CODES } from "./constants.ts";
import { log } from "../core/log.ts";

export interface GatewayPayload {
  op: number;
  d?: any;
  s?: number | null;
  t?: string | null;
}

export interface GatewayOptions {
  token: string;
  intents: number;
  presence?: unknown;
  onDispatch: (t: string, d: any) => void;
  onFatal: (code: number, reason: string) => void;
}

const OPEN = 1;

export class Gateway {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval = 0;
  private lastAck = true;
  private lastBeatAt = 0;
  private attempts = 0;
  private destroyed = false;
  sessionId: string | null = null;
  resumeUrl: string | null = null;
  seq: number | null = null;
  ping = -1;

  constructor(private readonly o: GatewayOptions) {}

  connect(): void {
    if (this.destroyed) return;
    const resuming = Boolean(this.sessionId && this.resumeUrl);
    const url = resuming ? `${this.resumeUrl}/?v=10&encoding=json` : GATEWAY_URL;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(ws, ev.data);
    ws.onclose = (ev) => this.onClose(ws, ev.code, ev.reason);
    ws.onerror = () => log.debug("gateway", "socket error");
  }

  destroy(): void {
    this.destroyed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= OPEN) ws.close(1000, "shutdown");
  }

  send(payload: GatewayPayload): void {
    if (this.ws?.readyState === OPEN) this.ws.send(JSON.stringify(payload));
  }

  private onMessage(ws: WebSocket, raw: unknown): void {
    if (ws !== this.ws) return;
    let p: GatewayPayload;
    try {
      p = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw as ArrayBuffer));
    } catch {
      return;
    }
    if (typeof p.s === "number") this.seq = p.s;
    switch (p.op) {
      case GatewayOp.Hello:
        this.heartbeatInterval = p.d.heartbeat_interval;
        this.startHeartbeat();
        if (this.sessionId && this.seq !== null) this.send({ op: GatewayOp.Resume, d: { token: this.o.token, session_id: this.sessionId, seq: this.seq } });
        else this.identify();
        break;
      case GatewayOp.HeartbeatAck:
        this.lastAck = true;
        this.ping = Date.now() - this.lastBeatAt;
        break;
      case GatewayOp.Heartbeat:
        this.beat(true);
        break;
      case GatewayOp.Reconnect:
        this.reconnect(true);
        break;
      case GatewayOp.InvalidSession:
        if (!p.d) this.resetSession();
        this.reconnect(Boolean(p.d), 1000 + Math.floor(Math.random() * 4000));
        break;
      case GatewayOp.Dispatch:
        if (p.t === "READY") {
          this.sessionId = p.d.session_id;
          this.resumeUrl = p.d.resume_gateway_url;
          this.attempts = 0;
        } else if (p.t === "RESUMED") {
          this.attempts = 0;
          log.info("gateway", "resumed");
        }
        try {
          this.o.onDispatch(p.t ?? "", p.d);
        } catch (e) {
          log.error("dispatch", `${p.t}: ${(e as Error).stack ?? e}`);
        }
        break;
    }
  }

  private identify(): void {
    this.send({
      op: GatewayOp.Identify,
      d: {
        token: this.o.token,
        intents: this.o.intents,
        large_threshold: 50, // أقل بيانات أعضاء مع GUILD_CREATE = ذاكرة أقل
        properties: { os: process.platform, browser: "revive", device: "revive" },
        ...(this.o.presence ? { presence: this.o.presence } : {}),
      },
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastAck = true;
    const loop = () => {
      if (!this.lastAck) {
        log.warn("gateway", "heartbeat not acknowledged — reconnecting");
        this.reconnect(true);
        return;
      }
      this.beat(false);
      this.heartbeatTimer = setTimeout(loop, this.heartbeatInterval);
    };
    this.heartbeatTimer = setTimeout(loop, Math.floor(this.heartbeatInterval * Math.random()));
  }

  private beat(requested: boolean): void {
    if (!requested) this.lastAck = false;
    this.lastBeatAt = Date.now();
    this.send({ op: GatewayOp.Heartbeat, d: this.seq });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private resetSession(): void {
    this.sessionId = null;
    this.resumeUrl = null;
    this.seq = null;
  }

  private reconnect(resume: boolean, delay = 0): void {
    if (!resume) this.resetSession();
    const ws = this.ws;
    this.ws = null;
    this.stopHeartbeat();
    if (ws && ws.readyState <= OPEN) ws.close(4000, "reconnect");
    this.scheduleConnect(delay);
  }

  private onClose(ws: WebSocket, code: number, reason?: string): void {
    if (ws !== this.ws) return;
    this.ws = null;
    this.stopHeartbeat();
    if (this.destroyed) return;
    if (FATAL_CLOSE_CODES.has(code)) {
      this.destroyed = true;
      this.o.onFatal(code, reason ?? "");
      return;
    }
    if (RESET_SESSION_CODES.has(code)) this.resetSession();
    const delay = Math.min(1000 * 2 ** this.attempts, 30_000) + Math.floor(Math.random() * 1000);
    this.attempts++;
    log.warn("gateway", `closed (${code}${reason ? ` ${reason}` : ""}), reconnecting in ${delay}ms`);
    this.scheduleConnect(delay);
  }

  private scheduleConnect(delay: number): void {
    if (this.destroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
