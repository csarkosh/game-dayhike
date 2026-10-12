/**
 * The rooms in a store every instance shares (`store.ts`), so the signaling
 * service can run on more than one instance.
 *
 * The room document is the truth: who hosts it, who sits in it and on which
 * instance, and whether the host's socket is in its grace window. An
 * instance holds the sockets of its own peers (`local`) and watches the
 * document of every room one of them sits in; the difference between one
 * snapshot and the next is what it tells those peers (`peer-joined`,
 * `peer-left`, `host_gone`), the same whichever instance made the change. A
 * signaling payload for a peer on this instance goes straight to its socket;
 * one for a peer elsewhere is posted as mail addressed to that instance, which
 * watches for its mail only while a room of its spans instances. With one
 * instance up — which is most of the time, since the service scales from
 * zero and a second instance comes only when the first holds hundreds of
 * sockets — every relay is in memory and the store sees a handful of writes
 * a party.
 *
 * Nothing here heartbeats a peer: a socket's death is noticed by the
 * instance holding it (`server.ts` pings), which seats it out. An instance
 * that dies without a word leaves its seats behind, so each instance records
 * its own liveness once a minute and the sweep seats out everyone on an
 * instance not heard from (`INSTANCE_STALE_MS`) — a seat younger than that
 * window is kept whatever the record says, since the instance that filled it
 * was alive to do so and may not have written its first word yet. Rooms end
 * as before: a host
 * that says goodbye ends it, a host whose socket died has its grace window,
 * and a room whose last peer left is deleted.
 */

import type { Peer, RoomEndReason } from "./rooms.js";
import type { Admitted, Refused, Registry, RegistryOptions, RoomInfo } from "./registry.js";
import type { RoomDoc, Seat, Store } from "./store.js";

/** How often an instance records that it is alive, and how long since its last word before its seats are given up. */
export const INSTANCE_TOUCH_MS = 60_000;
export const INSTANCE_STALE_MS = 3 * INSTANCE_TOUCH_MS;
/** A room this old is a leak, whatever its document says: a match does not last a day. */
export const ROOM_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type LocalSeat = { peer: Peer; roomId: string; token: string };

type WatchedRoom = {
  /** The document as last seen; null before the first snapshot or after deletion. */
  doc: RoomDoc | null;
  /** The peers the last snapshot listed, to tell arrivals from departures. */
  seen: Set<string>;
  unwatchRoom: () => void;
  unwatchMail: (() => void) | null;
};

export type SharedRegistryOptions = RegistryOptions & {
  /** This instance's name in every seat it fills. */
  instance: string;
  maxPeers: number;
  now?: () => number;
  hostGraceMs?: number;
  /** A fresh token for a seat. Injected so tests can read it. */
  token?: () => string;
};

function infoOf(id: string, doc: RoomDoc): RoomInfo {
  return { id, hostId: doc.hostId, peerCount: Object.keys(doc.peers).length, createdAt: doc.createdAt };
}

export class SharedRegistry implements Registry {
  private readonly store: Store;
  private readonly inst: string;
  private readonly maxPeers: number;
  private readonly now: () => number;
  private readonly hostGraceMs: number;
  private readonly token: () => string;
  private readonly onEnded: (room: RoomInfo, reason: RoomEndReason) => void;
  private readonly local = new Map<string, LocalSeat>();
  private readonly rooms = new Map<string, WatchedRoom>();
  private lastTouch = Number.NEGATIVE_INFINITY;
  private closed = false;

  constructor(store: Store, options: SharedRegistryOptions) {
    this.store = store;
    this.inst = options.instance;
    this.maxPeers = options.maxPeers;
    this.now = options.now ?? (() => Date.now());
    this.hostGraceMs = options.hostGraceMs ?? 60_000;
    this.token = options.token ?? (() => Math.random().toString(36).slice(2));
    this.onEnded = options.onEnded ?? (() => undefined);
  }

  // ---- admission -------------------------------------------------------------

