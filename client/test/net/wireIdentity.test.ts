import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MessageType,
  PROTOCOL_VERSION,
  encodeEvent,
  encodeInput,
  encodeSnapshot,
  type NetEvent,
  type Snapshot,
} from "../../src/net/protocol.js";
import type { DeathCause } from "../../src/sim/types.js";

/**
 * The bytes on the wire as they stood on 2026-11-19, by their digest. Every value below is an
 * exact binary fraction, so what is encoded is the same on every machine. A digest that moves
 * means a peer on the build before reads something else from the same message, and that is a
 * new `PROTOCOL_VERSION`, never a quiet change.
 */

function hex(buffer: ArrayBuffer): string {
  return createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
}

function snapshot(): Snapshot {
  return {
    tick: 123456,
    lastProcessedInput: 4321,
    players: Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      pos: { x: i * 3.25 - 400, y: 0.875 + i * 60.5, z: -i * 7.5 },
      vel: { x: i * 1.5, y: -2.25, z: i * -0.75 },
      yaw: i * 1.125,
      pitch: -0.25 + i * 0.125,
      health: 100 - i * 7,
      grounded: i % 2 === 0,
      lamp: { on: i % 2 === 1, charge: i / 4 },
      safe: i === 3,
      cause: (i % 7) as DeathCause,
      stare: i / 4,
    })),
    enemies: Array.from({ length: 30 }, (_, i) => ({
      id: 100 + i,
      pos: { x: i * 12.125 - 180, y: 1 + i * 0.5, z: 240 - i * 16.75 },
      yaw: i * 0.1875,
      health: 40 - (i % 40),
      ai: i % 13,
    })),
    outcome: 2,
    phase: 1,
  };
}

const EVENTS: readonly NetEvent[] = [
  { t: MessageType.Hello },
  { t: MessageType.Welcome, entityId: 7, tick: 98765, protocolVersion: PROTOCOL_VERSION, levelId: "forest/8/olympic/-838591574/1879659486/64181734" },
  { t: MessageType.PlayerJoined, entityId: 3 },
  { t: MessageType.PlayerLeft, entityId: 3 },
  { t: MessageType.Interacted, entityId: 2, targetId: 1001 },
  { t: MessageType.Ping, stamp: 123456.5 },
  { t: MessageType.Pong, stamp: 123456.5, hostTick: 4242 },
  { t: MessageType.SessionEnded, reason: "host left" },
  { t: MessageType.Named, entityId: 4, peerId: "peer-0123456789abcdef" },
];

describe("the wire's identity", () => {
  it("is protocol 7", () => {
    expect(PROTOCOL_VERSION).toBe(7);
  });

  it("packs a snapshot into the bytes it did", () => {
    expect(hex(encodeSnapshot(snapshot()))).toBe("6f9bb6e5a4bedc3fe6f38099e58b56722576c3248e64daf787b737422274047f");
  });

  it("packs an input batch into the bytes it did", () => {
    const commands = Array.from({ length: 6 }, (_, i) => ({
      seq: 1000 + i,
      moveX: (i % 3) - 1,
      moveZ: 1 - (i % 2),
      yaw: i * 0.75,
      pitch: -0.5 + i * 0.25,
      buttons: [0, 1, 2, 4 | 8, 16, 32 | 1][i] as number,
    }));
    expect(hex(encodeInput(commands))).toBe("abc862e6a87bf898471537df8cfa37acf05649029b2e78468bda90a6041b5401");
  });

  it("packs every event into the bytes it did", () => {
    expect(Object.fromEntries(EVENTS.map((event) => [event.t, hex(encodeEvent(event)).slice(0, 16)]))).toEqual({
      [MessageType.Hello]: "084fed08b978af4d",
      [MessageType.Welcome]: "3c173f96b05aaaf8",
      [MessageType.PlayerJoined]: "10e7e401ea88b932",
      [MessageType.PlayerLeft]: "ca99b62e263a85a8",
      [MessageType.Interacted]: "9a7ee20595b80f32",
      [MessageType.Ping]: "7225a27cde77ff9f",
      [MessageType.Pong]: "a15ab95d41f396da",
      [MessageType.SessionEnded]: "faaa2528edd174dc",
      [MessageType.Named]: "39a1f233aa915883",
    });
  });
});
