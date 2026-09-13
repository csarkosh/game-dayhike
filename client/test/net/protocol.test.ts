import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  MessageType,
  encodeInput,
  decodeInput,
  encodeSnapshot,
  decodeSnapshot,
  encodeLampByte,
  decodeLampByte,
  encodeEvent,
  decodeEvent,
  messageTypeOf,
  quantizePosition,
  dequantizePosition,
  quantizeYaw,
  dequantizeYaw,
  quantizePitch,
  dequantizePitch,
  POSITION_PRECISION,
  type Snapshot,
} from "../../src/net/protocol.js";
import type { InputCommand } from "../../src/sim/types.js";

describe("quantization", () => {
  it("round-trips positions within half a step", () => {
    fc.assert(
      fc.property(fc.double({ min: -255, max: 255, noNaN: true }), (v) => {
        expect(Math.abs(dequantizePosition(quantizePosition(v)) - v)).toBeLessThanOrEqual(
          POSITION_PRECISION / 2 + 1e-9,
        );
      }),
      { numRuns: 2000 },
    );
  });

  it("clamps positions to the int16 range instead of wrapping", () => {
    expect(quantizePosition(1e6)).toBeLessThanOrEqual(32767);
    expect(quantizePosition(-1e6)).toBeGreaterThanOrEqual(-32768);
  });

  it("wraps yaw into [0, 2pi) and round-trips it", () => {
    fc.assert(
      fc.property(fc.double({ min: -20, max: 20, noNaN: true }), (v) => {
        const back = dequantizeYaw(quantizeYaw(v));
        let expected = v % (Math.PI * 2);
        if (expected < 0) expected += Math.PI * 2;
        let diff = Math.abs(back - expected);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        expect(diff).toBeLessThanOrEqual((Math.PI * 2) / 65536 + 1e-9);
      }),
      { numRuns: 2000 },
    );
  });

  it("keeps yaw inside the uint16 range for any input", () => {
    for (const v of [0, 1, -1, 7, -7, 1e6, -1e6]) {
      expect(quantizeYaw(v)).toBeGreaterThanOrEqual(0);
      expect(quantizeYaw(v)).toBeLessThanOrEqual(65535);
    }
  });

  it("clamps pitch to +/- 90 degrees", () => {
    expect(dequantizePitch(quantizePitch(99))).toBeCloseTo(Math.PI / 2, 6);
    expect(dequantizePitch(quantizePitch(-99))).toBeCloseTo(-Math.PI / 2, 6);
  });
});

function command(over: Partial<InputCommand> = {}): InputCommand {
  return { seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over };
}

describe("input codec", () => {
  it("round-trips a batch of commands", () => {
    const commands = [
      command({ seq: 10, moveX: 1, moveZ: -1, yaw: 1.5, pitch: -0.4, buttons: 3 }),
      command({ seq: 11, moveX: -1, moveZ: 1, yaw: -2.5, pitch: 0.4, buttons: 0 }),
    ];
    const back = decodeInput(encodeInput(commands));
    expect(back).toHaveLength(2);
    expect(back[0]?.seq).toBe(10);
    expect(back[0]?.buttons).toBe(3);
    expect(back[0]?.moveX).toBeCloseTo(1, 2);
    expect(back[0]?.moveZ).toBeCloseTo(-1, 2);
    // Aim rides at float32 rather than quantized, because the host raycasts
    // with these exact angles. Not float64: that would add 8 bytes to every
    // command in a 60 Hz stream that already resends up to 16 of them.
    expect(back[0]?.yaw).toBeCloseTo(1.5, 6);
    expect(back[0]?.pitch).toBeCloseTo(-0.4, 6);
    expect(back[1]?.seq).toBe(11);
  });

  it("preserves aim to far finer than the eye can aim", () => {
    // float32 carries ~1e-7 rad, roughly 0.000006 degrees. Assert the bound
    // explicitly so nobody later "fixes" the drift by widening the field.
    const angles = [0.1, -0.4, 1.2345678, -3.14159, 0.000001];
    for (const yaw of angles) {
      const [back] = decodeInput(encodeInput([command({ yaw, pitch: -yaw })]));
      expect(Math.abs((back?.yaw ?? 0) - yaw)).toBeLessThan(1e-6);
      expect(Math.abs((back?.pitch ?? 0) + yaw)).toBeLessThan(1e-6);
    }
  });

  it("round-trips an empty batch", () => {
    expect(decodeInput(encodeInput([]))).toEqual([]);
  });

  it("tags the buffer as an input message", () => {
    expect(messageTypeOf(encodeInput([command()]))).toBe(MessageType.Input);
  });
});

