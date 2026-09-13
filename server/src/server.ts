import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { RoomRegistry, type Peer } from "./rooms.js";
import { parseClientMessage, type ServerMessage } from "./protocol.js";
import { TokenBucket } from "./tokenBucket.js";
import {
  clientIpOf,
  ConnectionLimiter,
  DEFAULT_ALLOWED_ORIGINS,
  isAllowedOrigin,
  type ConnectionLimiterOptions,
} from "./admission.js";

export const MAX_PEERS = 5;

/**
 * The one path that carries signaling. Development used to reach the server at
 * `/` via a proxy rewrite and production would have used `/ws`; binding a single
 * path makes the two agree and turns a misrouted upgrade into a refusal rather
 * than a silent success.
 */
export const SIGNALING_PATH = "/ws";

/**
 * Cap on a single WebSocket frame. `ws` defaults to 100 MiB, which was harmless
 * while this server only ever answered `localhost` and became a live hazard the
 * moment it went public: the container is 512 MiB and Cloud Run runs exactly one
 * instance of it (see `max_instance_count` in `_infra/modules/gcp-signaling`),
 * so one unauthenticated frame buffered and then `toString`-ed and `JSON.parse`-d
 * is enough to OOM the only process and take every live room with it.
 *
 * 64 KiB is far past anything legitimate — the largest real message is an SDP
 * offer, a few KB — and `ws` answers an oversized frame by closing that one
 * socket with 1009 without disturbing anyone else's.
 */
export const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * How often to ping every live socket.
 *
 * Without this a half-open socket — the peer's network vanished, no FIN ever
 * arrives — is indistinguishable from an idle one, and signaling goes idle by
 * design the moment the peer-to-peer channels come up. The socket would sit
 * there holding a room slot forever. For a host it is worse than a wasted
 * slot: no close event means `hostDroppedAt` is never set, so the sweep skips
 * that room for the life of the process while everyone holding the invite link
 * is turned away with `host_away`.
 *
 * A missed pong costs one interval to notice and one more to act on, so 30s
 * puts detection inside a minute. Pings also keep the connection warm, which
 * matters because intermediaries drop idle sockets on their own schedule.
 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Inbound message budget per socket: a burst of `CAPACITY`, refilling at
 * `REFILL_PER_SECOND`.
 *
 * `MAX_PAYLOAD_BYTES` bounds how big one frame is; this bounds how many of them
 * arrive. Without it an admitted peer could hold the only process busy parsing
 * — `max_instance_count = 1` means every live room shares it — and could bury
 * one other peer in relayed frames.
 *
 * The numbers are deliberately far above real signaling, which is a join, an
 * offer or answer, and a short flurry of ICE candidates, then silence for the
 * rest of the match. A room filling with four arrivals at once is tens of
 * messages over a few seconds, not hundreds in one. Anything that exhausts this
 * budget is not a client having a busy moment.
 */
export const MESSAGE_RATE_CAPACITY = 100;
export const MESSAGE_RATE_REFILL_PER_SECOND = 50;

/**
 * How far behind a peer may fall before the server stops holding data for it.
 *
 * `ws` queues anything the socket cannot flush yet, in this process's heap, on
 * a 512 MiB container that holds every live room. That is the same failure
 * `MAX_PAYLOAD_BYTES` prevents, reached by a slower road: not one enormous
 * frame, but a backlog nobody is draining. It needs no attacker either — a
 * phone on failing mobile data is a slow consumer.
 *
 * 1 MiB is roughly a thousand times a legitimate backlog, so reaching it means
 * the peer is not reading at all.
 */
export const MAX_BUFFERED_BYTES = 1024 * 1024;

export type SignalingServer = {
  /** Node's listener, exposed so callers can await "listening" and read the port. */
  readonly http: HttpServer;
  /** Terminates live sockets, then stops listening. */
  close(): Promise<void>;
};

/**
 * Holds the `Peer` itself, not just its id: `leave`/`disconnect` are keyed on
 * socket identity so a stale socket's late close cannot evict the replacement
 * the same host already registered (see `rooms.ts`'s `forget`).
 */
