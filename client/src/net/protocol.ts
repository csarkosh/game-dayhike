import type { InputCommand, Vec3 } from "../sim/types.js";

/**
 * Bumped whenever the wire format changes (most recently: the lamp byte and
 * the Interacted event). `Welcome` carries it; a client on another version is
 * refused in words instead of decoding garbage. The level id does not cover
 * this — it moves with the terrain, not the codec.
 */
export const PROTOCOL_VERSION = 1;

export const enum MessageType {
  Input = 1,
  Snapshot = 2,
  Hello = 3,
  Welcome = 4,
  PlayerJoined = 5,
  PlayerLeft = 6,
  Interacted = 7,
  Ping = 8,
  Pong = 9,
  SessionEnded = 10,
}

const POSITION_SCALE = 128;
export const POSITION_PRECISION = 1 / POSITION_SCALE;
const POSITION_MIN = -32768 / POSITION_SCALE;
const POSITION_MAX = 32767 / POSITION_SCALE;
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

/** Respawn timers are sent in tenths of a second, capped at 25.5s. */
const RESPAWN_SCALE = 10;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function quantizePosition(v: number): number {
  return Math.round(clamp(v, POSITION_MIN, POSITION_MAX) * POSITION_SCALE);
}
export function dequantizePosition(v: number): number {
  return v / POSITION_SCALE;
}
export function quantizeYaw(v: number): number {
  let a = v % TWO_PI;
  if (a < 0) a += TWO_PI;
  return Math.round((a / TWO_PI) * 65536) & 0xffff;
}
export function dequantizeYaw(v: number): number {
  return (v / 65536) * TWO_PI;
}
export function quantizePitch(v: number): number {
  return Math.round((clamp(v, -HALF_PI, HALF_PI) / HALF_PI) * 127);
}
export function dequantizePitch(v: number): number {
  return (v / 127) * HALF_PI;
}
function quantizeAxis(v: number): number {
  return Math.round(clamp(v, -1, 1) * 127);
}
function dequantizeAxis(v: number): number {
  return v / 127;
}

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
  respawnTimer: number;
  /** The headlamp. Carried as one byte; see {@link encodeLampByte}. */
  lamp: { on: boolean; charge: number };
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
};

export type NetEvent =
  | { t: MessageType.Hello }
  | {
      t: MessageType.Welcome;
      entityId: number;
      tick: number;
      protocolVersion: number;
      levelId: string;
    }
  | { t: MessageType.PlayerJoined; entityId: number }
  | { t: MessageType.PlayerLeft; entityId: number }
  | { t: MessageType.Interacted; entityId: number; targetId: number }
  | { t: MessageType.Ping; stamp: number }
  | { t: MessageType.Pong; stamp: number; hostTick: number }
  | { t: MessageType.SessionEnded; reason: string };

export function messageTypeOf(buffer: ArrayBuffer): number {
  return new DataView(buffer).getUint8(0);
}

const INPUT_BYTES = 13;

export function encodeInput(commands: InputCommand[]): ArrayBuffer {
  const buffer = new ArrayBuffer(3 + commands.length * INPUT_BYTES);
  const view = new DataView(buffer);
  let o = 0;
  view.setUint8(o, MessageType.Input);
  o += 1;
  view.setUint16(o, commands.length, true);
  o += 2;
  for (const c of commands) {
    view.setUint16(o, c.seq & 0xffff, true);
    o += 2;
    view.setInt8(o, quantizeAxis(c.moveX));
    o += 1;
    view.setInt8(o, quantizeAxis(c.moveZ));
    o += 1;
    // Full float precision: the host raycasts with these exact angles.
    view.setFloat32(o, c.yaw, true);
    o += 4;
    view.setFloat32(o, c.pitch, true);
    o += 4;
    view.setUint8(o, c.buttons & 0xff);
    o += 1;
  }
  return buffer;
}

export function decodeInput(buffer: ArrayBuffer): InputCommand[] {
  const view = new DataView(buffer);
  let o = 1;
  // The count is attacker-controlled. Bound it by what the buffer can actually
  // hold so a forged header cannot make us allocate 65535 entries.
  const capacity = Math.max(0, Math.floor((buffer.byteLength - 3) / INPUT_BYTES));
  const count = Math.min(view.getUint16(o, true), capacity);
  o += 2;
  const commands: InputCommand[] = [];
  for (let i = 0; i < count; i++) {
    const seq = view.getUint16(o, true);
    o += 2;
    const moveX = dequantizeAxis(view.getInt8(o));
    o += 1;
    const moveZ = dequantizeAxis(view.getInt8(o));
    o += 1;
    const yaw = view.getFloat32(o, true);
    o += 4;
    const pitch = view.getFloat32(o, true);
    o += 4;
    const buttons = view.getUint8(o);
    o += 1;
    commands.push({ seq, moveX, moveZ, yaw, pitch, buttons });
  }
  return commands;
}