function sampleSnapshot(): Snapshot {
  return {
    tick: 123456,
    lastProcessedInput: 4321,
    players: Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      pos: { x: i * 3.25, y: 0.9, z: -i * 7.5 },
      vel: { x: i * 1.5, y: -2.25, z: i * -0.75 },
      yaw: i * 1.1,
      pitch: -0.3 + i * 0.1,
      health: 100 - i * 7,
      grounded: i % 2 === 0,
      respawnTimer: i === 3 ? 2.5 : 0,
      lamp: { on: i % 2 === 1, charge: i / 4 },
    })),
    enemies: Array.from({ length: 30 }, (_, i) => ({
      id: 100 + i,
      pos: { x: Math.sin(i) * 25, y: 1, z: Math.cos(i) * 25 },
      yaw: i * 0.21,
      health: 40 - (i % 40),
      ai: i % 4,
    })),
  };
}

describe("snapshot codec", () => {
  it("round-trips a full 5-player 30-enemy snapshot", () => {
    const snap = sampleSnapshot();
    const back = decodeSnapshot(encodeSnapshot(snap));
    expect(back.tick).toBe(snap.tick);
    expect(back.lastProcessedInput).toBe(snap.lastProcessedInput);
    expect(back.players).toHaveLength(5);
    expect(back.enemies).toHaveLength(30);

    for (const [i, expected] of snap.players.entries()) {
      const actual = back.players[i]!;
      expect(actual.id).toBe(expected.id);
      expect(actual.health).toBe(expected.health);
      expect(actual.grounded).toBe(expected.grounded);
      expect(Math.abs(actual.pos.x - expected.pos.x)).toBeLessThanOrEqual(POSITION_PRECISION);
      expect(Math.abs(actual.pos.y - expected.pos.y)).toBeLessThanOrEqual(POSITION_PRECISION);
      expect(Math.abs(actual.pos.z - expected.pos.z)).toBeLessThanOrEqual(POSITION_PRECISION);
      // Velocity must survive the trip: reconciliation replays from it.
      expect(Math.abs(actual.vel.x - expected.vel.x)).toBeLessThanOrEqual(POSITION_PRECISION);
      expect(Math.abs(actual.vel.y - expected.vel.y)).toBeLessThanOrEqual(POSITION_PRECISION);
      expect(Math.abs(actual.vel.z - expected.vel.z)).toBeLessThanOrEqual(POSITION_PRECISION);
      expect(actual.respawnTimer).toBeCloseTo(expected.respawnTimer, 1);
      expect(actual.lamp.on).toBe(expected.lamp.on);
      expect(Math.abs(actual.lamp.charge - expected.lamp.charge)).toBeLessThanOrEqual(0.5 / 127);
    }
    for (const [i, expected] of snap.enemies.entries()) {
      const actual = back.enemies[i]!;
      expect(actual.id).toBe(expected.id);
      expect(actual.ai).toBe(expected.ai);
      expect(actual.health).toBe(expected.health);
    }
  });

  it("stays within the bandwidth budget", () => {
    // 471 bytes at 20 Hz is about 9.2 KB/s down per client, and 37 KB/s up
    // for a host serving four of them.
    // 476 bytes: 471 plus one lamp byte for each of the five players.
    expect(encodeSnapshot(sampleSnapshot()).byteLength).toBe(476);
  });

  it("round-trips an empty world", () => {
    const back = decodeSnapshot(
      encodeSnapshot({ tick: 0, lastProcessedInput: 0, players: [], enemies: [] }),
    );
    expect(back.players).toEqual([]);
    expect(back.enemies).toEqual([]);
  });

  it("tags the buffer as a snapshot", () => {
    expect(messageTypeOf(encodeSnapshot(sampleSnapshot()))).toBe(MessageType.Snapshot);
  });

  it("clamps a respawn timer beyond the byte range instead of wrapping", () => {
    const snap = sampleSnapshot();
    snap.players[0]!.respawnTimer = 999;
    const back = decodeSnapshot(encodeSnapshot(snap));
    expect(back.players[0]!.respawnTimer).toBe(25.5);
  });

  it("carries the lamp in one byte and round-trips it at exact charge steps", () => {
    for (const charge of [0, 1 / 127, 0.5, 126 / 127, 1]) {
      const b = encodeLampByte({ on: true, charge });
      expect(b).toBeLessThan(256);
      const back = decodeLampByte(b);
      expect(back.on).toBe(true);
      expect(Math.abs(back.charge - charge)).toBeLessThanOrEqual(0.5 / 127);
    }
    expect(decodeLampByte(encodeLampByte({ on: false, charge: 1 }))).toEqual({ on: false, charge: 1 });
  });
});

