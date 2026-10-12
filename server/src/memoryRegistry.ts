/**
 * The rooms in this process's memory: `RoomRegistry` (`rooms.ts`) behind the
 * `Registry` interface. One process, so no instance may run beside it — the
 * service's `max_instance_count` is 1 under this registry, and development
 * and the tests run it.
 */

import type { Peer, Room } from "./rooms.js";
import { RoomRegistry } from "./rooms.js";
import type { Admitted, Refused, Registry, RegistryOptions, RoomInfo } from "./registry.js";

function infoOf(room: Room): RoomInfo {
  return { id: room.id, hostId: room.hostId, peerCount: room.peers.size, createdAt: room.createdAt };
}

export class MemoryRegistry implements Registry {
  private readonly rooms: RoomRegistry;

  constructor(maxPeers: number, now: () => number = () => Date.now(), hostGraceMs = 60_000, options: RegistryOptions = {}) {
    this.rooms = new RoomRegistry(maxPeers, now, hostGraceMs, {
      ended: (room, reason) => options.onEnded?.(infoOf(room), reason),
    });
  }

  private admitted(roomId: string, result: ReturnType<RoomRegistry["create"]>): Admitted | Refused {
    if (!result.ok) return result;
    const room = this.rooms.get(roomId);
    if (room === undefined) throw new Error(`room ${roomId} vanished after admitting a peer`);
    return { ...result, room: infoOf(room) };
  }

  create(roomId: string, peer: Peer): Promise<Admitted | Refused> {
    return Promise.resolve(this.admitted(roomId, this.rooms.create(roomId, peer)));
  }

  join(roomId: string, peer: Peer): Promise<Admitted | Refused> {
    return Promise.resolve(this.admitted(roomId, this.rooms.join(roomId, peer)));
  }

  leave(roomId: string, peer: Peer): Promise<void> {
    this.rooms.leave(roomId, peer);
    return Promise.resolve();
  }

  disconnect(roomId: string, peer: Peer): Promise<void> {
    this.rooms.disconnect(roomId, peer);
    return Promise.resolve();
  }

  relay(roomId: string, fromId: string, toId: string, payload: unknown): Promise<void> {
    this.rooms.relay(roomId, fromId, toId, payload);
    return Promise.resolve();
  }

  info(roomId: string): RoomInfo | undefined {
    const room = this.rooms.get(roomId);
    return room === undefined ? undefined : infoOf(room);
  }

  sweep(): Promise<void> {
    this.rooms.sweepExpired();
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
