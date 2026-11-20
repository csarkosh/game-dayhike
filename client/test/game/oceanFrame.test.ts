import { describe, expect, it } from "vitest";
import "@csarkosh/engine/sim/olympic";
import { coveFor } from "@csarkosh/engine/sim/olympic";
import { setActiveTerrainVariant } from "@csarkosh/engine/sim/terrain";
import { OCEAN_NO_TIP, createOceanFrame, oceanComponentsFor, oceanTipsFor, type WindSeaDrawn } from "../../src/game/oceanFrame.js";
import { SWELL_COMPONENTS, SWELL_COMPONENTS_LOW } from "@csarkosh/engine/game/oceanSwell";
import { OCEAN_COAST_RECENTRE, OCEAN_COAST_STEP, coastProfilesFor } from "@csarkosh/engine/game/oceanTables";
import { oceanFieldFor, swellPhases } from "@csarkosh/engine/game/oceanWaves";
import { windSeaAtSpeed, windSeaStateFor, type WindSeaState } from "../../src/game/oceanWindSea.js";
import { seedFromToken } from "@csarkosh/engine/game/seed";

setActiveTerrainVariant("olympic");
const SEED = seedFromToken("atmo");

/** A wind sea whose field is not drawn, the sea at its wind's own speed. */
const undrawn = (blowing: WindSeaState): WindSeaDrawn => ({ sea: blowing, mode: 0, loopTime: 0, stats: [0, 0, 0, 0] });

describe("the sea's waves as numbers", () => {
  it("draws the eight largest components of the swell on low and all twelve above, from the field it is handed", () => {
    expect(createOceanFrame(SEED, "low").field.count).toBe(SWELL_COMPONENTS_LOW);
    expect(createOceanFrame(SEED, "medium").field.count).toBe(SWELL_COMPONENTS);
    const made = oceanFieldFor(SEED, SWELL_COMPONENTS);
    expect(createOceanFrame(SEED, "low", made).field).toBe(made);
  });

  it("holds the world's own numbers from the start: the swell, the tips, the components, the row's place and the wind sea's pivot", () => {
    const frame = createOceanFrame(SEED, "low");
    const { field, numbers } = frame;
    expect(numbers.swell).toEqual([field.travel[0], field.travel[1], field.tp, field.hs]);
    expect(numbers.tips).toEqual(oceanTipsFor(field.tips));
    expect(numbers.components).toEqual(oceanComponentsFor(field.components));
    expect(numbers.coast).toEqual([field.tables.coastOriginZ, OCEAN_COAST_STEP, SWELL_COMPONENTS_LOW, 0]);
    const cove = coveFor(SEED);
    expect(numbers.windPivot).toEqual([coastProfilesFor(SEED).coastlineX(cove.z0), cove.z0, 0, 0]);
    expect(numbers.phases).toEqual(new Float32Array(12));
  });

  it("writes an absent headland's tip far inland", () => {
    expect(oceanTipsFor([])).toEqual([OCEAN_NO_TIP, 0, OCEAN_NO_TIP, 0]);
    expect(oceanTipsFor([[-400, 180]])).toEqual([-400, 180, OCEAN_NO_TIP, 0]);
  });

  it("steps the phases on the shared seconds and the wind sea from the wind as it blows and as the sea follows it", () => {
    const frame = createOceanFrame(SEED, "medium");
    const { numbers, field } = frame;
    let handed: WindSeaState | null = null;
    const moved = frame.update(coveFor(SEED).z0, 123.5, 0.6, [0.6, 0.8], 15, (blowing) => {
      handed = blowing;
      return { sea: windSeaAtSpeed(blowing, 3), mode: 1, loopTime: 7.25, stats: [0.4, 0.02, 0, 0] };
    });
    expect(moved).toBe(false);
    expect(numbers.phases).toEqual(swellPhases(field, 123.5));
    const blowing = windSeaStateFor(0.6, [0.6, 0.8], 15);
    expect(handed).toEqual(blowing);
    const sea = windSeaAtSpeed(blowing, 3);
    // The height, the loop's scale and the whitecaps are the sea's, at the speed it follows; the direction, the speed
    // and the onshore weight the wind's as it blows now.
    expect(numbers.wind).toEqual([sea.hs, sea.loopScale, 7.25, sea.coverage]);
    expect(numbers.windDir).toEqual([blowing.dir[0], blowing.dir[1], blowing.u10, blowing.onshoreWeight]);
    expect(numbers.windStats).toEqual([0.4, 0.02, 0, 0]);
    expect(numbers.coast[3]).toBe(1);
  });

  it("writes the coastline's row again once the camera is a kilometre along the coast, and says so", () => {
    const frame = createOceanFrame(SEED, "low");
    const z0 = coveFor(SEED).z0;
    const row = frame.field.tables.data.slice();
    expect(frame.update(z0 + OCEAN_COAST_RECENTRE - 1, 0, 0, [1, 0], 12, undrawn)).toBe(false);
    expect(frame.field.tables.data).toEqual(row);
    const origin = frame.numbers.coast[0];
    expect(frame.update(z0 + OCEAN_COAST_RECENTRE + 1, 0, 0, [1, 0], 12, undrawn)).toBe(true);
    expect(frame.numbers.coast[0]).toBe(frame.field.tables.coastOriginZ);
    expect(frame.numbers.coast[0]).not.toBe(origin);
    expect(frame.field.tables.data).not.toEqual(row);
    // Where it now stands it is not written again.
    expect(frame.update(z0 + OCEAN_COAST_RECENTRE + 2, 0, 0, [1, 0], 12, undrawn)).toBe(false);
  });
});
