import type { PluginUniformBlock } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { COVE_END_BLEND, COVE_FACE_GRADE } from "../../../src/sim/olympic.js";
import { SWASH_FACE_LIFT_M, SWASH_REACH_MAX_M } from "../../../src/game/swashRunUp.js";
import { SWASH_COLUMNS, SWASH_STRIDE } from "../../../src/game/swashTable.js";
import { atmosphereUniforms, emptyAtmosphereUniforms, type AtmosphereRecord } from "../../../src/game/atmosphereParams.js";
import { noCloud } from "../../../src/game/cloudParams.js";
import { FOLIAGE_PLAYERS, setFoliageWind } from "../../../src/game/foliageUniforms.js";
import { FRAME_BLOCK, FRAME_FIELDS, movedWords, stageClocks, writeFrameBlock, type FrameValues } from "../../../src/game/lite/frameBlock.js";
import { emptyMoteUniforms } from "../../../src/game/moteField.js";
import { emptyRainUniforms } from "../../../src/game/rainField.js";
import { emptySplashUniforms } from "../../../src/game/splashField.js";
import { emptyTerrainUniforms, terrainUniforms } from "../../../src/game/terrainUniforms.js";
import { emptySeaFrameUniforms } from "../../../src/game/seaUniforms.js";
import { WET_BAND, WET_COVE_END, WET_DRY_S, WET_NO_COVE, WET_SWASH_VECS, emptyWetUniforms, setWetCove, setWetSwash, setWetWeather, wetUniforms } from "../../../src/game/wetSurface.js";
import { windRecordUnder } from "../../../src/game/windParams.js";
import { WEATHER_PRESETS } from "../../../src/game/weather.js";
import { sourceText } from "../../helpers/source.js";

/** The floats a field of `type` is, and the boundary it sits on, as WGSL lays a uniform struct out. */
function sizeOf(type: string): { floats: number; align: number } {
  const array = /^array<vec4<u32>,(\d+)>$/.exec(type);
  if (array !== null) return { floats: 4 * Number(array[1]), align: 16 };
  if (type === "f32") return { floats: 1, align: 4 };
  if (type === "vec2<f32>") return { floats: 2, align: 8 };
  if (type === "vec3<f32>") return { floats: 3, align: 16 };
  if (type === "vec4<f32>") return { floats: 4, align: 16 };
  if (type === "mat4x4<f32>") return { floats: 16, align: 16 };
  throw new Error(`a field of type ${type}`);
}

/** The block as a stand-in for Lite's: the fields laid out by WGSL's rules, every float a marker until it is written. */
function block(): PluginUniformBlock & { data: Float32Array } {
  const offsets = new Map<string, number>();
  let at = 0;
  for (const field of FRAME_FIELDS) {
    const { floats, align } = sizeOf(field.type);
    at = Math.ceil(at / align) * align;
    offsets.set(field.name, at);
    at += floats * 4;
  }
  return { name: FRAME_BLOCK, visibility: "vertex-fragment", data: new Float32Array(Math.ceil(at / 16) * 4).fill(-99), offsets, buffer: {} as GPUBuffer };
}

const AIR: AtmosphereRecord = {
  baseDensity: 0.0004, heightDensity: 0.004, heightFalloff: 0.05, referenceLevel: -20, gradientScale: 1 / 4000,
  sunDir: { x: 0.6, y: 0, z: 0.8 }, sunColour: { r: 1, g: 0.8, b: 0.6 }, sunWeight: 0.5, sunPower: 8,
  farColour: { r: 0.4, g: 0.5, b: 0.6 },
};
/** A frame's values as the renderer fills them, from the plain modules. */
function frame(): FrameValues {
  const weather = WEATHER_PRESETS.rain;
  setFoliageWind(windRecordUnder(weather, 12.5), Float32Array.from({ length: FOLIAGE_PLAYERS * 3 }, (_, i) => 100 + i));
  setWetWeather(0.6);
  const eye = { x: 12, y: 34, z: -56 };
  const terrain = { ...emptyTerrainUniforms(), terrainAlbedo: [0.2, 0.3, 0.4] };
  terrainUniforms({ eye, wetness: 0.6, rain: 0.8, seconds: 12.5, sward: true, relief: true, road: null, trail: null, features: null }, terrain);
  return {
    air: atmosphereUniforms(AIR, noCloud(), 0, emptyAtmosphereUniforms()),
    wet: wetUniforms({ line: 3, level: 2.5, centre: [10, 20], radius: 400, kd: [0.4, 0.1, 0.05], attenuate: true, cap: 0.7 }, emptyWetUniforms()),
    terrain,
    eye,
    rows: 956,
    wingTime: 123.5,
    water: {
      waterLakeTime: Float32Array.of(41.5), waterWind: Float32Array.of(0.6, 0.8), waterWindTime: Float32Array.of(3, 4), waterRain: Float32Array.of(0.8),
      waterSun: Float32Array.of(0.25), waterBumpOffset: Float32Array.of(-0.5, 0.75),
    },
    exposure: 0.85,
    contrast: 1.1,
    clocks: [
      stageClocks({ ...emptyMoteUniforms(), moteClock: [3.5], moteTravel: [1.25, -2.5] }),
      stageClocks({ ...emptyRainUniforms(), rainFold: [7.75], rainDt: [1 / 40], rainDrift: [0.5, -0.25], rainCanopyWater: [0.6] }),
      stageClocks({ ...emptySplashUniforms(), splashTime: [9.5] }),
    ],
    projection: Float32Array.from({ length: 16 }, (_, i) => 0.5 + i),
    sea: {
      ...emptySeaFrameUniforms(),
      oceanPhase0: Float32Array.of(0.1, 0.2, 0.3, 0.4), oceanCoast: Float32Array.of(-6240, 12, 8, 0), oceanWindDir: Float32Array.of(0.6, 0.8, 7.5, 0.25),
      seaTime: Float32Array.of(123.25), seaWindTime: Float32Array.of(30, -40), seaBumpOffset: Float32Array.of(0.25, 0.5),
      seaRings: Float32Array.from({ length: 28 }, (_, i) => 1000 + i * 0.5),
    },
    smokeTime: 12.5,
    grade: {
      gradeCurveNeutral: [1.02, 0.98, 1.01, 0.9], gradeCurvePositive: [0.01, 0.02, 0.03, 0.04], gradeCurveNegative: [0.05, 0.06, 0.07, 0.08],
      gradeVignette1: [0.39, 0.25, 0, 0], gradeVignette2: [0.01, 0.02, 0.03, -3], gradeScreen: [1 / 980, 1 / 637, 0.5 / 255, 0],
    },
  };
}