const PLAYER_BYTES = 21;
const ENEMY_BYTES = 12;

export function encodeSnapshot(snapshot: Snapshot): ArrayBuffer {
  const size =
    1 +
    4 +
    2 +
    2 +
    snapshot.players.length * PLAYER_BYTES +
    2 +
    snapshot.enemies.length * ENEMY_BYTES;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  let o = 0;

  view.setUint8(o, MessageType.Snapshot);
  o += 1;
  view.setUint32(o, snapshot.tick, true);
  o += 4;
  view.setUint16(o, snapshot.lastProcessedInput & 0xffff, true);
  o += 2;

  view.setUint16(o, snapshot.players.length, true);
  o += 2;
  for (const p of snapshot.players) {
    view.setUint16(o, p.id, true);
    o += 2;
    view.setInt16(o, quantizePosition(p.pos.x), true);
    o += 2;
    view.setInt16(o, quantizePosition(p.pos.y), true);
    o += 2;
    view.setInt16(o, quantizePosition(p.pos.z), true);
    o += 2;
    view.setInt16(o, quantizePosition(p.vel.x), true);
    o += 2;
    view.setInt16(o, quantizePosition(p.vel.y), true);
    o += 2;
    view.setInt16(o, quantizePosition(p.vel.z), true);
    o += 2;
    view.setUint16(o, quantizeYaw(p.yaw), true);
    o += 2;
    view.setInt8(o, quantizePitch(p.pitch));
    o += 1;
    view.setUint8(o, clamp(p.health, 0, 255));
    o += 1;
    view.setUint8(o, p.grounded ? 1 : 0);
    o += 1;
    view.setUint8(o, clamp(Math.round(p.respawnTimer * RESPAWN_SCALE), 0, 255));
    o += 1;
    view.setUint8(o, encodeLampByte(p.lamp));
    o += 1;
  }

  view.setUint16(o, snapshot.enemies.length, true);
  o += 2;
  for (const e of snapshot.enemies) {
    view.setUint16(o, e.id, true);
    o += 2;
    view.setInt16(o, quantizePosition(e.pos.x), true);
    o += 2;
    view.setInt16(o, quantizePosition(e.pos.y), true);
    o += 2;
    view.setInt16(o, quantizePosition(e.pos.z), true);
    o += 2;
    view.setUint16(o, quantizeYaw(e.yaw), true);
    o += 2;
    view.setUint8(o, clamp(e.health, 0, 255));
    o += 1;
    view.setUint8(o, e.ai & 0xff);
    o += 1;
  }

  return buffer;
}

