import { describe, expect, it } from "vitest";
import {
  WAY_ACROSS_POINTS, WAY_CHUNK_M, WAY_COLD_SHARE, WAY_CURL, WAY_DENSITY_FLOOR, WAY_FIN_REACH_M, WAY_FIN_SHARE, WAY_FIN_TOP_M, WAY_GROUND_BAND, WAY_GROUND_CORE,
  WAY_GROUND_REACH, WAY_HEAD, WAY_HEAVE, WAY_HEAVE_RATES, WAY_HIDE_SHARE, WAY_KIND_FIN, WAY_KIND_SHEET, WAY_KIND_VEIL, WAY_LIFT_M, WAY_LIGHT_FLOATS, WAY_MATERIAL_LIFT, WAY_MIST_REACH,
  WAY_NEAR_DAMP, WAY_PATH_SHARE, WAY_PATH_TOP_M, WAY_POINT_GROUNDS, WAY_POINT_VERTICES, WAY_POST_LIFT, WAY_ROW_VERTICES, WAY_SHEETS_M, WAY_SHEET_STRENGTH,
  WAY_SHEET_TOP_M, WAY_SHEET_VERTICES, WAY_STRATA_M, WAY_TINT, WAY_VEILS, WAY_VEIL_STRENGTH, WAY_WIDTH_M, WAY_WIND_SCALE,
  wayChunk, wayChunks, wayDrift, wayFinTop, wayGroundOf, wayHeavePhases, wayMistColour, wayVeilAt, type WayShape,
} from "../../src/game/wayLightGeometry.js";
import { CLOUD_NOISE_LARGE_M, CLOUD_NOISE_SMALL_M, CLOUD_WIND_MPS } from "../../src/game/cloudParams.js";

/** A straight way along +x, a point every 2 m, `n` points. */
function straight(n: number): WayShape {
  const xs = new Float32Array(n), zs = new Float32Array(n), cum = new Float32Array(n);
  for (let i = 0; i < n; i++) { xs[i] = i * 2; cum[i] = i * 2; }
  return { xs, zs, cum, length: (n - 1) * 2 };
}
/** A way along +x for ten points, then turned square onto +z: the kink the drawn way has at its sharpest. */
function kinked(): WayShape {
  const xs = new Float32Array(20), zs = new Float32Array(20), cum = new Float32Array(20);
  for (let i = 0; i < 20; i++) { xs[i] = i < 10 ? i * 2 : 18; zs[i] = i < 10 ? 0 : (i - 9) * 2; cum[i] = i * 2; }
  return { xs, zs, cum, length: 38 };
}
const flat = (): number => 10;
const P = WAY_POINT_VERTICES, F = WAY_LIGHT_FLOATS;

