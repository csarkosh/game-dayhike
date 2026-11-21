import type { Vec3 } from "@csarkosh/engine/sim/core";
import type { DeathCause } from "../sim/types.js";
import {
  MessageType, clamp, decodeWireEvent, dequantizePitch, dequantizePosition, dequantizeYaw, encodeWireEvent,
  quantizePitch, quantizePosition, quantizeVelocity, quantizeYaw, type WireEvent,
} from "@csarkosh/engine/net/wire";

// The wire's own pieces are the engine's (`@csarkosh/engine/net/wire`), named from here as before.
export {
  MessageType, POSITION_PRECISION, decodeInput, dequantizePitch, dequantizePosition, dequantizeYaw, encodeInput,
  messageTypeOf, quantizePitch, quantizePosition, quantizeVelocity, quantizeYaw,
} from "@csarkosh/engine/net/wire";

/**
 * Bumped whenever the wire format changes, or what the two ends must agree
 * on that the wire does not show (7, 2026-11-19: the chase follows the way
 * down, which each end draws for itself, and a command's buttons carry the
 * crowd's touch: a page from before it, in a party with one from after,
 * would be held to a path it cannot see; the codec is unchanged. Before
 * that: the summit loop —
 * the phase byte; each player's flags byte, whose bit 0 is safety; the items
 * section and three bytes per player gone; the Named event; before that,
 * the stare, one byte per player; before that, the match outcome and the
 * items; before that, positions widened from
 * int16 to int32 so the wire carries the whole forest rather than a 512 m
 * box around the origin, and input sequence numbers widened from uint16 to
 * uint32 so they no longer wrap after 18 minutes; before that, the lamp
 * byte and the Interacted event). `Welcome` carries it; a client on another
 * version is refused in words instead of decoding garbage. The level id
 * does not cover this — it moves with the terrain, not the codec.
 */
export const PROTOCOL_VERSION = 7;

/**
 * The headlamp packed into one byte: bit 0 is on/off, bits 1-7 are the
 * charge quantized to 127 steps. `charge` stays exactly 1 for now (no
 * drain is implemented yet).
 */
export function encodeLampByte(lamp: { on: boolean; charge: number }): number {
  const q = clamp(Math.round(lamp.charge * 127), 0, 127);
  return (lamp.on ? 1 : 0) | (q << 1);
}
export function decodeLampByte(b: number): { on: boolean; charge: number } {
  return { on: (b & 1) !== 0, charge: (b >> 1) / 127 };
}

/**
 * The player's flag bits in one byte: bit 0 is `safe`, the road corridor;
 * bits 1 to 3 are why they last died (`DeathCause`, under 8). A byte rather
 * than a bit per flag, so the next host-truth boolean costs nothing on the
 * wire.
 */
export function encodeFlagsByte(flags: { safe: boolean; cause: DeathCause }): number {
  return (flags.safe ? 1 : 0) | ((flags.cause & 7) << 1);
}
export function decodeFlagsByte(b: number): { safe: boolean; cause: DeathCause } {
  return { safe: (b & 1) !== 0, cause: ((b >> 1) & 7) as DeathCause };
}

export type SnapshotPlayer = {
  id: number;
  pos: Vec3;
  /**
   * Velocity is networked for players but not enemies, and that asymmetry is
   * load-bearing. A reconciling client resets to the authoritative state and
   * replays; without velocity it would restart from a standstill 20 times a
   * second and never reach full speed. Enemies are interpolated, never
   * predicted, so they do not need it.
   */
  vel: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  grounded: boolean;
  /** The headlamp. Carried as one byte; see {@link encodeLampByte}. */
  lamp: { on: boolean; charge: number };
  /** On the road corridor. Carried in the flags byte; see {@link encodeFlagsByte}. */
  safe: boolean;
  /** Why they last died. Carried in the flags byte beside `safe`. */
  cause: DeathCause;
  /** The stare, 0 to 1, as one byte. */
  stare: number;
};

export type SnapshotEnemy = {
  id: number;
  pos: Vec3;
  yaw: number;
  health: number;
  ai: number;
};

export type Snapshot = {
  tick: number;
  lastProcessedInput: number;
  players: SnapshotPlayer[];
  enemies: SnapshotEnemy[];
  /** `Outcome` as a byte. */
  outcome: number;
  /** `Phase` as a byte. */
  phase: number;
};

/** The message type of Day Hike's own event, in the place the engine's wire leaves free. */
export const enum GameMessage {
  Interacted = 7,
}

/** A player used a thing in the world: said to the player whose press it was. */
export type Interacted = { t: GameMessage.Interacted; entityId: number; targetId: number };

export type NetEvent = WireEvent | Interacted;

export const PLAYER_BYTES = 28;
const ENEMY_BYTES = 18;

