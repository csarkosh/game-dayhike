import { describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "../../src/sim/constants.js";
import {
  HEAD_ROW0, MIDGE_AMPS, MIDGE_BLOCK_MAX, MIDGE_SWARMS_MAX, MIDGE_TIER_MAX, SWARM_ROW_FLOATS,
  countAt, createHeads, midgeHash, midgeOffset, packSwarm, shareBudget, stepHeads, swarmFrame,
  type HeadSwarm, type SwarmFrame,
} from "../../src/game/midgeMotion.js";

const TAU = 2 * Math.PI;
const frame = (): SwarmFrame => ({ cx: 0, cy: 0, cz: 0, swirl: 0, flatten: 0 });

describe("the midges' motion", () => {
  it("sizes its table for every marker and a swarm over each player's head", () => {
    expect([MIDGE_SWARMS_MAX, HEAD_ROW0, SWARM_ROW_FLOATS, MIDGE_BLOCK_MAX]).toEqual([32, 25, 12, 520]);
    expect(HEAD_ROW0 + MAX_PLAYERS).toBeLessThanOrEqual(MIDGE_SWARMS_MAX);
    expect(MIDGE_BLOCK_MAX).toBe(Math.ceil(400 * 1.3));
    expect(MIDGE_TIER_MAX).toEqual({ low: 800, medium: 2000, high: 4000 });
    expect(MIDGE_AMPS[0] + MIDGE_AMPS[1] + MIDGE_AMPS[2]).toBeCloseTo(1, 12);
  });

  it("hashes as the shader does, into 0..1", () => {
    expect(midgeHash(0, 0)).toBe(0);
    expect(midgeHash(1, 2)).toBeCloseTo(0.204692671, 9);
    expect(midgeHash(7, 1240)).toBeCloseTo(0.994648529, 9);
    expect(midgeHash(519, 4095)).toBeCloseTo(0.848100545, 9);
    for (let i = 0; i < 520; i += 7) {
      for (let s = 0; s < 4096; s += 61) {
        const h = midgeHash(i, s);
        if (!(h >= 0 && h < 1)) throw new Error(`midgeHash(${i}, ${s}) = ${h}`);
      }
    }
  });

  it("puts a midge where the three sinusoids say", () => {
    const o = { x: 0, y: 0, z: 0 };
    midgeOffset(7, 1240, 2.5, 0.5, 0.5, false, 0, 0, o);
    expect([o.x, o.y, o.z].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0.325148681, 0.18257781, -0.229510958]);
    midgeOffset(7, 1240, 2.5, 0.6, 1.25, true, 0, 0, o);
    expect([o.x, o.y, o.z].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0.390178417, 0.684666789, -0.275413149]);
  });

  it("keeps every midge within its swarm's radius and height, nine in ten inside the radius, and never NaN", () => {
    const o = { x: 0, y: 0, z: 0 };
    let inside = 0, all = 0;
    for (let slot = 0; slot < 520; slot++) {
      for (const seed of [0, 1240, 4095]) {
        for (const t of [0, 0.37, 5, 123.4, 3600.7, 86_400.25, 1e6]) {
          for (const [column, flatten] of [[false, 0], [true, 0], [false, 0.5], [true, 0.5]] as const) {
            const radius = 0.6, height = 1.25;
            midgeOffset(slot, seed, t, radius, height, column, 0, flatten, o);
            if (![o.x, o.y, o.z].every(Number.isFinite)) throw new Error(`slot ${slot}, seed ${seed}, t ${t}: NaN`);
            const vertical = (column ? height : radius / 1.5) * (1 - flatten);
            if (Math.abs(o.x) > radius + 1e-12 || Math.abs(o.z) > radius + 1e-12 || Math.abs(o.y) > vertical + 1e-12) {
              throw new Error(`slot ${slot}, seed ${seed}, t ${t}: (${o.x}, ${o.y}, ${o.z}) outside`);
            }
            all++;
            if (Math.hypot(o.x, o.z) <= radius) inside++;
          }
        }
      }
    }
    expect(inside / all).toBeGreaterThan(0.9);
  });

  it("swirls a column about the vertical and never a ball", () => {
    const f = frame();
    swarmFrame(10, 20, 30, 0.5, true, 1240, 0, 1, 0, 0, f);
    expect(f.swirl).toBe(0);
    swarmFrame(10, 20, 30, 0.5, true, 1240, 1, 1, 0, 0, f);
    // 0.05 to 0.15 rev/s: this column turns 0.0763 of a turn a second
    expect(f.swirl).toBeCloseTo(0.479567648, 9);
    expect(f.swirl / TAU).toBeGreaterThanOrEqual(0.05);
    expect(f.swirl / TAU).toBeLessThanOrEqual(0.15);
    swarmFrame(10, 20, 30, 0.5, true, 1240, 10, 1, 0, 0, f);
    expect(f.swirl).toBeCloseTo(4.795676482, 9);
    // wrapped to a turn, so the float stays precise however long the world has run
    swarmFrame(10, 20, 30, 0.5, true, 1240, 1e6, 1, 0, 0, f);
    expect(f.swirl).toBeGreaterThanOrEqual(0);
    expect(f.swirl).toBeLessThan(TAU);
    for (const t of [0, 1, 10, 1e6]) {
      swarmFrame(10, 20, 30, 0.5, false, 1240, t, 1, 0, 1, f);
      expect(f.swirl).toBe(0);
    }
    // the swirl turns each midge about the axis, keeping its height and its distance from it
    const plain = { x: 0, y: 0, z: 0 }, turned = { x: 0, y: 0, z: 0 };
    midgeOffset(7, 1240, 2.5, 0.6, 1.25, true, 0, 0, plain);
    midgeOffset(7, 1240, 2.5, 0.6, 1.25, true, 1, 0, turned);
    expect(turned.y).toBe(plain.y);
    expect(Math.hypot(turned.x, turned.z)).toBeCloseTo(Math.hypot(plain.x, plain.z), 12);
    expect(Math.atan2(turned.z, turned.x) - Math.atan2(plain.z, plain.x)).toBeCloseTo(1, 12);
  });

  it("pushes a swarm downwind, surges it along the wind and flattens it", () => {
    const f = frame();
    // still air: where it was, round
    swarmFrame(10, 20, 30, 0.5, false, 1240, 3, 0.6, 0.8, 0, f);
    expect([f.cx, f.cy, f.cz, f.flatten]).toEqual([10, 20, 30, 0]);
    // half the full wind's smoothstep: a quarter flatter
    swarmFrame(10, 20, 30, 0.5, false, 1240, 2, 1, 0, 0.375, f);
    expect(f.flatten).toBe(0.25);
    for (const speed of [0.75, 1]) {
      // full wind: half as tall, out and back along the wind between half its radius and one and a half
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 1200; i++) {
        swarmFrame(10, 20, 30, 0.5, false, 1240, i * 0.01, 0.6, 0.8, speed, f);
        expect(f.flatten).toBe(0.5);
        expect(f.cy).toBe(20);
        const along = (f.cx - 10) * 0.6 + (f.cz - 30) * 0.8;
        const across = -(f.cx - 10) * 0.8 + (f.cz - 30) * 0.6;
        expect(Math.abs(across)).toBeLessThan(1e-12);
        lo = Math.min(lo, along); hi = Math.max(hi, along);
      }
      expect(lo).toBeCloseTo(0.25, 5);
      expect(hi).toBeCloseTo(0.75, 5);
    }
    // a flattened ball's midges keep within half its height
    const o = { x: 0, y: 0, z: 0 };
    for (let slot = 0; slot < 520; slot++) {
      midgeOffset(slot, 1240, 4.2, 0.6, 0.6, false, 0, 0.5, o);
      expect(Math.abs(o.y)).toBeLessThanOrEqual((0.6 / 1.5) * 0.5 + 1e-12);
    }
  });

  it("draws a swarm whole within 15 m, a tenth from 60 m and none beyond 80 m", () => {
    const table: [number, number][] = [[0, 400], [15, 400], [37.5, 220], [60, 40], [70, 40], [80, 40], [80.5, 0], [500, 0]];
    for (const [distance, count] of table) expect([distance, countAt(distance, 400)]).toEqual([distance, expect.closeTo(count, 9)]);
  });

  it("holds five heads and every marker within the tier's cap", () => {
    const fulls = new Float32Array(MIDGE_SWARMS_MAX), near = new Float32Array(MIDGE_SWARMS_MAX), out = new Float32Array(MIDGE_SWARMS_MAX);
    for (let r = 0; r < HEAD_ROW0; r++) fulls[r] = MIDGE_BLOCK_MAX;
    for (let r = HEAD_ROW0; r < HEAD_ROW0 + MAX_PLAYERS; r++) fulls[r] = 150;
    const rows = HEAD_ROW0 + MAX_PLAYERS;
    // [tier, sum, a marker's share, a head's share] with every swarm at the camera
    const table: [keyof typeof MIDGE_TIER_MAX, number, number, number][] = [
      ["low", 790, 30, 8], ["medium", 1980, 75, 21], ["high", 3990, 151, 43],
    ];
    for (const [tier, sum, marker, head] of table) {
      shareBudget(fulls, near, rows, MIDGE_TIER_MAX[tier], out);
      let total = 0;
      for (let r = 0; r < rows; r++) {
        expect(Number.isInteger(out[r])).toBe(true);
        total += out[r]!;
      }
      expect([tier, total, out[0], out[HEAD_ROW0]]).toEqual([tier, sum, marker, head]);
      expect(total).toBeLessThanOrEqual(MIDGE_TIER_MAX[tier]);
    }
    // spread from 10 m to 82.5 m: the far ones thin first, the last beyond the cutoff
    const spread = new Float32Array(MIDGE_SWARMS_MAX);
    for (let r = 0; r < rows; r++) spread[r] = 10 + r * 2.5;
    shareBudget(fulls, spread, rows, MIDGE_TIER_MAX.high, out);
    expect(Array.from(out.slice(0, rows))).toEqual([
      308, 308, 308, 293, 277, 262, 246, 231, 215, 200, 185, 169, 154, 138, 123,
      107, 92, 77, 61, 46, 30, 30, 30, 30, 30, 8, 8, 8, 8, 0,
    ]);
    // under the cap nothing is scaled: a near swarm draws its whole count
    shareBudget(fulls, near, 1, MIDGE_TIER_MAX.high, out);
    expect(out[0]).toBe(MIDGE_BLOCK_MAX);
  });

  it("packs a swarm's row as three vec4s", () => {
    const table = new Float32Array(SWARM_ROW_FLOATS * MIDGE_SWARMS_MAX).fill(-1);
    packSwarm(table, 2, { cx: 1.5, cy: 2.5, cz: -3.5, swirl: 0.25, flatten: 0.125 }, 0.5, 1.25, 300, 0.75, true, 1240);
    expect(Array.from(table.slice(24, 36))).toEqual([1.5, 2.5, -3.5, 0.5, 1.25, 300, 0.75, 1, 0.25, 0.125, 1240, 0]);
    packSwarm(table, 3, { cx: 0, cy: 0, cz: 0, swirl: 0, flatten: 0 }, 0.5, 0.5, 60, 1, false, 7);
    expect(table[36 + 7]).toBe(0);
    // the rows either side untouched
    expect(table[23]).toBe(-1);
    expect(table[48]).toBe(-1);
  });
});