describe("the way's mist: its numbers", () => {
  it("is the approved look's shape", () => {
    expect([WAY_WIDTH_M, WAY_SHEET_TOP_M, WAY_FIN_REACH_M, WAY_FIN_TOP_M, WAY_ACROSS_POINTS, WAY_CHUNK_M, WAY_LIFT_M]).toEqual([7, 3, 6.4, 3.6, 4, 64, 0.08]);
    expect(WAY_SHEETS_M).toEqual([0, 0.22, 0.45, 0.7, 0.95, 1.25, 1.6]);
    expect(WAY_VEILS).toEqual([{ out: 2.7, top: 2.3 }, { out: 3.7, top: 3.5 }, { out: 4.9, top: 3.0 }]);
    expect([WAY_ROW_VERTICES, WAY_SHEET_VERTICES, WAY_POINT_VERTICES, WAY_POINT_GROUNDS, WAY_LIGHT_FLOATS]).toEqual([15, 105, 125, 23, 4]);
    expect([WAY_KIND_SHEET, WAY_KIND_VEIL, WAY_KIND_FIN]).toEqual([0, 1, 2]);
  });

  it("builds a veil and a fin taller than its mist stands at rest, with room for the heave: the mist ends before its sheet does", () => {
    expect(WAY_HEAD).toBe(1.3);
    // At rest the large shapes lift a top to 1.2 times its height (the shader's 0.5 + 0.7 of them); the heave adds its share on top, and the shader holds the product to WAY_HEAD.
    expect(WAY_HEAD).toBeGreaterThan(1.2);
    expect(WAY_HEAD).toBeLessThan(1.2 * (1 + WAY_HEAVE));
  });

  it("is the approved look's strengths: fuller on the path, the banks whole", () => {
    expect([WAY_VEIL_STRENGTH, WAY_FIN_SHARE, WAY_SHEET_STRENGTH, WAY_HIDE_SHARE]).toEqual([0.3, 0.7, 0.28, 0.85]);
    expect([WAY_GROUND_BAND, WAY_GROUND_CORE, WAY_GROUND_REACH, WAY_MIST_REACH]).toEqual([0.14, 0.04, 0.012, 0.0144]);
    expect([WAY_PATH_SHARE, WAY_PATH_TOP_M, WAY_NEAR_DAMP, WAY_DENSITY_FLOOR]).toEqual([0.55, 1.7, 0.3, 0.15]);
    expect([WAY_HEAVE, WAY_CURL, WAY_WIND_SCALE, WAY_STRATA_M]).toEqual([0.3, 0.12, 2.2, 4]);
    expect([WAY_COLD_SHARE, WAY_POST_LIFT, WAY_MATERIAL_LIFT]).toEqual([0.25, 8, 14]);
    expect(WAY_TINT).toEqual([0.62, 0.7, 0.86]);
    // The path's mist is thinner and lower than the banks', and there is some.
    expect(WAY_PATH_SHARE).toBeGreaterThan(0);
    expect(WAY_PATH_SHARE).toBeLessThan(1);
    expect(WAY_PATH_TOP_M).toBeLessThan(Math.min(...WAY_VEILS.map((v) => v.top)));
  });
});

