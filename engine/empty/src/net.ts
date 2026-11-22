/**
 * The empty game, as the network's sessions see it
 * (`@csarkosh/engine/net/game`): a snapshot holds the players' places and
 * nothing else, no button does anything on the host, the host's word corrects
 * nothing beyond what the engine has already taken, and a frame is drawn from
 * the state. A game with more to say adds its fields to the snapshot and the
 * codec below, and raises the version.
 */
import { blendPosition, lerpAngle } from "@csarkosh/engine/net/client";
import type { NetGame, SnapshotMover } from "@csarkosh/engine/net/game";
import {
  MessageType, dequantizePitch, dequantizePosition, dequantizeYaw, quantizePitch, quantizePosition, quantizeVelocity, quantizeYaw,
} from "@csarkosh/engine/net/wire";
import { cloneVec3 } from "@csarkosh/engine/sim/core";
import { WALK_RULES, type WalkState, type WalkWorld, type Walker } from "./sim.js";

/** What two ends of the empty game must share to walk together. */
export const WALK_PROTOCOL = 1;

export type WalkMover = SnapshotMover & { pitch: number };
export type WalkSnapshot = { tick: number; lastProcessedInput: number; players: WalkMover[] };

/** The type, the tick, the last input taken, and how many players follow. */
const HEAD_BYTES = 1 + 4 + 4 + 1;
/** An id, a place, a velocity, a yaw, a pitch, and whether the player stands. */
export const MOVER_BYTES = 2 + 12 + 6 + 2 + 1 + 1;

export function encodeWalkSnapshot(snapshot: WalkSnapshot): ArrayBuffer {
  const buffer = new ArrayBuffer(HEAD_BYTES + snapshot.players.length * MOVER_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, MessageType.Snapshot);
  view.setUint32(1, snapshot.tick, true);
  view.setUint32(5, snapshot.lastProcessedInput >>> 0, true);
  view.setUint8(9, snapshot.players.length);
  let o = HEAD_BYTES;
  for (const p of snapshot.players) {
    view.setUint16(o, p.id, true);
    view.setInt32(o + 2, quantizePosition(p.pos.x), true);
    view.setInt32(o + 6, quantizePosition(p.pos.y), true);
    view.setInt32(o + 10, quantizePosition(p.pos.z), true);
    view.setInt16(o + 14, quantizeVelocity(p.vel.x), true);
    view.setInt16(o + 16, quantizeVelocity(p.vel.y), true);
    view.setInt16(o + 18, quantizeVelocity(p.vel.z), true);
    view.setUint16(o + 20, quantizeYaw(p.yaw), true);
    view.setInt8(o + 22, quantizePitch(p.pitch));
    view.setUint8(o + 23, p.grounded ? 1 : 0);
    o += MOVER_BYTES;
  }
  return buffer;
}

export function decodeWalkSnapshot(buffer: ArrayBuffer): WalkSnapshot {
  const view = new DataView(buffer);
  if (buffer.byteLength < HEAD_BYTES || view.getUint8(0) !== MessageType.Snapshot) throw new Error("not a snapshot of the empty game");
  const count = view.getUint8(9);
  if (buffer.byteLength !== HEAD_BYTES + count * MOVER_BYTES) throw new Error("a snapshot of the empty game of the wrong length");
  const players: WalkMover[] = [];
  let o = HEAD_BYTES;
  for (let i = 0; i < count; i++) {
    players.push({
      id: view.getUint16(o, true),
      pos: { x: dequantizePosition(view.getInt32(o + 2, true)), y: dequantizePosition(view.getInt32(o + 6, true)), z: dequantizePosition(view.getInt32(o + 10, true)) },
      // A velocity rides at a place's scale, in sixteen bits.
      vel: { x: dequantizePosition(view.getInt16(o + 14, true)), y: dequantizePosition(view.getInt16(o + 16, true)), z: dequantizePosition(view.getInt16(o + 18, true)) },
      yaw: dequantizeYaw(view.getUint16(o + 20, true)),
      pitch: dequantizePitch(view.getInt8(o + 22)),
      grounded: view.getUint8(o + 23) === 1,
    });
    o += MOVER_BYTES;
  }
  return { tick: view.getUint32(1, true), lastProcessedInput: view.getUint32(5, true), players };
}

export const WALK: NetGame<WalkWorld, Walker, WalkSnapshot, WalkState, never> = {
  protocolVersion: WALK_PROTOCOL,
  rules: WALK_RULES,
  encodeSnapshot: encodeWalkSnapshot,
  decodeSnapshot: decodeWalkSnapshot,
  // The empty game says nothing of its own over the wire.
  encodeEvent: () => new ArrayBuffer(0),
  decodeEvent: () => null,
  snapshot: (world, lastProcessedInput) => ({
    tick: world.state.tick,
    lastProcessedInput,
    players: [...world.state.players.values()].map((p) => ({ id: p.id, pos: p.pos, vel: p.vel, yaw: p.yaw, pitch: p.pitch, grounded: p.grounded })),
  }),
  tracked: () => [],
  pressed: () => null,
  correct: () => undefined,
  blend: (a, b, alpha) => ({
    tick: b.tick,
    lastProcessedInput: b.lastProcessedInput,
    players: b.players.map((to) => {
      const from = a.players.find((p) => p.id === to.id);
      return from === undefined ? to : { ...to, pos: blendPosition(from.pos, to.pos, alpha), yaw: lerpAngle(from.yaw, to.yaw, alpha) };
    }),
  }),
  view(world, localId, between) {
    const players = new Map<number, Walker>();
    // The others stand where the blended pair has them; the local player is the predicted world's own.
    for (const p of between?.players ?? []) {
      if (p.id === localId) continue;
      players.set(p.id, { id: p.id, pos: cloneVec3(p.pos), vel: cloneVec3(p.vel), yaw: p.yaw, pitch: p.pitch, grounded: p.grounded, lastProcessedInput: 0 });
    }
    const local = world.state.players.get(localId);
    if (local !== undefined) players.set(localId, local);
    return { tick: world.state.tick, players, nextEntityId: world.state.nextEntityId, rngSeed: world.state.rngSeed };
  },
};
