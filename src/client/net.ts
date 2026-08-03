/**
 * The socket to the room.
 *
 * Reconnects on its own and re-takes the seat, because a phone that locks its
 * screen mid-game drops the connection and nobody should lose their pawn over
 * it. Anything sent while the line is down is queued, not dropped.
 */

import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";

export interface Credentials {
  code: string;
  playerId: string;
  token: string;
}

const RETRY_MS = [400, 800, 1600, 3000, 6000, 8000];

export class Net {
  private ws: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private credentials: Credentials | null = null;
  private attempt = 0;
  private timer: number | null = null;
  private closedByUs = false;

  constructor(
    private readonly onMessage: (msg: ServerMessage) => void,
    private readonly onOnline: (online: boolean) => void,
  ) {}

  /** Credentials to replay on every future reconnect. */
  resumeWith(credentials: Credentials | null) {
    this.credentials = credentials;
  }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.closedByUs = false;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.attempt = 0;
      this.onOnline(true);
      if (this.credentials) {
        ws.send(JSON.stringify({ t: "resume", ...this.credentials } satisfies ClientMessage));
      }
      const queued = this.queue;
      this.queue = [];
      for (const msg of queued) ws.send(JSON.stringify(msg));
    });

    ws.addEventListener("message", (event) => {
      try {
        this.onMessage(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        /* a message we can't parse is a message we can't act on */
      }
    });

    ws.addEventListener("close", () => {
      if (this.ws === ws) this.ws = null;
      this.onOnline(false);
      if (!this.closedByUs) this.scheduleReconnect();
    });

    // 'error' is always followed by 'close', which does the retrying
    ws.addEventListener("error", () => this.onOnline(false));
  }

  private scheduleReconnect() {
    if (this.timer !== null) return;
    const delay = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)]!;
    this.attempt++;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else {
      this.queue.push(msg);
      this.connect();
    }
  }

  /** Deliberate teardown: no reconnect, no queued backlog. */
  stop() {
    this.closedByUs = true;
    this.credentials = null;
    this.queue = [];
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
    this.ws = null;
  }
}
