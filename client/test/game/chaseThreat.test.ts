import { describe, expect, it } from "vitest";
import { THREAT_CENTRE_DEG, THREAT_FAR_M, THREAT_NEAR_M, THREAT_WIDE_DEG, threatOf } from "../../src/game/chaseThreat.js";

/** An eye at the origin looking along +z (yaw 0), and a place `d` metres off at `deg` degrees to the right of its look. */
const EYE = { x: 0, z: 0, yaw: 0 };
const at = (d: number, deg: number): [number, number] => [d * Math.sin((deg * Math.PI) / 180), d * Math.cos((deg * Math.PI) / 180)];

describe("what is at the centre of a player's view", () => {
  it("names its numbers: whole within 6 degrees of the look and 6 m, nothing past 25 degrees or 30 m", () => {
    expect([THREAT_CENTRE_DEG, THREAT_WIDE_DEG, THREAT_NEAR_M, THREAT_FAR_M]).toEqual([6, 25, 6, 30]);
  });

  it("is whole for a thing close and dead ahead, and nothing for one behind, far off, or out at the side", () => {
    expect(threatOf(EYE, ...at(4, 0))).toBe(1);
    expect(threatOf(EYE, ...at(THREAT_NEAR_M, THREAT_CENTRE_DEG - 1))).toBeCloseTo(1, 9);
    expect(threatOf(EYE, ...at(4, 180))).toBe(0);
    expect(threatOf(EYE, ...at(4, THREAT_WIDE_DEG + 1))).toBe(0);
    expect(threatOf(EYE, ...at(4, -(THREAT_WIDE_DEG + 1)))).toBe(0);
    expect(threatOf(EYE, ...at(THREAT_FAR_M + 1, 0))).toBe(0);
    expect(threatOf(EYE, 0, 0)).toBe(0);
  });

  it("falls away evenly with distance and with how far off the look a thing stands, the same to either side", () => {
    let last = 1;
    for (let d = THREAT_NEAR_M; d <= THREAT_FAR_M; d += 2) {
      const now = threatOf(EYE, ...at(d, 0));
      expect(now).toBeLessThanOrEqual(last);
      last = now;
    }
    expect(threatOf(EYE, ...at((THREAT_NEAR_M + THREAT_FAR_M) / 2, 0))).toBeCloseTo(0.5, 2);
    last = 1;
    for (let deg = THREAT_CENTRE_DEG; deg <= THREAT_WIDE_DEG; deg += 1) {
      const now = threatOf(EYE, ...at(4, deg));
      expect(now).toBeLessThanOrEqual(last);
      expect(threatOf(EYE, ...at(4, -deg))).toBeCloseTo(now, 9);
      last = now;
    }
    expect(threatOf(EYE, ...at(4, 15))).toBeGreaterThan(0.2);
    expect(threatOf(EYE, ...at(4, 15))).toBeLessThan(0.8);
  });

  it("follows the look, and counts a thing by how much of it is there", () => {
    const [x, z] = at(5, 90);
    expect(threatOf(EYE, x, z)).toBe(0);
    expect(threatOf({ x: 0, z: 0, yaw: Math.PI / 2 }, x, z)).toBe(1);
    expect(threatOf(EYE, ...at(4, 0), 0.25)).toBe(0.25);
  });
});
