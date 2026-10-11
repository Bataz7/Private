/**
 * اتصال Gateway لـ Discord بـ WebSocket المدمج في Node.
 * - heartbeat مع كشف الاتصال الميت (zombie)
 * - resume تلقائي بعد الانقطاع بدون ما تضيع الأحداث
 * - إعادة اتصال بـ backoff تصاعدي
 * - إيقاف نهائي مع الأخطاء القاتلة (توكن غلط مثلاً)
 */
import { EventEmitter } from "node:events";
import { FATAL_CLOSE_CODES, GATEWAY_URL, GatewayOp, RESET_SESSION_CODES } from "./constants.ts";
import { silentLogger, type Logger } from "../log.ts";

/** أقل شي نحتاجه من WebSocket (عشان نقدر نحط نسخة وهمية في الاختبارات). */
export interface SocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
export type SocketFactory = (url: string) => SocketLike;

export interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

export interface GatewayOptions {
  token: string;
  intents: number;
  presence?: unknown;
  url?: string;
  socketFactory?: SocketFactory;
  logger?: Logger;
  /** للاختبارات: نتحكم بالعشوائية. */
  random?: () => number;
}

const OPEN = 1;

export class Gateway extends EventEmitter {
  private readonly token: string;
  private readonly intents: number;
  private readonly presence: unknown;
  private readonly baseUrl: string;
  private readonly factory: SocketFactory;
  private readonly log: Logger;
  private readonly random: () => number;

  private ws: SocketLike | null = null;
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

  constructor(opts: GatewayOptions) {
    super();
    this.token = opts.token;
    this.intents = opts.intents;
    this.presence = opts.presence;
    this.baseUrl = opts.url ?? GATEWAY_URL;
    this.factory = opts.socketFactory ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.log = opts.logger ?? silentLogger;
    this.random = opts.random ?? Math.random;
  }

  connect(): void {
    if (this.destroyed) return;
    const resuming = Boolean(this.sessionId && this.resumeUrl);
    const url = resuming ? withQuery(this.resumeUrl!) : this.baseUrl;
    this.log.debug(`connecting to ${url} (resume=${resuming})`);
    const ws = this.factory(url);
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(ws, ev.data);
    ws.onclose = (ev) => this.onClose(ws, ev.code, ev.reason);
    ws.onerror = (ev) => this.log.debug("socket error", (ev as { message?: string })?.message ?? "");
  }

  /** إيقاف نهائي (عند إطفاء البوت). */
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

  updatePresence(presence: unknown): void {
    this.send({ op: GatewayOp.PresenceUpdate, d: presence });
  }

  private onMessage(ws: SocketLike, raw: unknown): void {
    if (ws !== this.ws) return;
    let p: GatewayPayload;
    try {
      p = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw as ArrayBuffer).toString("utf8"));
    } catch {
      this.log.warn("bad gateway payload");
      return;
    }
    if (typeof p.s === "number") this.seq = p.s;

    switch (p.op) {
      case GatewayOp.Hello: {
        this.heartbeatInterval = (p.d as { heartbeat_interval: number }).heartbeat_interval;
        this.startHeartbeat();
        if (this.sessionId && this.seq !== null) this.resume();
        else this.identify();
        break;
      }
      case GatewayOp.HeartbeatAck:
        this.lastAck = true;
        this.ping = Date.now() - this.lastBeatAt;
        break;
      case GatewayOp.Heartbeat:
        this.beat(true);
        break;
      case GatewayOp.Reconnect:
        this.log.info("gateway asked to reconnect");
        this.reconnect(true);
        break;
      case GatewayOp.InvalidSession: {
        const resumable = Boolean(p.d);
        this.log.warn(`invalid session (resumable=${resumable})`);
        if (!resumable) this.resetSession();
        // ديسكورد يطلب انتظار 1-5 ثواني قبل identify جديد
        this.reconnect(resumable, 1000 + Math.floor(this.random() * 4000));
        break;
      }
      case GatewayOp.Dispatch:
        this.onDispatch(p.t ?? "", p.d);
        break;
    }
  }

  private onDispatch(t: string, d: unknown): void {
    if (t === "READY") {
      const r = d as { session_id: string; resume_gateway_url: string };
      this.sessionId = r.session_id;
      this.resumeUrl = r.resume_gateway_url;
      this.attempts = 0;
      this.log.info("gateway ready");
    } else if (t === "RESUMED") {
      this.attempts = 0;
      this.log.info("gateway resumed");
    }
    this.emit("dispatch", t, d);
    this.emit(t, d);
  }

  private identify(): void {
    this.send({
      op: GatewayOp.Identify,
      d: {
        token: this.token,
        intents: this.intents,
        properties: { os: process.platform, browser: "mood-bot", device: "mood-bot" },
        ...(this.presence ? { presence: this.presence } : {}),
      },
    });
  }

  private resume(): void {
    this.log.debug(`resuming session ${this.sessionId} at seq ${this.seq}`);
    this.send({ op: GatewayOp.Resume, d: { token: this.token, session_id: this.sessionId, seq: this.seq } });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastAck = true;
    // أول نبضة بعد وقت عشوائي (حسب توصية ديسكورد) ثم كل interval
    const first = Math.floor(this.heartbeatInterval * this.random());
    const loop = () => {
      if (!this.lastAck) {
        this.log.warn("heartbeat not acknowledged — zombie connection, reconnecting");
        this.reconnect(true);
        return;
      }
      this.beat(false);
      this.heartbeatTimer = setTimeout(loop, this.heartbeatInterval);
    };
    this.heartbeatTimer = setTimeout(loop, first);
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

  /** نقفل الاتصال الحالي ونفتح جديد. الكود 4000 يحافظ على الجلسة للـ resume. */
  private reconnect(resume: boolean, delay = 0): void {
    if (!resume) this.resetSession();
    const ws = this.ws;
    this.ws = null;
    this.stopHeartbeat();
    if (ws && ws.readyState <= OPEN) ws.close(4000, "reconnect");
    this.scheduleConnect(delay);
  }

  private onClose(ws: SocketLike, code: number, reason?: string): void {
    if (ws !== this.ws) return; // اتصال قديم قفلناه بأنفسنا
    this.ws = null;
    this.stopHeartbeat();
    if (this.destroyed) return;

    if (FATAL_CLOSE_CODES.has(code)) {
      this.log.error(`fatal gateway close ${code}: ${reason ?? ""}`);
      this.destroyed = true;
      this.emit("fatal", code, reason);
      return;
    }
    if (RESET_SESSION_CODES.has(code)) this.resetSession();

    const delay = Math.min(1000 * 2 ** this.attempts, 30_000) + Math.floor(this.random() * 1000);
    this.attempts++;
    this.log.warn(`gateway closed (${code}${reason ? ` ${reason}` : ""}), reconnecting in ${delay}ms`);
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

function withQuery(url: string): string {
  return url.includes("?") ? url : `${url}/?v=10&encoding=json`;
}
