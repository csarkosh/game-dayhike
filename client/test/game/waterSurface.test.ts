import { describe, expect, it } from "vitest";
import { WATER_ROWS, lakeWaterRow, roughnessFor } from "../../src/game/waterShading.js";
import {
  LAKE_BUMP_DRIFT, WATER_ROUGHNESS_STEP, advanceWater, createBumpDrift, createWaterSurface, emptyLakeUniforms, emptyWaterFrameUniforms,
  lakeUniforms, setWaterCalm, setWaterCove, setWaterLakeBody, setWaterLakeTime, setWaterMirrorMotion, setWaterPawCover, setWaterShade, setWaterWind,
  waterFrameUniforms, waterRoughnessDue,
} from "../../src/game/waterSurface.js";
import { MIRROR_OFFSET_K } from "../../src/game/mirrorView.js";
import { emptyLakeMirrorUniforms, lakeMirrorUniforms } from "../../src/game/waterSurface.js";
import { WIND_TIME_WRAP } from "../../src/game/windParams.js";

describe("a water surface's numbers, kept with no engine", () => {
  it("starts at rest: no wind, no rain, a lake rough all over, an identity for its mirror", () => {
    const s = createWaterSurface(WATER_ROWS.sea);
    expect(s.row).toBe(WATER_ROWS.sea);
    expect([s.time, s.windSpeed, s.rain, s.sun, s.lakeTime, s.calmShare, s.mirrorWeight]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(s.pawCover).toBe(1);
    expect(s.octaves).toBe(2);
    expect([...s.mirrorViewProjection]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it("integrates the wind's velocity on a lake and its direction alone on the sea, from the second step on", () => {
    const lake = createWaterSurface(lakeWaterRow(0.5));
    const sea = createWaterSurface(WATER_ROWS.sea);
    for (const s of [lake, sea]) setWaterWind(s, 0.5, [0.6, 0.8]);
    advanceWater(lake, 10, false);
    advanceWater(sea, 10, true);
    expect(lake.windTime).toEqual([0, 0]);
    expect(sea.windTime).toEqual([0, 0]);
    advanceWater(lake, 12, false);
    advanceWater(sea, 12, true);
    expect(lake.windTime).toEqual([0.6 * 0.5 * 2, 0.8 * 0.5 * 2]);
    expect(sea.windTime).toEqual([0.6 * 2, 0.8 * 2]);
    expect([lake.time, sea.time]).toEqual([12, 12]);
    // A clock that runs back adds nothing.
    advanceWater(lake, 11, false);
    expect(lake.windTime).toEqual([0.6 * 0.5 * 2, 0.8 * 0.5 * 2]);
    expect(lake.time).toBe(11);
  });

  it("wraps the lake's time as the wind's, and clamps what a frame hands it", () => {
    const s = createWaterSurface(lakeWaterRow(0));
    setWaterLakeTime(s, WIND_TIME_WRAP * 3 + 7.5);
    expect(s.lakeTime).toBeCloseTo(7.5, 9);
    setWaterLakeTime(s, Number.NaN);
    expect(s.lakeTime).toBe(0);
    setWaterPawCover(s, 1.4);
    expect(s.pawCover).toBe(1);
    setWaterPawCover(s, Number.NaN);
    expect(s.pawCover).toBe(0);
    setWaterCalm(s, 1.2, -0.1, -4);
    expect([s.calmShare, s.mirrorWeight, s.mirrorSmearPx]).toEqual([1, 0, 0]);
    setWaterCalm(s, Number.NaN, Number.POSITIVE_INFINITY, Number.NaN);
    expect([s.calmShare, s.mirrorWeight, s.mirrorSmearPx]).toEqual([0, 0, 0]);
    setWaterMirrorMotion(s, -1);
    expect(s.mirrorMotion).toBe(0);
    setWaterCove(s, 1, 2, 3, Number.NaN);
    expect(s.cove).toEqual([0, 0, 0, 0]);
    setWaterCove(s, 1, 2, 3, 4);
    expect(s.cove).toEqual([1, 2, 3, 4]);
  });

  it("asks for a new roughness only past a step from the wind's", () => {
    const s = createWaterSurface(lakeWaterRow(0));
    const r = roughnessFor(0.4, s.row.shelter);
    expect(waterRoughnessDue(s, null, 0.4)).toBe(r);
    expect(waterRoughnessDue(s, r, 0.4)).toBeNull();
    expect(waterRoughnessDue(s, r + WATER_ROUGHNESS_STEP / 2, 0.4)).toBeNull();
    expect(waterRoughnessDue(s, r + WATER_ROUGHNESS_STEP * 2, 0.4)).toBe(r);
  });

  it("fills a lake's own uniforms by the names its shader reads, and says when one moved", () => {
    const s = createWaterSurface(lakeWaterRow(0.5));
    s.bedOrigin = [-64, 128];
    s.bedTexels = 128;
    s.bedSpacing = 2;
    s.octaves = 1;
    s.skin = [0.4, 17];
    setWaterPawCover(s, 0.25);
    setWaterCalm(s, 0.75, 1, 0);
    setWaterLakeBody(s, 10, 55, -20, 40);
    setWaterShade(s, [0.1, 0.2, 0.3]);
    const out = emptyLakeUniforms();
    expect(lakeUniforms(s, 55, { panorama: false, skyline: true }, out)).toBe(true);
    expect(out.waterLevel[0]).toBe(55);
    expect([...out.waterKd]).toEqual([...new Float32Array(s.row.kd)]);
    expect([...out.waterBed]).toEqual([-64, 128, 1 / 256, 2]);
    expect(out.waterBedTexels[0]).toBe(128);
    expect(out.waterOctaves[0]).toBe(1);
    expect([...out.waterSkin]).toEqual([Math.fround(0.4), 17]);
    expect([out.waterPawCover[0], out.waterCalmShare[0], out.waterMirrorWeight[0]]).toEqual([0.25, 0.75, 1]);
    expect([...out.waterLakeCentre]).toEqual([10, 55, -20]);
    expect(out.waterLakeRadius[0]).toBe(40);
    expect([...out.waterShadeColour]).toEqual([...new Float32Array([0.1, 0.2, 0.3])]);
    expect([out.waterPanoramaOn[0], out.waterSkylineOn[0]]).toEqual([0, 1]);
    // Unmoved, it says so; one value moved, it says that.
    expect(lakeUniforms(s, 55, { panorama: false, skyline: true }, out)).toBe(false);
    setWaterPawCover(s, 0.5);
    expect(lakeUniforms(s, 55, { panorama: false, skyline: true }, out)).toBe(true);
    expect(lakeUniforms(s, 55, { panorama: true, skyline: true }, out)).toBe(true);
    expect(out.waterPanoramaOn[0]).toBe(1);
  });

  it("drifts the sea's bump at a fixed rate and the lakes' upwind at the wind's speed", () => {
    expect(LAKE_BUMP_DRIFT).toBe(Math.hypot(0.015, 0.011));
    const drift = createBumpDrift();
    drift.step(2, 0.5, [0.6, 0.8], true, true);
    expect(drift.sea).toEqual([0.015 * 2, 0.011 * 2]);
    expect(drift.lake).toEqual([-(0.6 * 0.5 * LAKE_BUMP_DRIFT * 2), -(0.8 * 0.5 * LAKE_BUMP_DRIFT * 2)]);
    const before = [...drift.sea];
    drift.step(1, 1, [1, 0], false, false);
    expect(drift.sea).toEqual(before);
  });

  it("fills what every lake reads alike from one lake's surface and the bump's drift", () => {
    const s = createWaterSurface(lakeWaterRow(0));
    setWaterWind(s, 0.5, [0.6, 0.8]);
    advanceWater(s, 0, false);
    advanceWater(s, 4, false);
    setWaterLakeTime(s, 33);
    s.rain = 0.7;
    s.sun = 0.4;
    const drift = createBumpDrift();
    drift.step(4, 0.5, [0.6, 0.8], false, true);
    const out = waterFrameUniforms(s, drift, emptyWaterFrameUniforms());
    expect(out.waterLakeTime[0]).toBe(33);
    expect([...out.waterWind]).toEqual([...new Float32Array([0.6, 0.8])]);
    expect([...out.waterWindTime]).toEqual([...new Float32Array([1.2, 1.6])]);
    expect([out.waterRain[0], out.waterSun[0]]).toEqual([Math.fround(0.7), Math.fround(0.4)]);
    expect([...out.waterBumpOffset]).toEqual([...new Float32Array(drift.lake)]);
  });

  it("fills a lake's mirror's uniforms from its surface, and says whether any moved", () => {
    const surface = createWaterSurface(lakeWaterRow(0.5));
    const out = emptyLakeMirrorUniforms();
    expect(Object.keys(out)).toEqual(["waterMirrorVP", "waterMirrorOn", "waterMirrorK", "waterMirrorSmearPx", "waterMirrorMotion"]);
    expect(out.waterMirrorVP).toHaveLength(16);
    // At rest: no read, the identity, the ripple's reach.
    expect(lakeMirrorUniforms(surface, false, out)).toBe(false);
    expect([...out.waterMirrorK]).toEqual([Math.fround(MIRROR_OFFSET_K)]);
    surface.mirrorViewProjection.set([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 1, 5, 6, 7, 0]);
    setWaterCalm(surface, 0.5, 1, 12);
    setWaterMirrorMotion(surface, 40);
    expect(lakeMirrorUniforms(surface, true, out)).toBe(true);
    expect([...out.waterMirrorVP]).toEqual([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 1, 5, 6, 7, 0]);
    expect([out.waterMirrorOn[0], out.waterMirrorSmearPx[0], out.waterMirrorMotion[0]]).toEqual([1, 12, 40]);
    expect(lakeMirrorUniforms(surface, true, out)).toBe(false);
    expect(lakeMirrorUniforms(surface, false, out)).toBe(true);
    expect(out.waterMirrorOn[0]).toBe(0);
  });
});