export function decodeSnapshot(buffer: ArrayBuffer): Snapshot {
  const view = new DataView(buffer);
  let o = 1;

  const tick = view.getUint32(o, true);
  o += 4;
  const lastProcessedInput = view.getUint16(o, true);
  o += 2;

  const playerCount = view.getUint16(o, true);
  o += 2;
  const players: SnapshotPlayer[] = [];
  for (let i = 0; i < playerCount; i++) {
    const id = view.getUint16(o, true);
    o += 2;
    const x = dequantizePosition(view.getInt16(o, true));
    o += 2;
    const y = dequantizePosition(view.getInt16(o, true));
    o += 2;
    const z = dequantizePosition(view.getInt16(o, true));
    o += 2;
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
    const respawnTimer = view.getUint8(o) / RESPAWN_SCALE;
    o += 1;
    const lamp = decodeLampByte(view.getUint8(o));
    o += 1;
    players.push({
      id,
      pos: { x, y, z },
      vel: { x: vx, y: vy, z: vz },
      yaw,
      pitch,
      health,
      grounded,
      respawnTimer,
      lamp,
    });
  }

  const enemyCount = view.getUint16(o, true);
  o += 2;
  const enemies: SnapshotEnemy[] = [];
  for (let i = 0; i < enemyCount; i++) {
    const id = view.getUint16(o, true);
    o += 2;
    const x = dequantizePosition(view.getInt16(o, true));
    o += 2;
    const y = dequantizePosition(view.getInt16(o, true));
    o += 2;
    const z = dequantizePosition(view.getInt16(o, true));
    o += 2;
    const yaw = dequantizeYaw(view.getUint16(o, true));
    o += 2;
    const health = view.getUint8(o);
    o += 1;
    const ai = view.getUint8(o);
    o += 1;
    enemies.push({ id, pos: { x, y, z }, yaw, health, ai });
  }

  return { tick, lastProcessedInput, players, enemies };
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeEvent(event: NetEvent): ArrayBuffer {
  switch (event.t) {
    case MessageType.Hello: {
      const buffer = new ArrayBuffer(1);
      new DataView(buffer).setUint8(0, MessageType.Hello);
      return buffer;
    }
    case MessageType.Welcome: {
      const level = textEncoder.encode(event.levelId);
      const buffer = new ArrayBuffer(1 + 2 + 4 + 1 + 1 + level.length);
      const view = new DataView(buffer);
      view.setUint8(0, MessageType.Welcome);
      view.setUint16(1, event.entityId, true);
      view.setUint32(3, event.tick, true);
      view.setUint8(7, event.protocolVersion & 0xff);
      view.setUint8(8, level.length);
      new Uint8Array(buffer, 9).set(level);
      return buffer;
    }
    case MessageType.PlayerJoined:
    case MessageType.PlayerLeft: {
      const buffer = new ArrayBuffer(3);
      const view = new DataView(buffer);
      view.setUint8(0, event.t);
      view.setUint16(1, event.entityId, true);
      return buffer;
    }
    case MessageType.Interacted: {
      const buffer = new ArrayBuffer(5);
      const view = new DataView(buffer);
      view.setUint8(0, MessageType.Interacted);
      view.setUint16(1, event.entityId, true);
      view.setUint16(3, event.targetId, true);
      return buffer;
    }
    case MessageType.Ping: {
      const buffer = new ArrayBuffer(5);
      const view = new DataView(buffer);
      view.setUint8(0, MessageType.Ping);
      view.setUint32(1, event.stamp >>> 0, true);
      return buffer;
    }
    case MessageType.Pong: {
      const buffer = new ArrayBuffer(9);
      const view = new DataView(buffer);
      view.setUint8(0, MessageType.Pong);
      view.setUint32(1, event.stamp >>> 0, true);
      view.setUint32(5, event.hostTick >>> 0, true);
      return buffer;
    }
    case MessageType.SessionEnded: {
      const reason = textEncoder.encode(event.reason);
      const buffer = new ArrayBuffer(2 + reason.length);
      const view = new DataView(buffer);
      view.setUint8(0, MessageType.SessionEnded);
      view.setUint8(1, reason.length);
      new Uint8Array(buffer, 2).set(reason);
      return buffer;
    }
  }
}

export function decodeEvent(buffer: ArrayBuffer): NetEvent {
  const view = new DataView(buffer);
  const type = view.getUint8(0);
  switch (type) {
    case MessageType.Hello:
      return { t: MessageType.Hello };
    case MessageType.Welcome: {
      const entityId = view.getUint16(1, true);
      const tick = view.getUint32(3, true);
      const protocolVersion = view.getUint8(7);
      // An older (one-byte-shorter) Welcome puts the level length where this
      // decoder expects the version byte and the level id's first character
      // where it expects the length — bound the read to the bytes actually
      // present so that never throws; the version check downstream is what
      // refuses the mismatch in words. See clientSession.ts's Welcome handler.
      const length = Math.min(view.getUint8(8), Math.max(0, buffer.byteLength - 9));
      const levelId = textDecoder.decode(new Uint8Array(buffer, 9, length));
      return { t: MessageType.Welcome, entityId, tick, protocolVersion, levelId };
    }
    case MessageType.PlayerJoined:
      return { t: MessageType.PlayerJoined, entityId: view.getUint16(1, true) };
    case MessageType.PlayerLeft:
      return { t: MessageType.PlayerLeft, entityId: view.getUint16(1, true) };
    case MessageType.Interacted:
      return { t: MessageType.Interacted, entityId: view.getUint16(1, true), targetId: view.getUint16(3, true) };
    case MessageType.Ping:
      return { t: MessageType.Ping, stamp: view.getUint32(1, true) };
    case MessageType.Pong:
      return {
        t: MessageType.Pong,
        stamp: view.getUint32(1, true),
        hostTick: view.getUint32(5, true),
      };
    case MessageType.SessionEnded: {
      const length = view.getUint8(1);
      return {
        t: MessageType.SessionEnded,
        reason: textDecoder.decode(new Uint8Array(buffer, 2, length)),
      };
    }
    default:
      throw new Error(`unknown message type ${type}`);
  }
}