export function encodeSnapshot(snapshot: Snapshot): ArrayBuffer {
  const size =
    1 +
    4 +
    4 +
    2 +
    snapshot.players.length * PLAYER_BYTES +
    2 +
    snapshot.enemies.length * ENEMY_BYTES +
    1 +
    1;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  let o = 0;

  view.setUint8(o, MessageType.Snapshot);
  o += 1;
  view.setUint32(o, snapshot.tick, true);
  o += 4;
  view.setUint32(o, snapshot.lastProcessedInput >>> 0, true);
  o += 4;

  view.setUint16(o, snapshot.players.length, true);
  o += 2;
  for (const p of snapshot.players) {
    view.setUint16(o, p.id, true);
    o += 2;
    view.setInt32(o, quantizePosition(p.pos.x), true);
    o += 4;
    view.setInt32(o, quantizePosition(p.pos.y), true);
    o += 4;
    view.setInt32(o, quantizePosition(p.pos.z), true);
    o += 4;
    view.setInt16(o, quantizeVelocity(p.vel.x), true);
    o += 2;
    view.setInt16(o, quantizeVelocity(p.vel.y), true);
    o += 2;
    view.setInt16(o, quantizeVelocity(p.vel.z), true);
    o += 2;
    view.setUint16(o, quantizeYaw(p.yaw), true);
    o += 2;
    view.setInt8(o, quantizePitch(p.pitch));
    o += 1;
    view.setUint8(o, clamp(p.health, 0, 255));
    o += 1;
    view.setUint8(o, p.grounded ? 1 : 0);
    o += 1;
    view.setUint8(o, encodeLampByte(p.lamp));
    o += 1;
    view.setUint8(o, encodeFlagsByte(p));
    o += 1;
    view.setUint8(o, clamp(Math.round(p.stare * 255), 0, 255));
    o += 1;
  }

  view.setUint16(o, snapshot.enemies.length, true);
  o += 2;
  for (const e of snapshot.enemies) {
    view.setUint16(o, e.id, true);
    o += 2;
    view.setInt32(o, quantizePosition(e.pos.x), true);
    o += 4;
    view.setInt32(o, quantizePosition(e.pos.y), true);
    o += 4;
    view.setInt32(o, quantizePosition(e.pos.z), true);
    o += 4;
    view.setUint16(o, quantizeYaw(e.yaw), true);
    o += 2;
    view.setUint8(o, clamp(e.health, 0, 255));
    o += 1;
    view.setUint8(o, e.ai & 0xff);
    o += 1;
  }

  view.setUint8(o, snapshot.outcome & 0xff);
  o += 1;
  view.setUint8(o, snapshot.phase & 0xff);
  o += 1;

  return buffer;
}

export function decodeSnapshot(buffer: ArrayBuffer): Snapshot {
  const view = new DataView(buffer);
  let o = 1;

  const tick = view.getUint32(o, true);
  o += 4;
  const lastProcessedInput = view.getUint32(o, true);
  o += 4;

  const playerCount = view.getUint16(o, true);
  o += 2;
  const players: SnapshotPlayer[] = [];
  for (let i = 0; i < playerCount; i++) {
    const id = view.getUint16(o, true);
    o += 2;
    const x = dequantizePosition(view.getInt32(o, true));
    o += 4;
    const y = dequantizePosition(view.getInt32(o, true));
    o += 4;
    const z = dequantizePosition(view.getInt32(o, true));
    o += 4;
    const vx = dequantizePosition(view.getInt16(o, true));
    o += 2;
    const vy = dequantizePosition(view.getInt16(o, true));
    o += 2;
    const vz = dequantizePosition(view.getInt16(o, true));
    o += 2;
    const yaw = dequantizeYaw(view.getUint16(o, true));
    o += 2;
    const pitch = dequantizePitch(view.getInt8(o));
    o += 1;
    const health = view.getUint8(o);
    o += 1;
    const grounded = view.getUint8(o) !== 0;
    o += 1;
    const lamp = decodeLampByte(view.getUint8(o));
    o += 1;
    const { safe, cause } = decodeFlagsByte(view.getUint8(o));
    o += 1;
    const stare = view.getUint8(o) / 255;
    o += 1;
    players.push({
      id,
      pos: { x, y, z },
      vel: { x: vx, y: vy, z: vz },
      yaw,
      pitch,
      health,
      grounded,
      lamp,
      safe,
      cause,
      stare,
    });
  }

  const enemyCount = view.getUint16(o, true);
  o += 2;
  const enemies: SnapshotEnemy[] = [];
  for (let i = 0; i < enemyCount; i++) {
    const id = view.getUint16(o, true);
    o += 2;
    const x = dequantizePosition(view.getInt32(o, true));
    o += 4;
    const y = dequantizePosition(view.getInt32(o, true));
    o += 4;
    const z = dequantizePosition(view.getInt32(o, true));
    o += 4;
    const yaw = dequantizeYaw(view.getUint16(o, true));
    o += 2;
    const health = view.getUint8(o);
    o += 1;
    const ai = view.getUint8(o);
    o += 1;
    enemies.push({ id, pos: { x, y, z }, yaw, health, ai });
  }

  const outcome = view.getUint8(o);
  o += 1;
  const phase = view.getUint8(o);
  o += 1;

  return { tick, lastProcessedInput, players, enemies, outcome, phase };
}

export function encodeEvent(event: NetEvent): ArrayBuffer {
  if (event.t !== GameMessage.Interacted) return encodeWireEvent(event);
  const buffer = new ArrayBuffer(5);
  const view = new DataView(buffer);
  view.setUint8(0, GameMessage.Interacted);
  view.setUint16(1, event.entityId, true);
  view.setUint16(3, event.targetId, true);
  return buffer;
}

/** Day Hike's own event out of a message of its type, or null for a message that is the engine's. */
export function decodeGameEvent(type: number, buffer: ArrayBuffer): Interacted | null {
  if (type !== GameMessage.Interacted) return null;
  const view = new DataView(buffer);
  return { t: GameMessage.Interacted, entityId: view.getUint16(1, true), targetId: view.getUint16(3, true) };
}

export function decodeEvent(buffer: ArrayBuffer): NetEvent {
  return decodeGameEvent(new DataView(buffer).getUint8(0), buffer) ?? decodeWireEvent(buffer);
}
