/**
 * The wire every game built on the engine shares: the message types, how a number is packed,
 * a batch of inputs, and the session's own events (a peer welcomed, joined, left, named, the
 * pings, the session ended). What a snapshot holds past its first bytes, and any event of a
 * game's own, are the game's to pack (`game.ts`).
 */
import type { InputCommand } from "../sim/core.js";

export const enum MessageType {
  Input = 1,
  Snapshot = 2,
  Hello = 3,
  Welcome = 4,
  PlayerJoined = 5,
  PlayerLeft = 6,
  // 7 is free for a game's own event (Day Hike's `Interacted` rides there).
  Ping = 8,
  Pong = 9,
  SessionEnded = 10,
  Named = 11,
}

/**
 * Positions ride as int32 at 1/128 m: about +/-16,777 km, which is every
 * place the terrain can put anything. Velocities share the scale but ride as
 * int16 (+/-256 m/s): they are speeds, and nothing here moves that fast.
 */
const POSITION_SCALE = 128;
export const POSITION_PRECISION = 1 / POSITION_SCALE;
const POSITION_MIN = -2147483648 / POSITION_SCALE;
const POSITION_MAX = 2147483647 / POSITION_SCALE;
const VELOCITY_MIN = -32768 / POSITION_SCALE;
const VELOCITY_MAX = 32767 / POSITION_SCALE;
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function quantizePosition(v: number): number {
  return Math.round(clamp(v, POSITION_MIN, POSITION_MAX) * POSITION_SCALE);
}
export function dequantizePosition(v: number): number {
  return v / POSITION_SCALE;
}
/** Same 1/128 scale as positions, clamped to the int16 a velocity rides in. */
export function quantizeVelocity(v: number): number {
  return Math.round(clamp(v, VELOCITY_MIN, VELOCITY_MAX) * POSITION_SCALE);
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

export type WireEvent =
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
  | { t: MessageType.Ping; stamp: number }
  | { t: MessageType.Pong; stamp: number; hostTick: number }
  | { t: MessageType.SessionEnded; reason: string }
  /** Who is who, for the end screen's names: which peer is behind an entity. */
  | { t: MessageType.Named; entityId: number; peerId: string };

export function messageTypeOf(buffer: ArrayBuffer): number {
  return new DataView(buffer).getUint8(0);
}

const INPUT_BYTES = 15;

export function encodeInput(commands: InputCommand[]): ArrayBuffer {
  const buffer = new ArrayBuffer(3 + commands.length * INPUT_BYTES);
  const view = new DataView(buffer);
  let o = 0;
  view.setUint8(o, MessageType.Input);
  o += 1;
  view.setUint16(o, commands.length, true);
  o += 2;
  for (const c of commands) {
    view.setUint32(o, c.seq >>> 0, true);
    o += 4;
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
    const seq = view.getUint32(o, true);
    o += 4;
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

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeWireEvent(event: WireEvent): ArrayBuffer {
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
    case MessageType.Named: {
      // SessionEnded's shape with the entity id in front: [type][entityId u16][len u8][peerId].
      // The length is a u8: an id over 255 bytes is cut, not wrapped (ids are 36 characters today).
      const bytes = textEncoder.encode(event.peerId);
      const peerId = bytes.subarray(0, Math.min(255, bytes.length));
      const buffer = new ArrayBuffer(1 + 2 + 1 + peerId.length);
      const view = new DataView(buffer);
      view.setUint8(0, MessageType.Named);
      view.setUint16(1, event.entityId, true);
      view.setUint8(3, peerId.length);
      new Uint8Array(buffer, 4).set(peerId);
      return buffer;
    }
  }
}

export function decodeWireEvent(buffer: ArrayBuffer): WireEvent {
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
    case MessageType.Named: {
      const entityId = view.getUint16(1, true);
      // Bound the length read to the bytes actually present, the way Welcome's is.
      const length = Math.min(view.getUint8(3), Math.max(0, buffer.byteLength - 4));
      const peerId = textDecoder.decode(new Uint8Array(buffer, 4, length));
      return { t: MessageType.Named, entityId, peerId };
    }
    default:
      throw new Error(`unknown message type ${type}`);
  }
}
