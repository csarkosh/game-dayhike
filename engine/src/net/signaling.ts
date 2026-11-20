export type JoinedInfo = { role: "host" | "client"; hostId: string; peers: string[] };

/** The subset of WebSocket this module uses, so tests can inject a fake. */
export type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
};

export type SignalingClient = {
  /** Opens a lobby as host. Same reply and reconnect shape as `join`. */
  create(roomId: string, peerId: string): Promise<JoinedInfo>;
  join(roomId: string, peerId: string): Promise<JoinedInfo>;
  send(to: string, payload: unknown): void;
  onSignal(handler: (from: string, payload: unknown) => void): () => void;
  /**
   * Every `joined` after the first — the reply to a reconnect's `create`/`join`,
   * which has no waiting caller. The socket has been restored under the same
   * room and peer id, but the server has forgotten anything the peer said over
   * the old one, so a member that announces itself (the lobby module's `hello`)
   * has to say it again.
   */
  onRejoined(handler: (info: JoinedInfo) => void): () => void;
  /**
   * Unused by `app.ts` today and deliberately kept: `peer-joined` is protocol
   * the server still speaks, and the host is reactive — it answers offers on
   * `signal` and needs no arrival notice — so having no caller is the correct
   * state, not dead code awaiting deletion.
   */
  onPeerJoined(handler: (peerId: string) => void): void;
  /**
   * See `onPeerJoined`: `peer-left` has a caller, in the lobby module, which
   * uses it to notice a departure without waiting on a WebRTC timeout.
   * Additive and unsubscribable like `onSignal`, so a lobby that ends stops
   * hearing about departures on a socket that outlives it.
   */
  onPeerLeft(handler: (peerId: string) => void): () => void;
  /** Additive: every registered handler hears every error, until unsubscribed. */
  onError(handler: (code: string) => void): () => void;
  /**
   * The socket is up — fired before the `create`/`join` verb goes out, and
   * again on every reconnect's open. The one milestone between clicking
   * Invite and the `joined` reply, and on a cold Cloud Run instance it is
   * where nearly all of the wait is spent, so the roster's pending bar uses
   * it to say which half of the wait it is in.
   */
  onOpen(handler: () => void): () => void;
  /**
   * Tells the client which side of the room it is, once the server has said so.
   * The only thing this changes is who wins the race to recreate a room after
   * every socket in it drops at once — see `clientReconnectOffsetMs`.
   */
  setRole(role: "host" | "client"): void;
  /** Says goodbye (so the server ends or shrinks the lobby at once), then closes. */
  leave(): void;
  close(): void;
};

export type SignalingClientOptions = {
  /** Delay before each retry; the last entry repeats. Jitter is applied on top. */
  backoffMs?: number[];
  connect?: (url: string) => WebSocketLike;
  /** Source of randomness for jitter. Defaults to Math.random; tests pass a fixed value. */
  random?: () => number;
  /**
   * Extra delay added before a *client's* reconnect, so the host reaches the
   * server first. A Cloud Run revision swap closes every socket in a room at
   * once, and the registry deletes a room the moment its last peer's socket
   * goes — the host grace window never gets to apply, because the host is no
   * longer the last one out. Whoever then reconnects first is recorded as the
   * new `hostId`, which without this is the true host roughly one time in N.
   * Losing that race does not disturb the running match (it is peer-to-peer),
   * but it permanently breaks the invite link: only the real host registers a
   * catch-all offer handler, so a later joiner's offer is relayed to a peer
   * that discards it and the joiner fails with a misleading `ice_failed`.
   *
   * Comfortably larger than the maximum jittered first backoff (500 ms + up to
   * 250 ms), so when both peers reconnect on their first attempt the host wins
   * outright. It is a strong bias rather than a guarantee: if the server stays
   * unreachable past that first attempt, the host's second try lands in
   * [1500, 2250) ms and the client's first in [2000, 2250), so the tails
   * overlap and the client can occasionally still win. A Cloud Run revision
   * swap shifts traffic to the new revision before retiring the old one, so
   * that window is not one this deployment actually produces.
   */
  clientReconnectOffsetMs?: number;
};

const OPEN = 1;
const DEFAULT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
const DEFAULT_CLIENT_RECONNECT_OFFSET_MS = 1500;

