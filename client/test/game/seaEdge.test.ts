import { describe, expect, it } from "vitest";
import "@csarkosh/engine/sim/olympic";
import { COVE_FACE_GRADE, COVE_TOE_DEPTH, coveFor } from "@csarkosh/engine/sim/olympic";
import { setActiveTerrainVariant } from "@csarkosh/engine/sim/terrain";
import { LipTracker } from "@csarkosh/engine/game/oceanBreaker";
import { SWELL_COMPONENTS } from "@csarkosh/engine/game/oceanSwell";
import { coastProfilesFor } from "@csarkosh/engine/game/oceanTables";
import { oceanFieldFor, swellPhases } from "@csarkosh/engine/game/oceanWaves";
import { createSeaEdgeStep, swashCoveFor } from "@csarkosh/engine/game/seaEdge";
import { seedFromToken } from "@csarkosh/engine/game/seed";
import { SwashTable } from "@csarkosh/engine/game/swashTable";

setActiveTerrainVariant("olympic");
const SEED = seedFromToken("atmo");

describe("the sea's edge on the cove", () => {
  it("reads the cove as the simulation lays it: its centre and half-width, the face's toe and grade, the coastline's x", () => {
    const cove = swashCoveFor(SEED);
    const laid = coveFor(SEED);
    expect(cove.z0).toBe(laid.z0);
    expect(cove.halfWidth).toBe(laid.halfWidth);
    expect(cove.toeD).toBe(-COVE_TOE_DEPTH / COVE_FACE_GRADE);
    expect(cove.faceGrade).toBe(COVE_FACE_GRADE);
    const profiles = coastProfilesFor(SEED);
    for (const z of [-200, 0, 37.5, 180]) expect(cove.coastX(z)).toBe(profiles.coastlineX(z));
  });

  it("steps the swash's table and the breaker's tracker on the swell's phases at the shared seconds, as stepping each by hand does", () => {
    const field = oceanFieldFor(SEED);
    const edge = createSeaEdgeStep(SEED, field);
    expect(edge.filled).toBe(false);
    const cove = swashCoveFor(SEED);
    const table = new SwashTable(field, cove);
    const tracker = new LipTracker(field, cove);
    const phases = new Float32Array(SWELL_COMPONENTS);
    let plunges = 0;
    for (let frame = 0; frame < 240; frame++) {
      const seconds = 500 + frame / 30;
      edge.step(seconds, 0.25);
      swellPhases(field, seconds, phases);
      table.update(seconds, phases);
      tracker.update(seconds, phases, 0.25);
      expect(edge.tracker.plunges.count).toBe(tracker.plunges.count);
      plunges += tracker.plunges.count;
    }
    expect(edge.filled).toBe(true);
    expect(edge.table.data).toEqual(table.data);
    expect([...edge.table.data].some((v) => v !== 0)).toBe(true);
    expect([...edge.tracker.plunges.d.subarray(0, 4)]).toEqual([...tracker.plunges.d.subarray(0, 4)]);
    expect(plunges).toBeGreaterThanOrEqual(0);
  });
});
