// client/test/game/oceanBreaker.test.ts
/**
 * The plunging breaker's arithmetic (oceanBreaker.ts): the plunge share, the
 * progress through the plunge, the crest's place from a sample's phase, the
 * baked cross-section, and the tracker that fills the strip's slots and the
 * plunges from the swell's sum.
 */
import { describe, it, expect } from "vitest";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { COVE_FACE_GRADE, COVE_TOE_DEPTH, coveFor } from "../../src/sim/olympic.js";
import { coastRead, oceanFieldFor, oceanFieldFromState, swellAt, swellPhases, type OceanField } from "../../src/game/oceanWaves.js";
import {
  LIP_COLUMNS, LIP_CREST_TRAVEL, LIP_KEYFRAMES, LIP_PLUNGES, LIP_PROFILE_VERTS, LIP_SLOTS, LIP_SPEED_MAX, LIP_SPEED_MIN,
  LIP_STEP_MAX_S, LIP_TUBE_RATIO, LipTracker, crestOffset, faceIribarren, lipKey, lipProfile, plungeShare, profileAt, progressOf,
} from "../../src/game/oceanBreaker.js";
import type { SwashCove } from "../../src/game/swashTable.js";
import { LOBBY_SEEDS } from "../sim/trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant("olympic");

/** room-3: the cove at z0 = 0, 164.1 m half-wide; Hs 1.36 m, Tp 10.26 s. */
const SEED = LOBBY_SEEDS[3] as number;

/** The cove as the swash table takes it: the seed's width, the terrain's toe and face. */
function coveOf(seed: number, field: OceanField): SwashCove {
  const c = coveFor(seed);
  return {
    z0: c.z0, halfWidth: c.halfWidth, toeD: -COVE_TOE_DEPTH / COVE_FACE_GRADE, faceGrade: COVE_FACE_GRADE,
    coastX: (z: number) => coastRead(field.tables, z)[0],
  };
}

/** A slot's four floats: (crest d, progress, height, share). */
const slotAt = (data: Float32Array, slot: number, column: number): number[] =>
  Array.from(data.subarray((slot * LIP_COLUMNS + column) * 4, (slot * LIP_COLUMNS + column) * 4 + 4));

describe("the plunge share and the progress", () => {
  it("plunges the cove's face, spills the bays' sand, and gives way to an onshore wind", () => {
    expect(plungeShare(0.8, 0)).toBe(1);
    expect(plungeShare(0.8, 1)).toBe(0);
    expect(plungeShare(0.15, 0)).toBe(0);
    expect(plungeShare(0.5, 0)).toBe(0.5);
    expect(plungeShare(0.5, 0.5)).toBe(0.25);
    // a weight outside 0..1 is held to it, and a value that is not finite plunges nothing
    expect(plungeShare(0.8, 2)).toBe(0);
    expect(plungeShare(0.8, -1)).toBe(1);
    expect(plungeShare(Number.NaN, 0)).toBe(0);
    expect(plungeShare(0.8, Number.NaN)).toBe(0);
  });

  it("takes the face's Iribarren number from the offshore steepness: about 0.8 on the 1:12 face, 0.15 on the bays' 1:67", () => {
    expect(faceIribarren(2, 11, 1 / 12)).toBeCloseTo(0.80992, 5);
    expect(faceIribarren(2, 11, 1 / 67)).toBeCloseTo(0.14506, 5);
    // room-3's swell on its face
    expect(faceIribarren(1.3618361951123206, 10.260011619614993, COVE_FACE_GRADE)).toBeCloseTo(0.91548, 5);
  });

  it("runs the progress over the cap's window, ratio 1 to 1.5", () => {
    expect(progressOf(0.8)).toBe(0);
    expect(progressOf(1.0)).toBe(0);
    expect(progressOf(1.25)).toBe(0.5);
    expect(progressOf(1.5)).toBe(1);
    expect(progressOf(2.0)).toBe(1);
    expect(progressOf(Number.NaN)).toBe(0);
  });

  it("puts the crest behind the sample by its phase's share of a wavelength", () => {
    expect(crestOffset(Math.PI / 2, 28)).toBeCloseTo(7, 12);
    expect(crestOffset(-Math.PI, 40)).toBeCloseTo(-20, 12);
    expect(crestOffset(0, 30)).toBe(0);
  });
});