export function createSignalingClient(
  url: string,
  options: SignalingClientOptions = {},
): SignalingClient {
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const random = options.random ?? Math.random;
  const clientOffsetMs = options.clientReconnectOffsetMs ?? DEFAULT_CLIENT_RECONNECT_OFFSET_MS;
  // Double cast: the browser's onmessage is typed against MessageEvent, which
  // is not structurally assignable to the narrower shape used here.
  const connect =
    options.connect ?? ((target: string) => new WebSocket(target) as unknown as WebSocketLike);

  // Several peers negotiate over one socket, so signal handlers are additive
  // rather than last-one-wins: the host registers one per connecting client.
  const signalHandlers: ((from: string, payload: unknown) => void)[] = [];
  let joinedHandler: ((peerId: string) => void) | null = null;
  const leftHandlers: ((peerId: string) => void)[] = [];
  const rejoinedHandlers: ((info: JoinedInfo) => void)[] = [];
  // Additive like signalHandlers: a lobby socket outlives many games, and more
  // than one part of the page can care about an error (e.g. the game in
  // progress and the lobby chrome around it).
  const errorHandlers: ((code: string) => void)[] = [];
  const openHandlers: (() => void)[] = [];
  let resolveJoin: ((info: JoinedInfo) => void) | null = null;
  let rejectJoin: ((err: Error) => void) | null = null;

  let socket: WebSocketLike = connect(url);
  let membership: { roomId: string; peerId: string; verb: "create" | "join" } | null = null;
  let closedByUs = false;
  let attempt = 0;
  // Defaults to "client" rather than to the real answer, because before the
  // first `joined` there is no real answer and guessing "host" is the guess
  // that loses rooms: two peers who both believe they host would both rush the
  // recreate. Yielding costs at most one extra offset of reconnect latency.
  let role: "host" | "client" = "client";

  /**
   * Sends the membership verb if the socket is up, and otherwise does nothing
   * — `install`'s `onopen` calls this again the moment it is. It used to
   * assign `socket.onopen` itself, which cannot coexist with `onOpen`
   * subscribers: whichever of the two wrote the property last would be the
   * only one to run. `install` owns the property now and drives both.
   */
  function sendJoin(): void {
    if (membership === null || socket.readyState !== OPEN) return;
    socket.send(
      JSON.stringify({ t: membership.verb, room: membership.roomId, peerId: membership.peerId }),
    );
  }

  function scheduleReconnect(): void {
    if (closedByUs || membership === null) return;
    // The last step repeats rather than growing without bound: a signaling
    // server that is down for an hour should still be retried every 8s, and a
    // host that cannot reconnect cannot accept new players.
    const step = backoff[Math.min(attempt, backoff.length - 1)] ?? 1000;
    attempt += 1;
    // Jitter so five players kicked off by one deploy do not retry in lockstep.
    // The role offset sits on top of it and dwarfs it, so the host is always
    // first back and always reclaims the room as host.
    const offset = role === "host" ? 0 : clientOffsetMs;
    const delay = step + Math.floor(random() * (step / 2)) + offset;
    setTimeout(() => {
      if (closedByUs) return;
      socket = connect(url);
      install();
      sendJoin();
    }, delay);
  }

  function install(): void {
    socket.onopen = () => {
      // Snapshot, for the same reason the signal and error dispatches below
      // take one: a handler may unsubscribe itself during dispatch.
      for (const handler of [...openHandlers]) handler();
      // After the handlers, not before: a subscriber watching the socket come
      // up should not have to reason about whether the verb has gone out yet.
      sendJoin();
    };

    socket.onmessage = (e) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(e.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      switch (msg.t) {
        case "joined": {
          const info: JoinedInfo = {
            role: msg.role as "host" | "client",
            hostId: String(msg.hostId),
            peers: (msg.peers as string[]) ?? [],
          };
          attempt = 0;
          // Only the first join has a waiting caller; a reconnect's reply goes
          // to `onRejoined` instead. The peer list itself still carries no
          // action — the host is reactive and only ever answers offers that
          // arrive on `signal` — but the fact of the reconnect does: whatever a
          // peer told the room over the old socket, the room no longer knows.
          if (resolveJoin !== null) {
            resolveJoin(info);
            resolveJoin = null;
            rejectJoin = null;
          } else {
            // Snapshot, as with the signal and error dispatches below.
            for (const handler of [...rejoinedHandlers]) handler(info);
          }
          break;
        }
        case "signal": {
          const from = String(msg.from);
          // Snapshot: a handler may unsubscribe itself (or an earlier handler)
          // during dispatch, which splices the live array under the cursor and
          // would silently skip whichever handler now sits at that index.
          for (const handler of [...signalHandlers]) handler(from, msg.payload);
          break;
        }
        case "peer-joined":
          joinedHandler?.(String(msg.peerId));
          break;
        case "peer-left": {
          const peerId = String(msg.peerId);
          for (const handler of [...leftHandlers]) handler(peerId);
          break;
        }
        case "error": {
          const code = String(msg.code);
          if (rejectJoin !== null) {
            rejectJoin(new Error(code));
            resolveJoin = null;
            rejectJoin = null;
          }
          // Same snapshot reasoning as the signal dispatch above: the lobby
          // module unsubscribes its own error handler from inside dispatch.
          for (const handler of [...errorHandlers]) handler(code);
          break;
        }
        default:
          break;
      }
    };

    socket.onerror = () => {
      // Only the very first connect can fail the join promise; later failures
      // are the reconnect loop's business, not the caller's.
      if (rejectJoin !== null) {
        rejectJoin(new Error("signaling_unreachable"));
        resolveJoin = null;
        rejectJoin = null;
      }
    };

    socket.onclose = () => {
      if (rejectJoin !== null) {
        rejectJoin(new Error("signaling_closed"));
        resolveJoin = null;
        rejectJoin = null;
      }
      scheduleReconnect();
    };
  }

  install();

  return {
    create(roomId, peerId) {
      // Remembered so every reconnect can recreate the same room as the same
      // peer, which is what lets a dropped host reclaim its role.
      membership = { roomId, peerId, verb: "create" };
      return new Promise<JoinedInfo>((resolve, reject) => {
        resolveJoin = resolve;
        rejectJoin = reject;
        sendJoin();
      });
    },
    join(roomId, peerId) {
      // Remembered so every reconnect can rejoin the same room as the same
      // peer, which is what lets a dropped host reclaim its role.
      membership = { roomId, peerId, verb: "join" };
      return new Promise<JoinedInfo>((resolve, reject) => {
        resolveJoin = resolve;
        rejectJoin = reject;
        sendJoin();
      });
    },
    send(to, payload) {
      if (socket.readyState === OPEN) {
        socket.send(JSON.stringify({ t: "signal", to, payload }));
      }
    },
    onSignal(handler) {
      signalHandlers.push(handler);
      return () => {
        const i = signalHandlers.indexOf(handler);
        if (i >= 0) signalHandlers.splice(i, 1);
      };
    },
    onRejoined(handler) {
      rejoinedHandlers.push(handler);
      return () => {
        const i = rejoinedHandlers.indexOf(handler);
        if (i >= 0) rejoinedHandlers.splice(i, 1);
      };
    },
    onPeerJoined(handler) {
      joinedHandler = handler;
    },
    onPeerLeft(handler) {
      leftHandlers.push(handler);
      return () => {
        const i = leftHandlers.indexOf(handler);
        if (i >= 0) leftHandlers.splice(i, 1);
      };
    },
    onError(handler) {
      errorHandlers.push(handler);
      return () => {
        const i = errorHandlers.indexOf(handler);
        if (i >= 0) errorHandlers.splice(i, 1);
      };
    },
    onOpen(handler) {
      openHandlers.push(handler);
      return () => {
        const i = openHandlers.indexOf(handler);
        if (i >= 0) openHandlers.splice(i, 1);
      };
    },
    setRole(next) {
      role = next;
    },
    leave() {
      // Never reconnects: closedByUs short-circuits scheduleReconnect, and a
      // socket closed by us clears no membership, but that no longer matters
      // once no reconnect will look at it.
      closedByUs = true;
      // If the socket isn't open yet, the send is simply skipped rather than
      // queued: the close that follows still tells the server to drop this
      // peer, just without the one-message head start `leave` gives it.
      if (socket.readyState === OPEN) socket.send(JSON.stringify({ t: "leave" }));
      socket.close();
    },
    close() {
      closedByUs = true;
      socket.close();
    },
  };
}