describe("the way's mist: its colour and its drift", () => {
  it("is the ground mist's own colour, a quarter of the way to the cold tint at the same weight, lifted", () => {
    const grey = wayMistColour({ r: 0.1, g: 0.1, b: 0.1 }, 1);
    const weight = 0.299 * WAY_TINT[0] + 0.587 * WAY_TINT[1] + 0.114 * WAY_TINT[2];
    for (let i = 0; i < 3; i++) expect(grey[i]).toBeCloseTo(0.1 + (0.1 * WAY_TINT[i]! / weight - 0.1) * WAY_COLD_SHARE, 9);
    // Colder than the grey it came from, and no brighter.
    expect(grey[2]).toBeGreaterThan(grey[0]);
    expect(0.299 * grey[0] + 0.587 * grey[1] + 0.114 * grey[2]).toBeCloseTo(0.1, 9);
    const lifted = wayMistColour({ r: 0.1, g: 0.1, b: 0.1 }, 8);
    for (let i = 0; i < 3; i++) expect(lifted[i]).toBeCloseTo(grey[i]! * 8, 9);
    // The environment's colour carries: a red mist stays redder than a blue one.
    expect(wayMistColour({ r: 0.2, g: 0.1, b: 0.05 }, 1)[0]).toBeGreaterThan(wayMistColour({ r: 0.05, g: 0.1, b: 0.2 }, 1)[0]);
    expect(wayMistColour({ r: 0, g: 0, b: 0 }, 14)).toEqual([0, 0, 0]);
  });

  it("drifts on the ground mist's wind, faster, the small shapes another way from the large", () => {
    expect(wayDrift(0)).toEqual([0, 0, 0, 0]);
    const d = wayDrift(10);
    const large = (10 * CLOUD_WIND_MPS * WAY_WIND_SCALE) / CLOUD_NOISE_LARGE_M, small = (10 * CLOUD_WIND_MPS * WAY_WIND_SCALE) / CLOUD_NOISE_SMALL_M;
    expect(d[0]).toBeCloseTo(large % 1, 9);
    expect(d[1]).toBeCloseTo((large * 0.6) % 1, 9);
    expect(d[2]).toBeCloseTo((small * 0.6) % 1, 9);
    expect(d[3]).toBeCloseTo(small % 1, 9);
    // Each a share of a tile, however long the page has run: the shader's reads never lose their precision.
    for (const s of [0.5, 77, 3600, 86400]) for (const v of wayDrift(s)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
    expect(wayDrift(11)).not.toEqual(d);
  });

  it("heaves on two slow waves, each a turn every seven to twelve seconds, their phases kept within a turn", () => {
    expect(WAY_HEAVE_RATES).toEqual([0.9, 0.55]);
    expect(wayHeavePhases(0)).toEqual([0, 0]);
    const TURN = 2 * Math.PI;
    for (const s of [3, 10, 3600, 86400]) {
      const [a, b] = wayHeavePhases(s);
      expect(a).toBeCloseTo((s * 0.9) % TURN, 6);
      expect(b).toBeCloseTo((s * 0.55) % TURN, 6);
      expect(a).toBeLessThan(TURN);
      expect(b).toBeLessThan(TURN);
    }
    for (const rate of WAY_HEAVE_RATES) { expect(TURN / rate).toBeGreaterThan(6); expect(TURN / rate).toBeLessThan(12); }
  });
});

describe("a chunk of the way's mist", () => {
  const way = straight(40);
  const c = wayChunk(way, flat, 0, 10);

  it("has 125 vertices a point: seven sheets of fifteen, and three veils and a fin a side", () => {
    expect(c.positions.length).toBe(11 * 125 * 3);
    expect(c.light.length).toBe(11 * 125 * 4);
    // Between two points: 14 quads a sheet and a quad a veil. At every point but the last, a fin a side: the next chunk begins on that point and draws its fin.
    expect(c.indices.length).toBe(10 * (14 * 7 + 2 * 3) * 6 + 10 * 2 * 6);
  });

  it("draws every point's fins once over the whole way: the point two chunks share by the later one, the way's last by its own", () => {
    const fins = (from: number, to: number): number => (wayChunk(way, flat, from, to).indices.length - (to - from) * (14 * 7 + 2 * 3) * 6) / 6;
    expect(wayChunks(way)).toEqual([[0, 32], [32, 39]]);
    expect(fins(0, 32)).toBe(32 * 2);
    expect(fins(32, 39)).toBe(8 * 2);
    expect(fins(0, 32) + fins(32, 39)).toBe(40 * 2);
  });

  it("the sheets lie across the whole width at their heights over the ground, each vertex knowing how far from the line it is", () => {
    // Point 3 (x = 6): the sheets come first, the lowest first, each from 7 m one side to 7 m the other.
    for (let l = 0; l < WAY_SHEETS_M.length; l++) {
      for (let k = 0; k < 15; k++) {
        const v = 3 * P + l * 15 + k;
        expect(c.positions[v * 3]).toBeCloseTo(6, 5);
        expect(c.positions[v * 3 + 1]).toBeCloseTo(10 + WAY_LIFT_M + WAY_SHEETS_M[l]!, 5);
        expect(Math.abs(c.positions[v * 3 + 2]!)).toBeCloseTo(Math.abs(k - 7), 5);
        expect([...c.light.slice(v * F, v * F + 4)]).toEqual([Math.abs(k - 7), Math.fround(WAY_SHEETS_M[l]!), WAY_KIND_SHEET, WAY_SHEET_TOP_M]);
      }
    }
    // One edge each side of the line.
    expect(Math.sign(c.positions[(3 * P) * 3 + 2]!)).toBe(-Math.sign(c.positions[(3 * P + 14) * 3 + 2]!));
  });

  it("a veil stands from the ground to its top beside the line, wandering in and out and taller and shorter along the way", () => {
    for (const side of [0, 1]) {
      for (let k = 0; k < 3; k++) {
        const foot = 3 * P + WAY_SHEET_VERTICES + side * 10 + k * 2, head = foot + 1;
        const at = wayVeilAt(k, side === 0 ? 1 : -1, 6);
        expect(Math.abs(c.positions[foot * 3 + 2]!)).toBeCloseTo(at.out, 4);
        expect(c.positions[foot * 3 + 1]).toBeCloseTo(10 + WAY_LIFT_M, 5);
        expect(c.positions[head * 3 + 1]).toBeCloseTo(10 + WAY_LIFT_M + at.top * WAY_HEAD, 4);
        expect(c.positions[head * 3 + 2]).toBeCloseTo(c.positions[foot * 3 + 2]!, 6);
        expect([...c.light.slice(foot * F, foot * F + 4)]).toEqual([Math.fround(at.out), 0, WAY_KIND_VEIL, Math.fround(at.top)]);
        // Its head is built WAY_HEAD times as high as its mist stands, and still says the height its mist stands to.
        expect([...c.light.slice(head * F, head * F + 4)]).toEqual([Math.fround(at.out), Math.fround(at.top * WAY_HEAD), WAY_KIND_VEIL, Math.fround(at.top)]);
      }
    }
    // Never far from where it is meant to stand, never the same twice running.
    for (let k = 0; k < 3; k++) {
      const seen = new Set<number>();
      for (let s = 0; s < 400; s += 2) {
        const at = wayVeilAt(k, 1, s);
        expect(Math.abs(at.out - WAY_VEILS[k]!.out)).toBeLessThanOrEqual(0.75 + 1e-9);
        expect(Math.abs(at.top / WAY_VEILS[k]!.top - 1)).toBeLessThanOrEqual(0.36 + 1e-9);
        seen.add(Math.round(at.out * 1000));
      }
      expect(seen.size).toBeGreaterThan(100);
      expect(wayVeilAt(k, 1, 40)).not.toEqual(wayVeilAt(k, -1, 40));
    }
  });

  it("a fin stands across the way at every point, from the line to 6.4 m out, so an eye looking down the way sees mist whole", () => {
    for (const side of [0, 1]) {
      const at = 3 * P + WAY_SHEET_VERTICES + side * 10 + 6;
      const top = wayFinTop(side === 0 ? 1 : -1, 6);
      const [inFoot, inHead, outFoot, outHead] = [at, at + 1, at + 2, at + 3];
      expect(c.positions[inFoot * 3 + 2]).toBeCloseTo(0, 6);
      expect(Math.abs(c.positions[outFoot * 3 + 2]!)).toBeCloseTo(WAY_FIN_REACH_M, 5);
      expect(c.positions[inFoot * 3 + 1]).toBeCloseTo(10 + WAY_LIFT_M, 5);
      expect(c.positions[inHead * 3 + 1]).toBeCloseTo(10 + WAY_LIFT_M + top * WAY_HEAD, 4);
      expect(c.positions[outHead * 3 + 1]).toBeCloseTo(10 + WAY_LIFT_M + top * WAY_HEAD, 4);
      expect([...c.light.slice(inFoot * F, inFoot * F + 4)]).toEqual([0, 0, WAY_KIND_FIN, Math.fround(top)]);
      expect([...c.light.slice(outHead * F, outHead * F + 4)]).toEqual([Math.fround(WAY_FIN_REACH_M), Math.fround(top * WAY_HEAD), WAY_KIND_FIN, Math.fround(top)]);
    }
    for (let s = 0; s < 400; s += 2) expect(Math.abs(wayFinTop(1, s) / WAY_FIN_TOP_M - 1)).toBeLessThanOrEqual(0.4 + 1e-9);
    // One fin each side.
    const left = 3 * P + WAY_SHEET_VERTICES + 8, right = left + 10;
    expect(Math.sign(c.positions[left * 3 + 2]!)).toBe(-Math.sign(c.positions[right * 3 + 2]!));
  });

  it("every vertex stands on the ground under it, as high over it as it says", () => {
    const sloped = (x: number, z: number): number => 0.1 * x + 0.3 * z;
    const s = wayChunk(way, sloped, 5, 8);
    for (let v = 0; v < s.positions.length / 3; v++) {
      const x = s.positions[v * 3]!, y = s.positions[v * 3 + 1]!, z = s.positions[v * 3 + 2]!;
      expect(y - sloped(x, z) - WAY_LIFT_M).toBeCloseTo(s.light[v * F + 1]!, 4);
    }
  });

  it("names, for each vertex of a point, the one whose ground it stands on: 23 grounds for 125 vertices", () => {
    const own = new Set<number>();
    for (let j = 0; j < P; j++) {
      const g = wayGroundOf(j);
      expect(g).toBeLessThanOrEqual(j);
      expect(wayGroundOf(g)).toBe(g);
      // The same place on the ground, to the float.
      expect(c.positions[(3 * P + g) * 3]).toBe(c.positions[(3 * P + j) * 3]);
      expect(c.positions[(3 * P + g) * 3 + 2]).toBe(c.positions[(3 * P + j) * 3 + 2]);
      own.add(g);
    }
    expect(own.size).toBe(WAY_POINT_GROUNDS);
  });

  it("every index is inside the chunk and no triangle is degenerate", () => {
    const count = c.positions.length / 3;
    for (let t = 0; t < c.indices.length; t += 3) {
      const [a, b, d] = [c.indices[t]!, c.indices[t + 1]!, c.indices[t + 2]!];
      expect(Math.max(a, b, d)).toBeLessThan(count);
      expect(new Set([a, b, d]).size).toBe(3);
    }
  });

  it("follows a bend: well past it the mist lies square across the way", () => {
    const bent = wayChunk(kinked(), flat, 0, 19);
    // The last point's direction is +z, so its sheets span x, 7 m either side.
    const v = 19 * P;
    expect(Math.abs(bent.positions[v * 3]! - 18)).toBeCloseTo(WAY_WIDTH_M, 4);
    expect(bent.positions[v * 3 + 2]).toBeCloseTo(20, 4);
  });

  it("turns through a kink over several points, so the mist never folds over itself on the inside of a bend", () => {
    const bent = wayChunk(kinked(), flat, 0, 19);
    // The way across at each point, from its first sheet's two edges.
    const across = (p: number): [number, number] => {
      const a = p * P, b = a + 14;
      const dx = bent.positions[b * 3]! - bent.positions[a * 3]!, dz = bent.positions[b * 3 + 2]! - bent.positions[a * 3 + 2]!;
      const len = Math.hypot(dx, dz);
      return [dx / len, dz / len];
    };
    let most = 0;
    for (let p = 0; p + 1 < 20; p++) {
      const [ax, az] = across(p), [bx, bz] = across(p + 1);
      most = Math.max(most, Math.acos(Math.min(1, ax * bx + az * bz)));
    }
    // A square kink is a quarter turn; no step between points takes more than a fifth of it.
    expect(most).toBeLessThan(Math.PI / 2 / 5);
    // And neither edge runs backward along the way coming into the turn (the inner one did, by 3 m, when the way across turned at one point).
    for (let p = 0; p + 1 < 10; p++) {
      const a = p * P, b = (p + 1) * P;
      for (const k of [0, 14]) expect(bent.positions[(b + k) * 3]! - bent.positions[(a + k) * 3]!).toBeGreaterThan(-1e-4);
    }
  });

  it("splits a way into chunks of 64 m that share their end points", () => {
    expect(wayChunks(straight(40))).toEqual([[0, 32], [32, 39]]);
    expect(wayChunks(straight(33))).toEqual([[0, 32]]);
    expect(wayChunks(straight(2))).toEqual([[0, 1]]);
    expect(wayChunks(straight(1))).toEqual([]);
  });
});