describe("the baked cross-section", () => {
  const profile = lipProfile();
  const at = (p: number, v: number): { across: number; up: number } => {
    const out = { across: 0, up: 0 };
    profileAt(profile, p, v, out);
    return out;
  };

  it("holds eight keyframes of twenty-four vertices, four floats each, the throw on the fifth", () => {
    expect([LIP_KEYFRAMES, LIP_PROFILE_VERTS, LIP_SLOTS, LIP_COLUMNS]).toEqual([8, 24, 2, 512]);
    expect(profile).toHaveLength(768);
    expect([lipKey(0), lipKey(0.15), lipKey(0.3), lipKey(0.6), lipKey(0.8), lipKey(1), lipKey(2), lipKey(-1)]).toEqual([0, 1, 2, 4, 5.5, 7, 7, 0]);
    // a fresh copy each call, for its texture
    expect(lipProfile()).not.toBe(profile);
  });

  it("stands both feet on the sea's surface at every keyframe, with unit tangents", () => {
    for (let k = 0; k < LIP_KEYFRAMES; k++) {
      const row = (k * LIP_PROFILE_VERTS) * 4;
      expect(profile[row], `back foot ${k}`).toBeCloseTo(-1.6, 6);
      expect(profile[row + 1], `back foot ${k}`).toBe(0);
      expect(profile[row + 23 * 4 + 1], `trough foot ${k}`).toBe(0);
      for (let v = 0; v < LIP_PROFILE_VERTS; v++) {
        const o = row + v * 4;
        expect(Math.hypot(profile[o + 2] as number, profile[o + 3] as number), `tangent ${k} ${v}`).toBeCloseTo(1, 2);
        expect(profile[o + 1] as number, `up ${k} ${v}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("is a steep face with no overhang at progress 0", () => {
    let back = 0;
    for (let v = 1; v < LIP_PROFILE_VERTS; v++) if (at(0, v).across < at(0, v - 1).across) back++;
    expect(back).toBe(0);
    expect(at(0, 6).across).toBe(0);
    expect(at(0, 6).up).toBeCloseTo(0.1, 6);
  });

  it("throws the lip ahead of the crest by the throw, 1.4 times the wave's speed, the tube 2.55 times longer than wide", () => {
    const crest = at(0.6, 6);
    const tip = at(0.6, 16);
    expect(crest.across).toBeCloseTo(0.12, 6);
    expect(tip.across).toBeCloseTo(0.832, 6);
    expect(tip.across).toBeGreaterThan(crest.across);
    // an overhang: a vertex further on along the section lies behind the tip
    expect(at(0.6, 19).across).toBeLessThan(tip.across);
    // the lip's gain on the crest from 0.3 to the throw, within 1.3 to 1.5 times the wave's speed
    const gain = tip.across - at(0.3, 16).across;
    expect(gain).toBeCloseTo(0.532, 6);
    expect(gain).toBeGreaterThanOrEqual((LIP_SPEED_MIN - 1) * LIP_CREST_TRAVEL);
    expect(gain).toBeLessThanOrEqual((LIP_SPEED_MAX - 1) * LIP_CREST_TRAVEL);
    // the tube: from the face (vertex 21) to the tip, under the roof (vertex 19)
    const length = tip.across - at(0.6, 21).across;
    const width = at(0.6, 19).up;
    expect(length).toBeCloseTo(0.752, 6);
    expect(width).toBeCloseTo(0.295, 6);
    expect(length / width).toBeCloseTo(LIP_TUBE_RATIO, 2);
  });

  it("reads between keyframes as the strip's vertex stage does, and collapses by 1", () => {
    // progress 0.5: a third of the way from the 0.45 keyframe to the throw
    expect(at(0.5, 16).across).toBeCloseTo(0.6506667, 6);
    expect(at(0.5, 16).up).toBeCloseTo(0.3866667, 6);
    expect(at(1, 6).up).toBeCloseTo(0.09, 6);
    let tallest = 0;
    for (let v = 0; v < LIP_PROFILE_VERTS; v++) tallest = Math.max(tallest, at(1, v).up);
    expect(tallest).toBeCloseTo(0.09, 6);
  });
});

describe("the lip tracker", () => {
  it("fills slots on the face with a crest in mid-plunge, never one crest in two slots, freeing each at the collapse", () => {
    const field = oceanFieldFor(SEED);
    const cove = coveOf(SEED, field);
    const tracker = new LipTracker(field, cove);
    const phases = new Float32Array(12);
    let live = 0;
    let wrong = 0;
    let twice = 0;
    let collapsed = 0;
    let plunges = 0;
    let badPlunges = 0;
    let outside = 0;
    const lastP = new Float32Array(LIP_COLUMNS * LIP_SLOTS);
    for (let k = 0; k <= 1200; k++) {
      const t = k / 20;
      tracker.update(t, swellPhases(field, t, phases), 0);
      const data = tracker.state.data;
      for (let i = 0; i < LIP_COLUMNS; i++) {
        const inCove = Math.abs(i - LIP_COLUMNS / 2) <= cove.halfWidth + 30;
        const slots = [slotAt(data, 0, i), slotAt(data, 1, i)];
        for (let s = 0; s < LIP_SLOTS; s++) {
          const [d, p, h, share] = slots[s] as [number, number, number, number];
          if (p === 0) {
            if (d !== 0 || h !== 0 || share !== 0) wrong++;
            // freed from mid-plunge near the collapse
            if ((lastP[s * LIP_COLUMNS + i] as number) > 0.9) collapsed++;
          } else {
            live++;
            if (!inCove) outside++;
            if (!(p > 0 && p < 1) || d < cove.toeD || d > 0 || !(h > 0) || !(share > 0 && share <= 1)) wrong++;
          }
          lastP[s * LIP_COLUMNS + i] = p;
        }
        const [a, b] = slots as [number[], number[]];
        if ((a[1] as number) > 0 && (b[1] as number) > 0 && Math.abs((a[0] as number) - (b[0] as number)) < 5) twice++;
      }
      plunges += tracker.plunges.count;
      for (let e = 0; e < tracker.plunges.count; e++) {
        const d = tracker.plunges.d[e] as number;
        const z = tracker.plunges.z[e] as number;
        if (d < cove.toeD || d > 0 || !((tracker.plunges.height[e] as number) > 0) || Math.abs(z - cove.z0) > cove.halfWidth + 40) badPlunges++;
      }
    }
    expect(live).toBeGreaterThan(10_000);
    expect(wrong).toBe(0);
    expect(outside).toBe(0);
    expect(twice).toBe(0);
    expect(collapsed).toBeGreaterThan(100);
    expect(plunges).toBeGreaterThan(50);
    expect(badPlunges).toBe(0);
  }, timeLimit(60_000));

  it("puts each slot's crest where the swell's sum has its crest, at the progress the sum gives there", () => {
    const field = oceanFieldFor(SEED);
    const cove = coveOf(SEED, field);
    const tracker = new LipTracker(field, cove);
    const phases = new Float32Array(12);
    const phaseErrors: number[] = [];
    const progressErrors: number[] = [];
    for (let k = 0; k < 1200; k++) {
      const t = k / 20;
      tracker.update(t, swellPhases(field, t, phases), 0);
      if (k % 20 !== 0) continue;
      for (let i = 0; i < LIP_COLUMNS; i += 7) {
        for (let s = 0; s < LIP_SLOTS; s++) {
          const [d, p] = slotAt(tracker.state.data, s, i) as [number, number];
          if (!(p > 0)) continue;
          const z = cove.z0 - LIP_COLUMNS / 2 + i;
          const truth = swellAt(field, phases, coastRead(field.tables, z)[0] + d, z);
          phaseErrors.push(Math.abs(truth.crestPhase));
          progressErrors.push(Math.abs(progressOf(truth.ratio) - p));
        }
      }
    }
    phaseErrors.sort((a, b) => a - b);
    progressErrors.sort((a, b) => a - b);
    const p95 = (sorted: number[]): number => sorted[Math.floor(sorted.length * 0.95)] as number;
    expect(phaseErrors.length).toBeGreaterThan(200);
    // within a twentieth of a radian of the crest, about 0.3 m of a 38 m wave, for nineteen in twenty
    expect(p95(phaseErrors)).toBeLessThan(0.05);
    expect(p95(progressErrors)).toBeLessThan(0.1);
  }, timeLimit(60_000));

  it("holds two crests in one column at once under a short swell, apart by more than the lip's reach", () => {
    // Tp 6 s: about 10 m between crests on the face, two of them plunging at once.
    const field = oceanFieldFromState(SEED, { hs: 1.2, tp: 6, dirFromDeg: 270, gamma: 3.3, spread: 25 });
    const tracker = new LipTracker(field, coveOf(SEED, field));
    const phases = new Float32Array(12);
    let both = 0;
    let closest = Number.POSITIVE_INFINITY;
    for (let k = 0; k <= 600; k++) {
      const t = k / 20;
      tracker.update(t, swellPhases(field, t, phases), 0);
      for (let i = 0; i < LIP_COLUMNS; i++) {
        const a = slotAt(tracker.state.data, 0, i);
        const b = slotAt(tracker.state.data, 1, i);
        if ((a[1] as number) > 0 && (b[1] as number) > 0) {
          both++;
          closest = Math.min(closest, Math.abs((a[0] as number) - (b[0] as number)));
        }
      }
    }
    expect(both).toBeGreaterThan(100);
    expect(closest).toBeGreaterThan(5);
  }, timeLimit(60_000));

  it("frees every slot and reports no plunge under a full onshore wind, a short swell's spill, or a time that is not finite", () => {
    const field = oceanFieldFor(SEED);
    const tracker = new LipTracker(field, coveOf(SEED, field));
    const phases = new Float32Array(12);
    const liveCount = (): number => {
      let n = 0;
      for (let i = 0; i < LIP_COLUMNS * LIP_SLOTS; i++) if ((tracker.state.data[i * 4 + 1] as number) > 0) n++;
      return n;
    };
    let plunges = 0;
    let live = 0;
    for (let k = 0; k <= 400; k++) {
      const t = k / 20;
      tracker.update(t, swellPhases(field, t, phases), 1);
      plunges += tracker.plunges.count;
      live += liveCount();
    }
    expect([live, plunges]).toEqual([0, 0]);
    // a held swell: slots live, then a time that is not finite frees them all
    for (let k = 0; k <= 200 && liveCount() === 0; k++) tracker.update(k / 20, swellPhases(field, k / 20, phases), 0);
    expect(liveCount()).toBeGreaterThan(0);
    tracker.update(Number.NaN, phases, 0);
    expect([liveCount(), tracker.plunges.count]).toEqual([0, 0]);
    // Tp 4 s on the face: Iribarren 0.38, under the plunge's onset, so it spills
    const short = oceanFieldFromState(SEED, { hs: 1.2, tp: 4, dirFromDeg: 270, gamma: 3.3, spread: 25 });
    const spill = new LipTracker(short, coveOf(SEED, short));
    let spilled = 0;
    for (let k = 0; k <= 200; k++) {
      spill.update(k / 20, swellPhases(short, k / 20, phases), 0);
      for (let i = 0; i < LIP_COLUMNS * LIP_SLOTS; i++) if ((spill.state.data[i * 4 + 1] as number) > 0) spilled++;
      spilled += spill.plunges.count;
    }
    expect(spilled).toBe(0);
  }, timeLimit(60_000));

  it("reports no plunge across a step over a second, or a clock run back, and still reports them at a second's steps", () => {
    const field = oceanFieldFor(SEED);
    const cove = coveOf(SEED, field);
    const phases = new Float32Array(12);
    const plungesAt = (stride: number, from: number, to: number): number => {
      const tracker = new LipTracker(field, cove);
      let n = 0;
      for (let t = from; t <= to; t += stride) {
        tracker.update(t, swellPhases(field, t, phases), 0);
        n += tracker.plunges.count;
      }
      return n;
    };
    expect(LIP_STEP_MAX_S).toBe(1);
    // a stalled page's two-second frames see crests collapse and report none
    expect(plungesAt(2, 0, 600)).toBe(0);
    // frames a second apart still see them
    expect(plungesAt(1, 0, 600)).toBeGreaterThan(10);
    // a clock run back from a held swell, then forward again by a step in range, reports none on the way
    const tracker = new LipTracker(field, cove);
    for (let t = 100; t <= 140; t += 0.25) tracker.update(t, swellPhases(field, t, phases), 0);
    tracker.update(60, swellPhases(field, 60, phases), 0);
    expect(tracker.plunges.count).toBe(0);
  }, timeLimit(60_000));

  it("refills the same arrays every update: nothing made after construction", () => {
    const field = oceanFieldFor(SEED);
    const tracker = new LipTracker(field, coveOf(SEED, field));
    const phases = new Float32Array(12);
    const state = tracker.state;
    const data = state.data;
    const plunges = tracker.plunges;
    const arrays = [plunges.d, plunges.z, plunges.height];
    for (let k = 0; k < 600; k++) tracker.update(k / 20, swellPhases(field, k / 20, phases), 0);
    expect(tracker.state).toBe(state);
    expect(tracker.state.data).toBe(data);
    expect(tracker.plunges).toBe(plunges);
    for (let j = 0; j < 3; j++) expect([plunges.d, plunges.z, plunges.height][j]).toBe(arrays[j]);
    expect(data).toHaveLength(LIP_COLUMNS * LIP_SLOTS * 4);
    expect(plunges.d).toHaveLength(LIP_PLUNGES);
  }, timeLimit(60_000));

  it("costs under 0.3 ms an update on average over 600 updates of the widest cove", { tags: ["wall-clock"], timeout: timeLimit(20_000) }, () => {
    const field = oceanFieldFor(SEED);
    const tracker = new LipTracker(field, { ...coveOf(SEED, field), halfWidth: 180 });
    const phases = new Float32Array(12);
    // Warm the update first.
    for (let k = 0; k < 600; k++) tracker.update(k / 20, swellPhases(field, k / 20, phases), 0);
    let spent = 0;
    for (let k = 600; k < 1200; k++) {
      swellPhases(field, k / 20, phases);
      const t0 = performance.now();
      tracker.update(k / 20, phases, 0);
      spent += performance.now() - t0;
    }
    expect(spent / 600).toBeLessThan(0.3);
  });
});