  async create(roomId: string, peer: Peer): Promise<Admitted | Refused> {
    const token = this.token();
    const at = this.now();
    let refused: Refused | null = null;
    const doc = await this.store.updateRoom(roomId, (current) => {
      if (current === null) {
        return { hostId: peer.id, createdAt: at, hostDroppedAt: null, peers: { [peer.id]: { inst: this.inst, token, at } } };
      }
      // A `create` for an existing lobby by its own host is a reclaim — the
      // host is back inside its grace window, or a stale socket of the same
      // host is being replaced. By anyone else it is refused.
      if (current.hostId !== peer.id) {
        refused = { ok: false, code: "lobby_taken" };
        return undefined;
      }
      return { ...current, hostDroppedAt: null, peers: { ...current.peers, [peer.id]: { inst: this.inst, token, at } } };
    });
    if (refused !== null) return refused;
    if (doc === null) throw new Error(`room ${roomId} vanished as it was created`);
    return this.seat(roomId, peer, token, doc, "host");
  }

  async join(roomId: string, peer: Peer): Promise<Admitted | Refused> {
    const token = this.token();
    const at = this.now();
    let refused: Refused | null = null;
    let role: "host" | "client" = "client";
    const doc = await this.store.updateRoom(roomId, (current) => {
      // A lobby is opened by `create`; a join to one that does not exist is
      // an expired or mistyped invite. A room past its age is a leak and is
      // ended rather than joined.
      if (current === null || at - current.createdAt > ROOM_MAX_AGE_MS) {
        refused = { ok: false, code: "no_such_lobby" };
        return current === null ? undefined : null;
      }
      if (current.hostDroppedAt !== null) {
        // The host back inside its window resumes; anyone else waits, since a
        // peer let in now would have no host to relay for it.
        if (peer.id === current.hostId) {
          role = "host";
          return { ...current, hostDroppedAt: null, peers: { ...current.peers, [peer.id]: { inst: this.inst, token, at } } };
        }
        refused = { ok: false, code: "host_away" };
        return undefined;
      }
      // A peer rejoining under its own id (a reconnect) takes its seat back
      // rather than a second one.
      const others = Object.keys(current.peers).filter((id) => id !== peer.id).length;
      if (others >= this.maxPeers) {
        refused = { ok: false, code: "room_full" };
        return undefined;
      }
      return { ...current, peers: { ...current.peers, [peer.id]: { inst: this.inst, token, at } } };
    });
    if (refused !== null) return refused;
    if (doc === null) throw new Error(`room ${roomId} vanished as a peer joined`);
    return this.seat(roomId, peer, token, doc, role);
  }

  /** The peer is in: hold its socket, watch its room, and answer it. */
  private seat(roomId: string, peer: Peer, token: string, doc: RoomDoc, role: "host" | "client"): Admitted {
    this.local.set(peer.id, { peer, roomId, token });
    this.watch(roomId, doc);
    const peers = Object.keys(doc.peers).filter((id) => id !== peer.id);
    return { ok: true, role, hostId: doc.hostId, peers, room: infoOf(roomId, doc) };
  }

  // ---- departure -------------------------------------------------------------

  async leave(roomId: string, peer: Peer): Promise<void> {
    const seat = this.unseat(peer);
    if (seat === null || seat.roomId !== roomId) return;
    await this.vacate(roomId, peer.id, seat.token, "left");
  }

  async disconnect(roomId: string, peer: Peer): Promise<void> {
    const seat = this.unseat(peer);
    if (seat === null || seat.roomId !== roomId) return;
    await this.vacate(roomId, peer.id, seat.token, "dropped");
  }

  /** Forgets a local seat, but only the one this socket holds (the token says). */
  private unseat(peer: Peer): LocalSeat | null {
    const seat = this.local.get(peer.id);
    if (seat === undefined || seat.peer !== peer) return null;
    this.local.delete(peer.id);
    return seat;
  }