describe("the swarms over the players' heads", () => {
  const SEED = -1065037390;
  const still = (heads: HeadSwarm[], player: { x: number; y: number; z: number }, steps: number, band = true, presence = 1, speed = 0): void => {
    for (let i = 0; i < steps; i++) stepHeads(heads, [player], [speed], [band], presence, 0.25);
  };

  it("waits, one for every player, each with its own seed", () => {
    const heads = createHeads(SEED);
    expect(heads.length).toBe(MAX_PLAYERS);
    expect(heads.map((h) => h.seed)).toEqual([1336, 2043, 2924, 1260, 2486]);
    for (const h of heads) expect([h.active, h.still, h.fast]).toEqual([false, 0, 0]);
  });

  it("forms over a player who stands 10 s in the band while the midges are out", () => {
    const heads = createHeads(SEED);
    const player = { x: 5, y: 51.7, z: -3 };
    still(heads, player, 39);
    expect(heads[0]!.active).toBe(false);
    still(heads, player, 1);
    const h = heads[0]!;
    expect(h.active).toBe(true);
    expect([h.x, h.z, h.midges]).toEqual([5, -3, 114]);
    // 0.5 to 1 m over the top of the head, which is 0.9 m over the body's centre
    expect(h.y - player.y - 0.9).toBeCloseTo(0.564616122, 9);
    // not out of the band, not without midges, not while walking
    for (const [band, presence, speed] of [[false, 1, 0], [true, 0, 0], [true, 1, 0.6]] as const) {
      const other = createHeads(SEED);
      still(other, player, 80, band, presence, speed);
      expect(other[0]!.active).toBe(false);
    }
  });

  it("follows the head at no more than 1.5 m/s", () => {
    const heads = createHeads(SEED);
    const player = { x: 0, y: 50, z: 0 };
    still(heads, player, 40);
    const h = heads[0]!;
    const start = { x: h.x, y: h.y, z: h.z };
    player.x = 10;
    for (let i = 0; i < 4; i++) {
      const before = { x: h.x, y: h.y, z: h.z };
      stepHeads(heads, [player], [1], [true], 1, 0.25);
      expect(Math.hypot(h.x - before.x, h.y - before.y, h.z - before.z)).toBeCloseTo(0.375, 12);
    }
    expect([h.x - start.x, h.y - start.y, h.z - start.z]).toEqual([1.5, 0, 0]);
    for (let i = 0; i < 40; i++) stepHeads(heads, [player], [1], [true], 1, 0.25);
    expect([h.x, h.z]).toEqual([10, 0]);
    expect(h.active).toBe(true);
  });

  it("lets go after 3 s faster than 2 m/s, on leaving the band, or when the midges go", () => {
    const player = { x: 0, y: 50, z: 0 };
    const formed = (): HeadSwarm[] => {
      const heads = createHeads(SEED);
      still(heads, player, 40);
      expect(heads[0]!.active).toBe(true);
      return heads;
    };
    let heads = formed();
    for (let i = 0; i < 40; i++) stepHeads(heads, [player], [2], [true], 1, 0.25);
    expect(heads[0]!.active).toBe(true);
    for (let i = 0; i < 11; i++) stepHeads(heads, [player], [2.5], [true], 1, 0.25);
    expect(heads[0]!.active).toBe(true);
    stepHeads(heads, [player], [2.5], [true], 1, 0.25);
    expect(heads[0]!.active).toBe(false);
    heads = formed();
    stepHeads(heads, [player], [1], [false], 1, 0.25);
    expect(heads[0]!.active).toBe(false);
    heads = formed();
    stepHeads(heads, [player], [0], [true], 0, 0.25);
    expect(heads[0]!.active).toBe(false);
  });

  it("does nothing for a player past the array, and lets a departed player's swarm go", () => {
    const heads = createHeads(SEED);
    const players = [{ x: 0, y: 50, z: 0 }, { x: 4, y: 50, z: 4 }];
    for (let i = 0; i < 40; i++) stepHeads(heads, players, [0, 0], [true, true], 1, 0.25);
    expect(heads.map((h) => h.active)).toEqual([true, true, false, false, false]);
    for (const h of heads.slice(2)) expect([h.x, h.y, h.z, h.midges, h.still, h.fast]).toEqual([0, 0, 0, 0, 0, 0]);
    stepHeads(heads, players.slice(0, 1), [0], [true], 1, 0.25);
    expect(heads.map((h) => h.active)).toEqual([true, false, false, false, false]);
  });

  it("allocates nothing as it steps: the same array and the same records", () => {
    const heads = createHeads(SEED);
    const records = [...heads];
    const players = [{ x: 0, y: 50, z: 0 }, { x: 4, y: 50, z: 4 }, { x: 8, y: 50, z: 8 }];
    for (let i = 0; i < 200; i++) {
      players[0]!.x = i * 0.1;
      stepHeads(heads, players, [0.2, 0, 3], [true, true, i % 50 < 40], 1, 1 / 60);
    }
    expect(heads.length).toBe(MAX_PLAYERS);
    heads.forEach((h, i) => expect(h).toBe(records[i]));
    for (const h of heads) expect([h.x, h.y, h.z, h.still, h.fast].every(Number.isFinite)).toBe(true);
    // a step of no time moves nothing and makes no NaN
    stepHeads(heads, players, [0, 0, 0], [true, true, true], 1, 0);
    for (const h of heads) expect([h.x, h.y, h.z].every(Number.isFinite)).toBe(true);
  });
});
