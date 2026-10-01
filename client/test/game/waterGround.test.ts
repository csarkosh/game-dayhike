import { describe, expect, it } from "vitest";
import "../../src/sim/olympic.js";
import { activeTerrainVariant, elevationAt } from "../../src/sim/terrain.js";
import { lobePoints, marshWeightAt } from "../../src/sim/features.js";
import { TRAIL_Z_ANCHOR } from "../../src/sim/bowl.js";
import { firstPondWorld, lakeOf } from "../sim/helpers/lakes.js";
import { NO_WATER_GROUND, waterGroundAt } from "../../src/game/waterGround.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("waterGroundAt", { timeout: timeLimit(120_000) }, () => {
  it("is nothing far from every lake and the cove", () => {
    const { seed, pond } = firstPondWorld();
    const x = pond.x + 400, z = pond.z + 400;
    expect(waterGroundAt(seed, x, z, elevationAt(seed, x, z))).toBe(NO_WATER_GROUND);
  });

  it("is the whole bed, with the lake's murk, in a lake's middle", () => {
    const { seed, pond } = firstPondWorld();
    const g = waterGroundAt(seed, pond.x, pond.z, elevationAt(seed, pond.x, pond.z));
    expect(g.bed).toBe(1);
    expect(g.murk).toBe(lakeOf(seed).murk);
    expect(g.cove).toBe(0);
  });

  it("is the marsh in a murky lake's marsh", () => {
    const { seed } = firstPondWorld((f) => (f.murk ?? 0) > 0.7);
    const lake = lakeOf(seed);
    const [x, z] = lobePoints(lake, 1).find(([px, pz]) => marshWeightAt(lake, px, pz) === 1)!;
    expect(waterGroundAt(seed, x, z, elevationAt(seed, x, z)).marsh).toBe(1);
  });

  it("is the cove on the beach in front of the pad", () => {
    const v = activeTerrainVariant();
    const seed = 0x5eed;
    const cx = v.roadCenterX!(seed, TRAIL_Z_ANCHOR);
    const x0 = cx - v.coastDistance!(seed, cx, TRAIL_Z_ANCHOR);
    expect(waterGroundAt(seed, x0 + 10, TRAIL_Z_ANCHOR, elevationAt(seed, x0 + 10, TRAIL_Z_ANCHOR)).cove).toBe(1);
  });
});