type Session = { roomId: string; peer: Peer };

/** `req.url` is a path here, but absolute-form is legal, so parse rather than compare. */
function pathOf(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

/**
 * Turn away an upgrade before it becomes a WebSocket. The client is mid
 * handshake and still speaking HTTP, so it can be told why; `ws` never sees
 * the socket.
 */
function refuseUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`,
  );
  socket.destroy();
}

export type SignalingServerOptions = {
  /** How long a dropped host has to reconnect before the session ends. */
  hostGraceMs?: number;
  /** Injected clock, for tests. */
  now?: () => number;
  /**
   * How often to sweep for lapsed rooms. `RoomRegistry` only sweeps as a side
   * effect of another call, which never fires for a room whose survivors are
   * mid-game over peer-to-peer and idle on signaling — this server, as the
   * owner of the process, drives it instead.
   */
  sweepIntervalMs?: number;
  /**
   * Origins whose pages may open a socket. Defaults to the hostnames the
   * browser build is served from; the deployment overrides it from the
   * environment so a new domain does not need a code change.
   */
  allowedOrigins?: readonly string[];
  /** Per-address connection ceilings. See `ConnectionLimiter`. */
  limits?: ConnectionLimiterOptions;
  /** How often to ping live sockets. Defaults to `HEARTBEAT_INTERVAL_MS`. */
  heartbeatIntervalMs?: number;
  /** Per-socket inbound message budget. Defaults to the `MESSAGE_RATE_*` pair. */
  messageRate?: { capacity?: number; refillPerSecond?: number };
  /** Outbound backlog ceiling. Defaults to `MAX_BUFFERED_BYTES`. */
  maxBufferedBytes?: number;
  /**
   * How to read a socket's unflushed backlog. Injected so the backpressure
   * rule can be tested deterministically — congesting a real socket enough to
   * make `bufferedAmount` grow is timing-dependent and would make the test
   * flaky rather than thorough.
   */
  bufferedAmountOf?: (socket: WebSocket) => number;
};

/**
 * Split from the entry point so tests can start a server on an ephemeral port
 * and drive it with real WebSocket clients.
 */
export function createSignalingServer(
  port: number,
  options: SignalingServerOptions = {},
): SignalingServer {
  const registry = new RoomRegistry(MAX_PEERS, options.now, options.hostGraceMs);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  const limiter = new ConnectionLimiter({ now: options.now, ...options.limits });
  const maxBufferedBytes = options.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
  const bufferedAmountOf = options.bufferedAmountOf ?? ((s: WebSocket) => s.bufferedAmount);

  // Drives `sweepExpired` on a timer so a lapsed room is cleaned up and
  // `host_gone` reaches its survivors even when nobody touches the registry
  // again. It also prunes the limiter, which is the only thing that returns
  // that table's memory. `unref` so this alone never keeps the process — or a
  // test runner — alive.
  const sweeper = setInterval(() => {
    registry.sweepExpired();
    limiter.prune();
  }, options.sweepIntervalMs ?? 10_000);
  sweeper.unref();

  // A socket that has been pinged and has not answered yet. `ws` replies to a
  // ping automatically — and so does every browser, at the protocol level, with
  // no client code involved — so anything still in this set a full interval
  // later is not listening.
  const awaitingPong = new Set<WebSocket>();

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (awaitingPong.has(client)) {
        // Terminate rather than close: there is nobody on the other end to
        // complete a closing handshake with. This raises `close`, which is what
        // routes the peer into `registry.disconnect` and starts the host's
        // grace period.
        client.terminate();
        continue;
      }
      awaitingPong.add(client);
      client.ping();
    }
  }, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  const http = createServer((req, res) => {
    // Cloud Run's startup probe and `npm run deploy:server`'s post-deploy poll
    // both read this. It is deliberately not `/healthz`: on `*.run.app`,
    // Google's frontend intercepts that exact literal path and answers it
    // itself, so a container never sees external requests there — the startup
    // probe still worked (it hits the container directly, bypassing the public
    // edge), which is what made this so easy to ship and so confusing to debug
    // afterward. Every other path, including this one, reaches the container.
    if (req.method === "GET" && pathOf(req) === "/healthcheck") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  http.on("upgrade", (req, socket, head) => {
    if (pathOf(req) !== SIGNALING_PATH) {
      refuseUpgrade(socket, 404, "Not Found");
      return;
    }

    if (!isAllowedOrigin(req.headers.origin, allowedOrigins)) {
      refuseUpgrade(socket, 403, "Forbidden");
      return;
    }

    const admission = limiter.admit(
      clientIpOf(req.headers["x-forwarded-for"], req.socket.remoteAddress),
    );
    if (!admission.ok) {
      refuseUpgrade(socket, 429, "Too Many Requests");
      return;
    }

    // Released on the underlying socket rather than on the WebSocket, so a
    // handshake that never becomes a connection still gives the slot back.
    socket.once("close", () => admission.release());

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (socket: WebSocket) => {
    let session: Session | null = null;

    const budget = new TokenBucket(
      options.messageRate?.capacity ?? MESSAGE_RATE_CAPACITY,
      options.messageRate?.refillPerSecond ?? MESSAGE_RATE_REFILL_PER_SECOND,
      options.now,
    );

    const send = (msg: ServerMessage) => {
      if (socket.readyState !== socket.OPEN) return;

      // Checked before writing, not after: the point is to never grow a
      // backlog this large, and `send` is where the growing happens. Closing
      // beats dropping — a silently discarded offer or ICE candidate would
      // leave the peer waiting on a handshake that can no longer complete,
      // whereas a closed socket reconnects and tries again.
      if (bufferedAmountOf(socket) > maxBufferedBytes) {
        socket.close(1013, "too far behind");
        return;
      }

      socket.send(JSON.stringify(msg));
    };

    socket.on("message", (raw) => {
      // Before `toString` and `JSON.parse`, so a flood costs the parse it was
      // trying to spend. Closing rather than replying is deliberate too: an
      // error frame per offending message would answer a flood with a flood.
      // A closed socket also hands the sender to `ConnectionLimiter`, which
      // bounds how fast it can come back.
      if (!budget.tryConsume()) {
        socket.close(1008, "message rate exceeded");
        return;
      }

      const msg = parseClientMessage(raw.toString());
      if (msg === null) {
        send({ t: "error", code: "bad_message" });
        return;
      }

      if (msg.t === "create" || msg.t === "join") {
        if (session !== null) return; // already in a lobby; ignore duplicates
        const peer: Peer = { id: msg.peerId, send };
        const result = msg.t === "create" ? registry.create(msg.room, peer) : registry.join(msg.room, peer);
        if (!result.ok) {
          send({ t: "error", code: result.code });
          socket.close();
          return;
        }
        session = { roomId: msg.room, peer };
        send({ t: "joined", role: result.role, hostId: result.hostId, peers: result.peers });
        return;
      }

      if (session === null) {
        send({ t: "error", code: "bad_message" });
        return;
      }

      if (msg.t === "signal") {
        registry.relay(session.roomId, session.peer.id, msg.to, msg.payload);
        return;
      }

      if (msg.t === "leave") {
        registry.leave(session.roomId, session.peer);
        session = null;
        socket.close();
      }
    });

    socket.on("pong", () => {
      awaitingPong.delete(socket);
    });

    socket.on("close", () => {
      awaitingPong.delete(socket);
      if (session !== null) {
        // Not `leave`: the socket dying is not the peer choosing to go, and for
        // a host the difference is a live match versus a dead one.
        registry.disconnect(session.roomId, session.peer);
        session = null;
      }
    });

    socket.on("error", () => {
      socket.close();
    });
  });

  http.listen(port);

  return {
    http,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweeper);
        clearInterval(heartbeat);
        // Terminate rather than close: a half-open socket would otherwise hold
        // http.close() open until its own timeout, hanging test teardown.
        for (const client of wss.clients) client.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
