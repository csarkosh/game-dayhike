import { describe, expect, it } from "vitest";
import { LOG_DROP_MAX, LOG_SINK, LOG_STATIONS, logStationOffsets, seatLog, trunkSeat } from "../../src/game/logSeat.js";

/** A trunk along X from -2 to 2: a square section of side `d` whose underside
 * is `y = a + b·x`, and a flare hanging `flare` under it at the -X end. */
function trunk(a: number, b: number, d: number, flare: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = -2 + i * 0.1;
    const low = a + b * x;
    for (const z of [-d / 2, d / 2]) out.push(x, low, z, x, low + d, z);
    // The flare: a few vertices well under the trunk, at one end only.
    if (x < -1.6) out.push(x, low - flare, 0);
  }
  return out;
}

describe("trunkSeat", () => {
  it("finds the trunk's underside, not the root flare under it", () => {
    const seat = trunkSeat(trunk(0.15, 0.08, 0.45, 0.5));
    expect(seat.b).toBeCloseTo(0.08, 2);
    // A station's underside is its lowest vertices', which on a climbing
    // trunk lie at its low edge and not its middle: within b · half a station.
    expect(Math.abs(seat.a - 0.15)).toBeLessThan(0.08 * 0.25 + 1e-6);
    expect(seat.diameter).toBeCloseTo(0.45, 2);
  });

  it("is zero for no geometry", () => {
    expect(trunkSeat([])).toEqual({ a: 0, b: 0, diameter: 0 });
  });
});

describe("seatLog", () => {
  const seat = { a: 0.15, b: 0.08, diameter: 0.45 };
  const offsets: number[] = [];
  logStationOffsets(-2, 2, offsets);

  /** The underside's height at local x, for a seated log. */
  function underside(x: number, scale: number, pitch: number, y: number): number {
    return y + scale * (x * Math.sin(pitch) + (seat.a + seat.b * x) * Math.cos(pitch));
  }

  it("has a station at each end and LOG_STATIONS in all", () => {
    expect(offsets.length).toBe(LOG_STATIONS);
    expect(offsets[0]).toBe(-2);
    expect(offsets[LOG_STATIONS - 1]).toBe(2);
  });

  it("lays the underside a sink below a plane, along its whole length", () => {
    for (const slope of [0, 0.3, -0.6]) {
      for (const scale of [1.5, 2.5]) {
        const heights = offsets.map((x) => 50 + slope * x * scale);
        const { pitch, y } = seatLog(seat, offsets, heights, scale, 0);
        for (const x of [-2, -1, 0, 1, 2]) {
          // Measured down the plumb line at the vertex's own place, to first
          // order in the pitch's foreshortening.
          const ground = 50 + slope * x * scale * Math.cos(pitch);
          const gap = underside(x, scale, pitch, y) - ground;
          expect(gap, `slope ${slope} scale ${scale} x ${x}`).toBeLessThan(0);
          expect(gap).toBeGreaterThan(-(LOG_SINK + 0.25) * seat.diameter * scale - 0.25 * Math.abs(slope));
        }
      }
    }
  });

  it("comes down into a hollow, by no more than LOG_DROP_MAX of its diameter", () => {
    const scale = 2;
    const level = offsets.map(() => 10);
    const flat = seatLog(seat, offsets, level, scale, 0);
    const shallow = seatLog(seat, offsets, offsets.map((_, i) => (i === 2 ? 9.9 : 10)), scale, 0);
    const deep = seatLog(seat, offsets, offsets.map((_, i) => (i === 2 ? 5 : 10)), scale, 0);
    expect(shallow.y).toBeLessThan(flat.y);
    // The deep hollow moves the fitted line down by its mean and the log by
    // the cap below that; it never follows the hollow to its bottom.
    const line = 10 - 5 / LOG_STATIONS;
    expect(deep.y).toBeCloseTo(line - (LOG_DROP_MAX + LOG_SINK) * seat.diameter * scale - seat.a * scale * Math.cos(deep.pitch), 6);
  });
});