describe("event codec", () => {
  it("round-trips a welcome", () => {
    const back = decodeEvent(
      encodeEvent({
        t: MessageType.Welcome,
        entityId: 7,
        tick: 999,
        protocolVersion: 1,
        levelId: "sandbox01",
      }),
    );
    expect(back).toEqual({
      t: MessageType.Welcome,
      entityId: 7,
      tick: 999,
      protocolVersion: 1,
      levelId: "sandbox01",
    });
  });

  it("decodes an old Welcome (one byte shorter, no version field) without throwing", () => {
    // The old layout: [t][entityId u16][tick u32][len u8][levelId] — one byte
    // shorter than the current one's [t][entityId u16][tick u32][version u8][len u8][levelId].
    // The level length sits where the current layout expects the version byte, and the level
    // id's first character sits where it expects the length byte.
    const buildLegacyWelcome = (levelId: string): ArrayBuffer => {
      const idBytes = new TextEncoder().encode(levelId);
      const buffer = new ArrayBuffer(8 + idBytes.length);
      const view = new DataView(buffer);
      view.setUint8(0, MessageType.Welcome);
      view.setUint16(1, 7, true);
      view.setUint32(3, 999, true);
      view.setUint8(7, idBytes.length);
      new Uint8Array(buffer, 8).set(idBytes);
      return buffer;
    };

    for (const levelId of ["sandbox01", "forest-v7-9d126351-aaaaaaaaaaaaaaaaaaaaa"]) {
      const buffer = buildLegacyWelcome(levelId);
      expect(() => decodeEvent(buffer)).not.toThrow();
      const event = decodeEvent(buffer) as { t: MessageType.Welcome; protocolVersion: number };
      expect(event.t).toBe(MessageType.Welcome);
      // The old length byte lands where the version byte is read from —
      // exactly the mismatch the version check downstream refuses in words.
      expect(event.protocolVersion).toBe(levelId.length);
    }
  });

  it("round-trips ping and pong", () => {
    expect(decodeEvent(encodeEvent({ t: MessageType.Ping, stamp: 123456 }))).toEqual({
      t: MessageType.Ping,
      stamp: 123456,
    });
    expect(decodeEvent(encodeEvent({ t: MessageType.Pong, stamp: 7, hostTick: 88 }))).toEqual({
      t: MessageType.Pong,
      stamp: 7,
      hostTick: 88,
    });
  });

  it("round-trips player joined and left", () => {
    expect(decodeEvent(encodeEvent({ t: MessageType.PlayerJoined, entityId: 3 }))).toEqual({
      t: MessageType.PlayerJoined,
      entityId: 3,
    });
    expect(decodeEvent(encodeEvent({ t: MessageType.PlayerLeft, entityId: 3 }))).toEqual({
      t: MessageType.PlayerLeft,
      entityId: 3,
    });
  });

  it("round-trips an interacted event", () => {
    const back = decodeEvent(encodeEvent({ t: MessageType.Interacted, entityId: 3, targetId: 42 }));
    expect(back).toEqual({ t: MessageType.Interacted, entityId: 3, targetId: 42 });
  });

  it("throws on an unknown message type rather than returning junk", () => {
    const buf = new ArrayBuffer(1);
    new DataView(buf).setUint8(0, 200);
    expect(() => decodeEvent(buf)).toThrow(/unknown/i);
  });
});