describe("the frame's uniform block on Babylon Lite", () => {
  it("packs the swash's table only on a frame whose view holds the sea, where alone the ground can read it", () => {
    // The table is 4 KB of the block, and a wetted column's age runs on every frame.
    expect(WET_SWASH_VECS * 16).toBe(4096);
    const renderer = sourceText("game/lite/renderer.ts");
    expect(renderer).toContain("          if (standing.sea.shown) setWetSwash(edge.table.data);");
    expect(renderer.split("setWetSwash(").length).toBe(2);
    // Under the sea's wet line the ground the swash wets is the cove's face up to the sheet's farthest reach, and the
    // wet line's soft edge over it; the sea's rings count the face that high as their water, over the same span of
    // the shore, so that ground is inside a ring's box of water, and a view that holds it shows the sea.
    expect(SWASH_REACH_MAX_M * COVE_FACE_GRADE + WET_BAND / 2).toBeLessThanOrEqual(SWASH_FACE_LIFT_M);
    expect(WET_COVE_END).toBeLessThanOrEqual(COVE_END_BLEND);
    // The sea is shown to the frame by the view alone: the cover map's word is its own.
    expect(sourceText("game/lite/seaMeshes.ts")).toContain("      if (held !== shown) {\n        shown = held;\n        setMeshVisible(mesh, shown);");
    // Under a lake's wet line there is no cove, so no fragment there reads the table whatever the view holds.
    setWetCove(0, 180, -24, COVE_FACE_GRADE);
    expect(wetUniforms({ line: 80.3, level: 80, centre: [250, 70], radius: 60, kd: [0.3, 0.1, 0.05], attenuate: true, cap: 0 }).wetCove).toEqual([0, WET_NO_COVE, 0, 0]);

    // What the gate saves: a table that has moved and is not packed is not in the frame's run of moved words.
    const table = (reach: number, age: number): Float32Array => {
      const data = new Float32Array(SWASH_COLUMNS * SWASH_STRIDE);
      for (let c = 0; c < SWASH_COLUMNS; c++) {
        data[c * SWASH_STRIDE + 2] = reach;
        data[c * SWASH_STRIDE + 3] = age;
      }
      return data;
    };
    try {
      const made = block();
      const word = (name: string): number => (made.offsets.get(name) as number) / 4;
      const bits = new Uint32Array(made.data.buffer, made.data.byteOffset, made.data.length);
      const sent = new Uint32Array(bits.length);
      const range = { from: -1, to: -1 };
      const values = frame();
      setWetSwash(table(6, 5));
      writeFrameBlock(made.data, made.offsets, values);
      movedWords(bits, sent, range);
      // A frame inland: the edge has stepped (every age a frame older) but the table is not packed; a clock ran.
      values.wingTime = 124;
      writeFrameBlock(made.data, made.offsets, values);
      expect(movedWords(bits, sent, range)).toBe(true);
      expect(range).toEqual({ from: word("wingTime"), to: word("wingTime") + 1 });
      // The first frame that shows the sea packs the table as it stands then: the run begins at the table's first word.
      values.wingTime = 125;
      setWetSwash(table(6, 5 + 1 / 60));
      writeFrameBlock(made.data, made.offsets, values);
      expect(movedWords(bits, sent, range)).toBe(true);
      expect(range).toEqual({ from: word("wetSwash") + 1, to: word("wingTime") + 1 });
      expect((range.to - range.from) * 4).toBeGreaterThan(4096);
      expect(made.data[word("wetSwash") + 1]).toBe(Math.fround(5 + 1 / 60));
    } finally {
      setWetCove(Number.NaN, 0, 0, 0);
      setWetSwash(table(0, WET_DRY_S));
    }
  });
});
