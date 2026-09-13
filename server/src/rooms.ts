import type { ServerMessage } from "./protocol.js";

export type Peer = { id: string; send(msg: ServerMessage): void };

export type Room = {
  id: string;
  hostId: string;
  peers: Map<string, Peer>;
  /**
   * When the host's socket died, or null while it is connected. A room in this
   * state is intact and playable — the peers are talking to each other
   * directly — it just has no way to hear about new arrivals until the host
   * comes back.
   */
  hostDroppedAt: number | null;
};

export type JoinResult =
  | { ok: true; role: "host" | "client"; hostId: string; peers: string[] }
  | { ok: false; code: "room_full" | "host_away" | "no_such_lobby" | "lobby_taken" };

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly maxPeers: number,
    /**
     * Injected so tests drive the grace period with a fake clock. This class
     * holds no timer of its own — every sweep is triggered by a call, which
     * keeps its behaviour deterministic under that clock. The timer that makes
     * idle rooms lapse lives in `server.ts`, which owns the process; see
     * `sweepExpired`.
     */
    private readonly now: () => number = () => Date.now(),
    private readonly hostGraceMs = 60_000,
  ) {}

  get size(): number {
    this.sweepExpired();
    return this.rooms.size;
  }

  get(roomId: string): Room | undefined {
    this.sweepExpired();
    return this.rooms.get(roomId);
  }

  /**
   * Ends rooms whose host never came back. Walks every room and skips the ones
   * whose host is present, which is cheap because rooms are few — a single
   * instance tops out around 50 of them.
   *
   * Called from every other public method, so a lapsed room is cleaned up and
   * `host_gone` is broadcast the next time *any* peer in it touches the
   * registry — but a room whose survivors are mid-game over peer-to-peer and
   * idle on signaling never touches the registry again, so access alone never
   * fires for exactly the rooms that need it most. That is why this method is
   * public and safe to call at any time: no timer lives in this class, which
   * keeps its behaviour deterministic under an injected clock, and the owner
   * of the process drives it on an interval instead — `server.ts` does, so at
   * the system level sweeping is on a timer even though this class is not.
   */
  sweepExpired(): void {
    for (const [id, room] of this.rooms) {
      if (room.hostDroppedAt === null) continue;
      if (this.now() - room.hostDroppedAt < this.hostGraceMs) continue;
      this.endRoom(id, room);
    }
  }

  private endRoom(roomId: string, room: Room): void {
    for (const other of room.peers.values()) {
      other.send({ t: "error", code: "host_gone" });
    }
    this.rooms.delete(roomId);
  }

  /**
   * A non-host peer's departure, whether deliberate or a dropped socket: tell
   * whoever remains, and clean up the room if that was the last one left.
   */
  private departPeer(roomId: string, room: Room, peerId: string): void {
    for (const other of room.peers.values()) {
      other.send({ t: "peer-left", peerId });
    }
    if (room.peers.size === 0) this.rooms.delete(roomId);
  }

  /**
   * Open a lobby with `peer` as its host. The host is whoever created the
   * lobby, never whoever arrived first: `join` no longer creates.
   *
   * A `create` for an existing lobby by its own host is a reclaim — the host
   * is back inside its grace window, or a stale socket of the same host is
   * being replaced — and the other peers are told nothing, as with `join`'s
   * reclaim. By anyone else it is refused.
   */
  create(roomId: string, peer: Peer): JoinResult {
    this.sweepExpired();
    const room = this.rooms.get(roomId);
    if (room === undefined) {
      this.rooms.set(roomId, {
        id: roomId,
        hostId: peer.id,
        peers: new Map([[peer.id, peer]]),
        hostDroppedAt: null,
      });
      return { ok: true, role: "host", hostId: peer.id, peers: [] };
    }
    if (peer.id !== room.hostId) return { ok: false, code: "lobby_taken" };
    return this.reclaimHost(room, peer);
  }

  /**
   * The host is back on a new socket, whether it left a grace window behind or
   * its old socket is still nominally alive. The other peers are told nothing:
   * as far as they are concerned the host never went anywhere.
   *
   * The stale entry may or may not still be in the map — a grace-window return
   * deleted it on disconnect, a live replacement did not — so its id is
   * filtered out of `peers` either way rather than by knowing which case this
   * is. The host does not need to be told about itself.
   */
  private reclaimHost(room: Room, peer: Peer): JoinResult {
    room.hostDroppedAt = null;
    const existing = [...room.peers.keys()].filter((id) => id !== peer.id);
    room.peers.set(peer.id, peer);
    return { ok: true, role: "host", hostId: room.hostId, peers: existing };
  }

  join(roomId: string, peer: Peer): JoinResult {
    this.sweepExpired();
    const room = this.rooms.get(roomId);

    // A lobby is opened by `create`, by the player who will host it. A join
    // to a lobby that does not exist is an expired or mistyped invite.
    if (room === undefined) return { ok: false, code: "no_such_lobby" };

    if (room.hostDroppedAt !== null) {
      // A host returning inside its window resumes; it never left as far as
      // the other peers are concerned, so they are told nothing.
      if (peer.id === room.hostId) return this.reclaimHost(room, peer);

      // While the host is away its slot stays reserved and the room admits
      // nobody else: a peer let in now would have no host to relay signaling
      // for it if the host never comes back. This is distinct from an
      // ordinarily full room — the condition is transient, not permanent —
      // so it gets its own code rather than borrowing "room_full".
      return { ok: false, code: "host_away" };
    }

    if (room.peers.size >= this.maxPeers) {
      return { ok: false, code: "room_full" };
    }

    const existing = [...room.peers.keys()];
    for (const other of room.peers.values()) {
      other.send({ t: "peer-joined", peerId: peer.id });
    }
    room.peers.set(peer.id, peer);
    return { ok: true, role: "client", hostId: room.hostId, peers: existing };
  }

  /**
   * A peer said goodbye. The host doing this ends the session for everyone at
   * once — it chose to stop. Takes the `Peer` rather than its id so a stale
   * socket cannot evict its own replacement; see `forget`.
   */
  leave(roomId: string, peer: Peer): void {
    this.sweepExpired();
    const room = this.rooms.get(roomId);
    if (room === undefined) return;
    if (!this.forget(room, peer)) return;

    if (peer.id === room.hostId) {
      // No host migration in this milestone: the session ends for everyone.
      this.endRoom(roomId, room);
      return;
    }

    this.departPeer(roomId, room, peer.id);
  }

  /**
   * A peer's socket died without saying goodbye — which on Cloud Run is routine
   * rather than exceptional, since it caps every request at 60 minutes and
   * closes sockets on each scale-down and deploy.
   *
   * For a client this is the same as leaving. For the host it is not: the match
   * runs over peer-to-peer data channels that are still perfectly healthy, so
   * ending it would throw away a working game. The room is held for
   * `hostGraceMs` instead, waiting for the host to reconnect.
   *
   * Takes the `Peer` rather than its id so a stale socket cannot evict its own
   * replacement; see `forget`.
   */
  disconnect(roomId: string, peer: Peer): void {
    this.sweepExpired();
    const room = this.rooms.get(roomId);
    if (room === undefined) return;
    if (!this.forget(room, peer)) return;

    if (peer.id !== room.hostId) {
      this.departPeer(roomId, room, peer.id);
      return;
    }

    // Nobody left to preserve the room for.
    if (room.peers.size === 0) {
      this.rooms.delete(roomId);
      return;
    }

    room.hostDroppedAt = this.now();
  }

  /**
   * Drop `peer` from the room, but only if it is still the socket registered
   * under that id. Departures are keyed on identity rather than on the peer id
   * because a host that reconnected has a *new* `Peer` under the same id: the
   * old socket's close then arrives late (a half-open socket is only noticed
   * when the heartbeat gives up, up to a minute later) and without this check
   * it would evict the live host, strand the room behind `hostDroppedAt`, and
   * kill a session that was never in trouble.
   */
  private forget(room: Room, peer: Peer): boolean {
    if (room.peers.get(peer.id) !== peer) return false;
    room.peers.delete(peer.id);
    return true;
  }

  relay(roomId: string, fromId: string, toId: string, payload: unknown): void {
    this.sweepExpired();
    const room = this.rooms.get(roomId);
    if (room === undefined) return;
    // Only relay within a room, so a room id cannot be used to reach peers
    // in a different session.
    if (!room.peers.has(fromId)) return;
    room.peers.get(toId)?.send({ t: "signal", from: fromId, payload });
  }
}
