/**
 * What the server asks of a room registry, whichever holds the rooms.
 *
 * Two implementations: `MemoryRegistry` (`memoryRegistry.ts`), the rooms in
 * this process's memory as they always were, which is development's and the
 * tests'; and `SharedRegistry` (`sharedRegistry.ts`), the rooms in a store
 * every instance of the service reads and writes, which is what lets the
 * service run on more than one instance. The server (`server.ts`) speaks
 * only to this interface, so the two are interchangeable at start-up by one
 * environment variable (`REGISTRY`).
 *
 * Every method is asynchronous, because the shared one is; the memory one
 * answers at once under the same signature.
 */

import type { Peer, RoomEndReason } from "./rooms.js";
import type { ServerMessage } from "./protocol.js";

export type RefusalCode = Extract<ServerMessage, { t: "error" }>["code"] & ("room_full" | "host_away" | "no_such_lobby" | "lobby_taken");

/** A room as the log's rows describe it: its id, its host, how many peers it holds, and when it opened. */
export type RoomInfo = { id: string; hostId: string; peerCount: number; createdAt: number };

export type Admitted = { ok: true; role: "host" | "client"; hostId: string; peers: string[]; room: RoomInfo };
export type Refused = { ok: false; code: RefusalCode };

export type RegistryOptions = {
  /** Told of every room's end, on the process that ended it, for the log. */
  onEnded?: (room: RoomInfo, reason: RoomEndReason) => void;
};

export interface Registry {
  /** Open a lobby with `peer` as its host, or reclaim one this host dropped. */
  create(roomId: string, peer: Peer): Promise<Admitted | Refused>;
  /** Join an open lobby. */
  join(roomId: string, peer: Peer): Promise<Admitted | Refused>;
  /** A peer said goodbye. The host doing so ends the room for everyone. */
  leave(roomId: string, peer: Peer): Promise<void>;
  /** A peer's socket died. A host's room is held for its grace window. */
  disconnect(roomId: string, peer: Peer): Promise<void>;
  /** Carry a signaling payload from one peer of a room to another. */
  relay(roomId: string, fromId: string, toId: string, payload: unknown): Promise<void>;
  /** What this process knows of a room now, for the log's rows; undefined for one it holds no peer of. */
  info(roomId: string): RoomInfo | undefined;
  /** Ends rooms whose host never came back, and whatever else lapses with time. Driven on a timer by the server. */
  sweep(): Promise<void>;
  /** Lets go of every watch and timer; the server's own close. */
  close(): Promise<void>;
}