  /**
   * Takes a seat out of the room document: the peer's, if the seat is still
   * the one this socket held. A host that left ends the room; a host that
   * dropped starts its grace window, unless nobody is left to hold the room
   * for; a room whose last peer went is deleted.
   */
  private async vacate(roomId: string, peerId: string, token: string, how: "left" | "dropped"): Promise<void> {
    let ended: RoomEndReason | null = null;
    let endedDoc: RoomDoc | null = null;
    await this.store.updateRoom(roomId, (current) => {
      if (current === null || current.peers[peerId]?.token !== token) return undefined;
      const peers = { ...current.peers };
      delete peers[peerId];
      const remaining = Object.keys(peers).length;
      if (peerId === current.hostId) {
        if (how === "left" || remaining === 0) {
          ended = how === "left" ? "host_left" : "empty";
          endedDoc = current;
          return null;
        }
        return { ...current, peers, hostDroppedAt: this.now() };
      }
      if (remaining === 0) {
        ended = "empty";
        endedDoc = current;
        return null;
      }
      return { ...current, peers };
    });
    if (ended !== null && endedDoc !== null) this.onEnded(infoOf(roomId, endedDoc), ended);
  }

  // ---- relay ---------------------------------------------------------------------

  async relay(roomId: string, fromId: string, toId: string, payload: unknown): Promise<void> {
    const from = this.local.get(fromId);
    if (from === undefined || from.roomId !== roomId) return;
    const to = this.local.get(toId);
    if (to !== undefined && to.roomId === roomId) {
      to.peer.send({ t: "signal", from: fromId, payload });
      return;
    }
    // Only within the room, so a room id cannot be used to reach peers in
    // another session; a peer the document does not seat gets nothing.
    const seat = this.rooms.get(roomId)?.doc?.peers[toId];
    if (seat === undefined || seat.inst === this.inst) return;
    await this.store.post(roomId, { to: toId, from: fromId, inst: seat.inst, payload });
  }

  // ---- watching ------------------------------------------------------------------

  /** Watches a room this instance now holds a peer of; `doc` is what the admission saw. */
  private watch(roomId: string, doc: RoomDoc): void {
    const held = this.rooms.get(roomId);
    if (held !== undefined) {
      held.doc = doc;
      this.mailFor(roomId, held);
      return;
    }
    const watched: WatchedRoom = { doc, seen: new Set(Object.keys(doc.peers)), unwatchRoom: () => undefined, unwatchMail: null };
    this.rooms.set(roomId, watched);
    watched.unwatchRoom = this.store.watchRoom(roomId, (next) => this.onRoom(roomId, watched, next));
    this.mailFor(roomId, watched);
  }

  private onRoom(roomId: string, watched: WatchedRoom, next: RoomDoc | null): void {
    if (this.rooms.get(roomId) !== watched) return;
    if (next === null) {
      // The room is gone, by its host's goodbye, its host's grace running
      // out, or its age: whoever is still seated here is told. Peers that
      // left themselves are no longer local, so they hear nothing.
      for (const seat of this.localIn(roomId)) seat.peer.send({ t: "error", code: "host_gone" });
      for (const seat of this.localIn(roomId)) this.local.delete(seat.peer.id);
      this.drop(roomId, watched);
      return;
    }
    const now = new Set(Object.keys(next.peers));
    for (const id of now) {
      if (watched.seen.has(id)) continue;
      for (const seat of this.localIn(roomId)) if (seat.peer.id !== id) seat.peer.send({ t: "peer-joined", peerId: id });
    }
    for (const id of watched.seen) {
      if (now.has(id)) continue;
      for (const seat of this.localIn(roomId)) seat.peer.send({ t: "peer-left", peerId: id });
    }
    // A seat replaced by another instance (the same peer reconnecting
    // elsewhere) is no longer this instance's to answer for.
    for (const seat of this.localIn(roomId)) {
      const mine = next.peers[seat.peer.id];
      if (mine === undefined || mine.token !== seat.token) this.local.delete(seat.peer.id);
    }
    watched.seen = now;
    watched.doc = next;
    if (this.localIn(roomId).length === 0) {
      this.drop(roomId, watched);
      return;
    }
    this.mailFor(roomId, watched);
  }

  /** Watches for this instance's mail in a room while the room spans instances, and not otherwise. */
  private mailFor(roomId: string, watched: WatchedRoom): void {
    const doc = watched.doc;
    const spans = doc !== null && Object.values(doc.peers).some((seat) => seat.inst !== this.inst);
    if (spans && watched.unwatchMail === null) {
      watched.unwatchMail = this.store.watchMail(roomId, this.inst, (mail) => {
        const to = this.local.get(mail.to);
        if (to !== undefined && to.roomId === roomId) to.peer.send({ t: "signal", from: mail.from, payload: mail.payload });
        void this.store.deleteMail(roomId, mail.id);
      });
    } else if (!spans && watched.unwatchMail !== null) {
      watched.unwatchMail();
      watched.unwatchMail = null;
    }
  }

