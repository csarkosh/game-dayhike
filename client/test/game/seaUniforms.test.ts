import { describe, expect, it } from "vitest";
import "@csarkosh/engine/sim/olympic";
import { setActiveTerrainVariant } from "@csarkosh/engine/sim/terrain";
import { createOceanFrame } from "@csarkosh/engine/game/oceanFrame";
import { SEA_RING_FLOATS } from "@csarkosh/engine/game/seaLattice";
import { seedFromToken } from "@csarkosh/engine/game/seed";
import { SEA_COMPONENT_VECS, emptySeaFrameUniforms, emptySeaUniforms, seaFrameUniforms, seaUniforms } from "@csarkosh/engine/game/seaUniforms";
import { WATER_RING_COUNT } from "@csarkosh/engine/game/water";
import { WATER_ROWS, waterSkinOffset } from "@csarkosh/engine/game/waterShading";
import { advanceWater, createBumpDrift, createWaterSurface, setWaterCove, setWaterWind } from "@csarkosh/engine/game/waterSurface";

setActiveTerrainVariant("olympic");
const SEED = seedFromToken("atmo");
const f32 = (list: ArrayLike<number>): number[] => [...Float32Array.from(list)];

describe("the sea's uniforms by name", () => {
  it("fills the world's own from the surface and the swell, and says whether any moved", () => {
    const ocean = createOceanFrame(SEED, "low");
    const surface = createWaterSurface(WATER_ROWS.sea);
    surface.skin = [0, waterSkinOffset(SEED)];
    surface.bedTexels = 128;
    surface.bedSpacing = 2;
    surface.bedOrigin = [-512, 64];
    setWaterCove(surface, 0, 179.4, -24, 1 / 12);
    const out = emptySeaUniforms();
    expect(seaUniforms(surface, 0.5, ocean.numbers, out)).toBe(true);
    expect([...out.waterLevel]).toEqual([0.5]);
    expect([...out.waterKd]).toEqual(f32(WATER_ROWS.sea.kd));
    expect([...out.waterBed]).toEqual(f32([-512, 64, 1 / 256, 2]));
    expect([...out.waterBedTexels]).toEqual([128]);
    expect([...out.waterSkin]).toEqual(f32([0, waterSkinOffset(SEED)]));
    expect([...out.oceanSwell]).toEqual(f32(ocean.numbers.swell));
    expect([...out.oceanTips]).toEqual(f32(ocean.numbers.tips));
    expect([...out.oceanWindPivot]).toEqual(f32(ocean.numbers.windPivot));
    expect([...out.oceanCove]).toEqual(f32([0, 179.4, -24, 1 / 12]));
    expect(out.oceanK.length).toBe(SEA_COMPONENT_VECS * 4);
    expect([...out.oceanK]).toEqual([...ocean.numbers.components]);
    // As it stands it is not written again; the bed's square moving is what moves it.
    expect(seaUniforms(surface, 0.5, ocean.numbers, out)).toBe(false);
    surface.bedOrigin = [-448, 64];
    expect(seaUniforms(surface, 0.5, ocean.numbers, out)).toBe(true);
    expect(out.waterBed[0]).toBe(-448);
  });

  it("fills what moves with the frame: the phases, the wind sea's numbers, the clock, the wind's direction over the run and the bump's drift", () => {
    const ocean = createOceanFrame(SEED, "low");
    const surface = createWaterSurface(WATER_ROWS.sea);
    setWaterWind(surface, 0.5, [0.6, 0.8]);
    advanceWater(surface, 100, true);
    advanceWater(surface, 102, true);
    ocean.update(0, 102, 0.5, [0.6, 0.8], 15, (blowing) => ({ sea: blowing, mode: 0, loopTime: 0, stats: [0, 0, 0, 0] }));
    const drift = createBumpDrift();
    drift.step(2, 0.5, [0.6, 0.8], true, false);
    const out = emptySeaFrameUniforms();
    expect(out.seaRings.length).toBe(WATER_RING_COUNT * SEA_RING_FLOATS);
    out.seaRings.fill(7);
    seaFrameUniforms(ocean.numbers, surface, drift, out);
    expect([...out.oceanPhase0, ...out.oceanPhase1, ...out.oceanPhase2]).toEqual([...ocean.numbers.phases]);
    expect([...out.oceanCoast]).toEqual(f32(ocean.numbers.coast));
    expect([...out.oceanWind]).toEqual(f32(ocean.numbers.wind));
    expect([...out.oceanWindDir]).toEqual(f32(ocean.numbers.windDir));
    expect([...out.oceanWindStats]).toEqual([0, 0, 0, 0]);
    expect([...out.seaTime]).toEqual([102]);
    // On the sea the wind's direction alone is integrated, whatever its speed.
    expect([...out.seaWindTime]).toEqual(f32([1.2, 1.6]));
    expect([...out.seaBumpOffset]).toEqual(f32(drift.sea));
    expect(out.seaBumpOffset[0]).toBeGreaterThan(0);
    // The rings' records are whoever moves the rings' to write.
    expect([...out.seaRings]).toEqual(new Array(28).fill(7));
  });
});