  private drop(roomId: string, watched: WatchedRoom): void {
    watched.unwatchRoom();
    watched.unwatchMail?.();
    this.rooms.delete(roomId);
  }

  private localIn(roomId: string): LocalSeat[] {
    const seats: LocalSeat[] = [];
    for (const seat of this.local.values()) if (seat.roomId === roomId) seats.push(seat);
    return seats;
  }

  info(roomId: string): RoomInfo | undefined {
    const doc = this.rooms.get(roomId)?.doc;
    return doc === undefined || doc === null ? undefined : infoOf(roomId, doc);
  }

  // ---- time -----------------------------------------------------------------------

  /**
   * Ends the rooms this instance watches whose host stayed gone past the
   * window, or that are older than any match; and, once a minute, says this
   * instance is alive and seats out every peer on an instance that is not.
   */
  async sweep(): Promise<void> {
    if (this.closed) return;
    const now = this.now();
    for (const [roomId, watched] of this.rooms) {
      const doc = watched.doc;
      if (doc === null) continue;
      const lapsed = doc.hostDroppedAt !== null && now - doc.hostDroppedAt >= this.hostGraceMs;
      const aged = now - doc.createdAt > ROOM_MAX_AGE_MS;
      if (!lapsed && !aged) continue;
      let endedDoc: RoomDoc | null = null;
      await this.store.updateRoom(roomId, (current) => {
        if (current === null) return undefined;
        const stillLapsed = current.hostDroppedAt !== null && now - current.hostDroppedAt >= this.hostGraceMs;
        if (!stillLapsed && now - current.createdAt <= ROOM_MAX_AGE_MS) return undefined;
        endedDoc = current;
        return null;
      });
      if (endedDoc !== null) this.onEnded(infoOf(roomId, endedDoc), "host_gone");
    }
    if (now - this.lastTouch < INSTANCE_TOUCH_MS) return;
    this.lastTouch = now;
    await this.store.touchInstance(this.inst, now);
    const alive = new Set(await this.store.instancesSeenSince(now - INSTANCE_STALE_MS));
    alive.add(this.inst);
    const seated = (seat: Seat): boolean => alive.has(seat.inst) || now - seat.at < INSTANCE_STALE_MS;
    for (const [roomId, watched] of this.rooms) {
      const doc = watched.doc;
      if (doc === null || Object.values(doc.peers).every(seated)) continue;
      let ended: RoomEndReason | null = null;
      let endedDoc: RoomDoc | null = null;
      await this.store.updateRoom(roomId, (current) => {
        if (current === null) return undefined;
        const peers: RoomDoc["peers"] = {};
        for (const [id, seat] of Object.entries(current.peers)) if (seated(seat)) peers[id] = seat;
        if (Object.keys(peers).length === Object.keys(current.peers).length) return undefined;
        if (Object.keys(peers).length === 0) {
          ended = "empty";
          endedDoc = current;
          return null;
        }
        const hostGone = peers[current.hostId] === undefined && current.hostDroppedAt === null;
        return { ...current, peers, hostDroppedAt: hostGone ? now : current.hostDroppedAt };
      });
      if (ended !== null && endedDoc !== null) this.onEnded(infoOf(roomId, endedDoc), ended);
    }
  }

  /**
   * The process is going: every local peer is seated out at once, as its
   * socket's death would do one by one, so a deploy or a scale-down leaves no
   * seat for the sweep to find a few minutes later.
   */
  async close(): Promise<void> {
    this.closed = true;
    const seats = [...this.local.values()];
    this.local.clear();
    for (const [roomId, watched] of this.rooms) this.drop(roomId, watched);
    for (const seat of seats) await this.vacate(seat.roomId, seat.peer.id, seat.token, "dropped");
    await this.store.forgetInstance(this.inst);
  }
}
