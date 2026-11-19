import type { MaterialPlugin, PluginUniformBlock } from "@babylonjs/lite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COVE_END_BLEND, COVE_FACE_GRADE } from "../../../src/sim/olympic.js";
import { SWASH_FACE_LIFT_M, SWASH_REACH_MAX_M } from "../../../src/game/swashRunUp.js";
import { SWASH_COLUMNS, SWASH_STRIDE } from "../../../src/game/swashTable.js";
import { emptyMaterialGradeUniforms } from "../../../src/game/materialGrade.js";
import "../../../src/sim/passes/index.js";
import { atmosphereUniforms, emptyAtmosphereUniforms, type AtmosphereRecord } from "../../../src/game/atmosphereParams.js";
import { noCloud } from "../../../src/game/cloudParams.js";
import { emptyFadeUniforms, fadeUniforms } from "../../../src/game/distanceFade.js";
import { FOLIAGE_PLAYERS, FOLIAGE_PROFILES, emptyFoliageUniforms, foliageLook, foliageUniforms, setFoliageWind } from "../../../src/game/foliageUniforms.js";
import { atmospherePlugin } from "../../../src/game/lite/atmospherePlugin.js";
import { FADE_FIELDS, FOLIAGE_FIELDS, surfaceWetPlugin, vegetationPlugin, type Vegetation } from "../../../src/game/lite/forestPlugins.js";
import {
  FRAME_BLOCK, FRAME_CLOCK_NAMES, FRAME_FIELDS, FRAME_MOVING_NAMES, FRAME_PARTS, FRAME_WIND_NAMES, frameReads, inFrameBlock, movedWords, ownFields, ownValues,
  stageClocks, stageOwn, stageReads, writeFrameBlock, type FrameValues,
} from "../../../src/game/lite/frameBlock.js";
import { TERRAIN_FIELDS, emptyTerrainMaterialUniforms, terrainPlugin, terrainWetPlugin } from "../../../src/game/lite/terrainPlugins.js";
import { WET_FIELDS } from "../../../src/game/lite/wetWgsl.js";
import { emptyMoteUniforms } from "../../../src/game/moteField.js";
import { emptyRainUniforms } from "../../../src/game/rainField.js";
import { emptySplashUniforms } from "../../../src/game/splashField.js";
import { emptyTerrainUniforms, terrainUniforms } from "../../../src/game/terrainUniforms.js";
import { emptySeaFrameUniforms } from "../../../src/game/seaUniforms.js";
import { emptyWaterFrameUniforms } from "../../../src/game/waterSurface.js";
import {
  WET_BAND, WET_COVE_END, WET_DRY_S, WET_NO_COVE, WET_SWASH_VECS, emptyWetUniforms, setWetCove, setWetSwash, setWetWeather, wetUniforms,
} from "../../../src/game/wetSurface.js";
import { windRecordUnder } from "../../../src/game/windParams.js";
import { WEATHER_PRESETS } from "../../../src/game/weather.js";
import { readUniform, standInTexture } from "./pluginFixture.js";

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

const floatsOf = (name: string): number => sizeOf((FRAME_FIELDS.find((field) => field.name === name) as { type: string }).type).floats;
const MAP = standInTexture("cloud");
const AIR: AtmosphereRecord = {
  baseDensity: 0.0004, heightDensity: 0.004, heightFalloff: 0.05, referenceLevel: -20, gradientScale: 1 / 4000,
  sunDir: { x: 0.6, y: 0, z: 0.8 }, sunColour: { r: 1, g: 0.8, b: 0.6 }, sunWeight: 0.5, sunPower: 8,
  farColour: { r: 0.4, g: 0.5, b: 0.6 },
};
const names = (plugin: MaterialPlugin): string[] => (plugin.getUniforms?.().ubo ?? []).map((field) => field.name);
const code = (plugin: MaterialPlugin): string =>
  (["vertex", "fragment"] as const).map((stage) => Object.values(plugin.getCustomCode?.(stage) ?? {}).join("\n")).join("\n");

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
  it("holds each plain module's scene-wide uniforms under their own names and sizes, once each", () => {
    const fields = new Map(FRAME_FIELDS.map((field) => [field.name, field.type]));
    expect(fields.size).toBe(FRAME_FIELDS.length);
    // The air's whole record, the terrain's whole record, the wet look but a material's cap.
    for (const [name, value] of Object.entries(emptyAtmosphereUniforms())) expect(sizeOf(fields.get(name) as string).floats).toBe(value.length);
    for (const field of TERRAIN_FIELDS) expect(fields.get(field.name)).toBe(field.type);
    for (const field of WET_FIELDS) expect(fields.get(field.name)).toBe(field.name === "wetCap" ? undefined : field.type);
    expect(fields.get("wetSwash")).toBe(`array<vec4<u32>,${WET_SWASH_VECS}>`);
    // Of the foliage's record the wind, the eye and the players; of the fade's the eye and the rows.
    for (const field of FOLIAGE_FIELDS) expect(fields.get(field.name)).toBe((FRAME_WIND_NAMES as readonly string[]).includes(field.name) ? field.type : undefined);
    expect(FADE_FIELDS.map((field) => [field.name, fields.get(field.name)])).toEqual([["fadeEye", "vec3<f32>"], ["fadeWiden", undefined], ["fadeRows", "f32"]]);
    expect(inFrameBlock("windTime")).toBe(true);
    expect(inFrameBlock("foliageAmp")).toBe(false);
    // The display curve, and the clocks of the hike's own stages under their records' names and sizes.
    expect([fields.get("frameExposure"), fields.get("frameContrast")]).toEqual(["f32", "f32"]);
    const stages: Record<string, number[]> = { ...emptyMoteUniforms(), ...emptyRainUniforms(), ...emptySplashUniforms() };
    for (const name of FRAME_CLOCK_NAMES) expect(sizeOf(fields.get(name) as string).floats, name).toBe((stages[name] as number[]).length);
    // Of those records nothing else is the frame's: a stage's settings are its own.
    expect(Object.keys(stages).filter(inFrameBlock).sort()).toEqual([...FRAME_CLOCK_NAMES].sort());
    // What stood in the block keeps its place among the parts as they are declared: the new fields follow the wings'
    // clock and the lakes' values, and the sea's follow them. Where each is laid is another matter (below).
    expect(new Set(FRAME_PARTS)).toEqual(new Set(FRAME_FIELDS));
    expect(FRAME_PARTS.length).toBe(FRAME_FIELDS.length);
    const order = FRAME_PARTS.map((field) => field.name);
    expect(order.slice(order.indexOf("wingTime") + 1)).toEqual([
      ...Object.keys(emptyWaterFrameUniforms()), "frameExposure", "frameContrast", ...FRAME_CLOCK_NAMES, "frameProjection", ...Object.keys(emptySeaFrameUniforms()),
      "shadeSmokeTime", ...Object.keys(emptyMaterialGradeUniforms()),
    ]);
    // The grade a tier with no post chain lays on in every material: six vectors.
    for (const name of Object.keys(emptyMaterialGradeUniforms())) expect(fields.get(name), name).toBe("vec4<f32>");
    // The clock the shades' smoke rises on, which the mask's material reads.
    expect(fields.get("shadeSmokeTime")).toBe("f32");
    // The projection alone of the camera's matrices: the view and the eye are the scene's own, which every stage reads.
    expect(fields.get("frameProjection")).toBe("mat4x4<f32>");
  });

  it("packs a frame's values where the block lays its fields out, each as the plain module that owns it computes it", () => {
    const made = block();
    const values = frame();
    writeFrameBlock(made.data, made.offsets, values);
    const read = (name: string): number[] => readUniform(made.data, made.offsets, name, floatsOf(name));
    const f32 = (list: ArrayLike<number>): number[] => [...Float32Array.from(list)];
    for (const [name, value] of Object.entries(values.air)) expect(read(name)).toEqual(f32(value));
    for (const [name, value] of Object.entries(values.terrain)) expect(read(name)).toEqual(f32(value));
    for (const [name, value] of Object.entries(values.wet)) {
      if (name !== "wetCap") expect(read(name)).toEqual(f32(value));
    }
    // The wind, the eye and the players as the foliage's own module hands them to a material.
    const foliage = foliageUniforms(foliageLook("any", FOLIAGE_PROFILES.BLADES, 0.4), values.eye, emptyFoliageUniforms());
    for (const name of FRAME_WIND_NAMES) {
      if (name === "windPlayers") continue;
      expect(read(name)).toEqual(f32(foliage[name]));
    }
    expect(read("windEye")).toEqual([12, 34, -56]);
    const players = read("windPlayers");
    for (let i = 0; i < FOLIAGE_PLAYERS; i++) expect(players.slice(i * 4, i * 4 + 4)).toEqual([100 + i * 3, 101 + i * 3, 102 + i * 3, -99]);
    // The fade's eye as its module computes it, and the frame's rows.
    expect(read("fadeEye")).toEqual(f32(fadeUniforms(values.eye, { band: [0, 1], factor: 1 }, emptyFadeUniforms()).fadeEye));
    expect(read("fadeRows")).toEqual([956]);
    // What every lake reads alike, as the water's own module names it.
    expect(Object.keys(values.water)).toEqual(Object.keys(emptyWaterFrameUniforms()));
    for (const [name, value] of Object.entries(values.water)) expect(read(name)).toEqual(f32(value));
    // The display curve and the stages' clocks, as their records hold them.
    expect([read("frameExposure"), read("frameContrast")]).toEqual([f32([0.85]), f32([1.1])]);
    expect([read("moteClock"), read("moteTravel"), read("rainFold"), read("rainDt"), read("rainDrift"), read("rainCanopyWater"), read("splashTime")]).toEqual(
      [[3.5], [1.25, -2.5], [7.75], f32([1 / 40]), [0.5, -0.25], f32([0.6]), [9.5]],
    );
    expect(read("frameProjection")).toEqual(Array.from({ length: 16 }, (_, i) => 0.5 + i));
    // A frame handed no projection leaves the block's as it stands.
    writeFrameBlock(made.data, made.offsets, { ...values, projection: undefined, exposure: 0.25 });
    expect(read("frameProjection")).toEqual(Array.from({ length: 16 }, (_, i) => 0.5 + i));
    expect(read("frameExposure")).toEqual([0.25]);
    writeFrameBlock(made.data, made.offsets, values);
    // What moves the sea, as the sea's own module names it, its rings' records float for float.
    expect(Object.keys(values.sea)).toEqual(Object.keys(emptySeaFrameUniforms()));
    for (const [name, value] of Object.entries(values.sea)) expect(read(name)).toEqual(f32(value));
    // The material path's grade, as its module names it; a frame that hands none leaves the block's as it stands.
    for (const [name, value] of Object.entries(values.grade ?? {})) expect(read(name)).toEqual(f32(value as number[]));
    writeFrameBlock(made.data, made.offsets, { ...values, grade: undefined });
    expect(read("gradeVignette2")).toEqual(f32([0.01, 0.02, 0.03, -3]));
    // The smoke's clock, and nothing where a frame hands none.
    expect(read("shadeSmokeTime")).toEqual([12.5]);
    writeFrameBlock(made.data, made.offsets, { ...values, smokeTime: undefined });
    expect(read("shadeSmokeTime")).toEqual([0]);
    writeFrameBlock(made.data, made.offsets, values);
    // Every float of every field was written but the players' fourth, which nothing reads.
    const unwritten = [...made.offsets].flatMap(([name, at]) => [...made.data.subarray(at / 4, at / 4 + floatsOf(name))].map((v, i) => (v === -99 ? `${name}[${i}]` : null))).filter((v) => v !== null);
    expect(unwritten).toEqual(Array.from({ length: FOLIAGE_PLAYERS }, (_, i) => `windPlayers[${i * 4 + 3}]`));
    expect(() => writeFrameBlock(made.data, new Map(), values)).toThrow(/atmOn|in the material's buffer|frame's block/);
  });

  it("lays what a frame moves last and together, so a frame's run of moved words is short", () => {
    const laid = FRAME_FIELDS.map((field) => field.name);
    // The tail of the block is what a frame moves, in its own order; the rest keeps the order it is declared in.
    expect(laid.slice(laid.length - FRAME_MOVING_NAMES.length)).toEqual([...FRAME_MOVING_NAMES]);
    expect(new Set(FRAME_MOVING_NAMES).size).toBe(FRAME_MOVING_NAMES.length);
    expect(laid.slice(0, laid.length - FRAME_MOVING_NAMES.length)).toEqual(FRAME_PARTS.map((field) => field.name).filter((name) => !FRAME_MOVING_NAMES.includes(name)));
    // Every clock is there: the stages', the wind's, the wings', the smoke's, the ripples', the cloud's drift; the eye
    // wherever a part holds one; and every field of the lakes' record and of the sea's, so one added to either is
    // laid there without being named.
    for (const name of [
      ...FRAME_CLOCK_NAMES, "windTime", "windDir", "wingTime", "shadeSmokeTime", "terrainTime", "atmCloudWind", "windEye", "fadeEye", "terrainEye", "windPlayers",
      ...Object.keys(emptyWaterFrameUniforms()), ...Object.keys(emptySeaFrameUniforms()),
    ]) expect(FRAME_MOVING_NAMES, name).toContain(name);
    // The projection is the last field: the jitter's two floats close every frame's run on a tier with a post chain.
    expect(laid.at(-1)).toBe("frameProjection");
    const { offsets, data } = block();
    const at = (name: string): number => offsets.get(name) as number;
    expect(at("frameProjection") + 64).toBe(data.byteLength);
    const jitterEnd = at("frameProjection") + 10 * 4;
    // A camera that stands still with the clocks running: from the first stage clock to the jitter's second float.
    expect(jitterEnd - at("moteClock")).toBeLessThanOrEqual(304);
    // One that walks moves the eye too, and the players who bend the foliage; a ring of the sea crossed, its record.
    expect(jitterEnd - at("windEye")).toBeLessThanOrEqual(352);
    expect(jitterEnd - at("windPlayers")).toBeLessThanOrEqual(432);
    // The swash's table, the block's largest field by far, stands at the head of the run and not in the midst of it:
    // a frame that moves none of it sends none of it.
    expect(at("wetSwash")).toBeLessThan(at("seaRings"));
    expect(at("seaRings")).toBeLessThan(at("windPlayers"));
    // What the hour and the weather move stands before all of that: the air (but its cloud's drift), the wet line,
    // the terrain's record (but its eye and its ripples' clock), the grade.
    for (const name of ["atmSunDir", "atmFarColour", "wetLine", "wetCove", "terrainTiling", "terrainAlbedo", "fadeRows", "frameExposure", "gradeCurveNeutral", "gradeScreen"]) {
      expect(at(name), name).toBeLessThan(at("wetSwash"));
    }
    // A name that no part declares is a mistake said when the module loads, not a field left out: the list is checked against the parts.
    expect(FRAME_MOVING_NAMES.filter((name) => !FRAME_PARTS.some((field) => field.name === name))).toEqual([]);
  });

  it("packs the swash's table only on a frame whose view holds the sea, where alone the ground can read it", () => {
    // The table is 4 KB of the block, and a wetted column's age runs on every frame.
    expect(WET_SWASH_VECS * 16).toBe(4096);
    const renderer = readFileSync(new URL("../../../src/game/lite/renderer.ts", import.meta.url), "utf8");
    expect(renderer).toContain("          if (standing.sea.shown) setWetSwash(edge.table.data);");
    expect(renderer.split("setWetSwash(").length).toBe(2);
    // Under the sea's wet line the ground the swash wets is the cove's face up to the sheet's farthest reach, and the
    // wet line's soft edge over it; the sea's rings count the face that high as their water, over the same span of
    // the shore, so that ground is inside a ring's box of water, and a view that holds it shows the sea.
    expect(SWASH_REACH_MAX_M * COVE_FACE_GRADE + WET_BAND / 2).toBeLessThanOrEqual(SWASH_FACE_LIFT_M);
    expect(WET_COVE_END).toBeLessThanOrEqual(COVE_END_BLEND);
    // The sea is shown to the frame by the view alone: the cover map's word is its own.
    expect(readFileSync(new URL("../../../src/game/lite/seaMeshes.ts", import.meta.url), "utf8")).toContain("      if (held !== shown) {\n        shown = held;\n        setMeshVisible(mesh, shown);");
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

  it("sends the run of the block's words that moved since it was last sent, and nothing on a frame none did", () => {
    const made = block();
    writeFrameBlock(made.data, made.offsets, frame());
    const bits = new Uint32Array(made.data.buffer, made.data.byteOffset, made.data.length);
    // A buffer that has been sent nothing holds zeros: the first frame's run is every word that is not one.
    const sent = new Uint32Array(bits.length);
    const range = { from: -1, to: -1 };
    expect(movedWords(bits, sent, range)).toBe(true);
    expect(range.from).toBe(bits.findIndex((word) => word !== 0));
    expect(range.to).toBe(bits.length - [...bits].reverse().findIndex((word) => word !== 0));
    expect([...sent]).toEqual([...bits]);
    // The same values again: nothing moved, nothing is sent, and the range is left as it was.
    const before = { ...range };
    writeFrameBlock(made.data, made.offsets, frame());
    expect(movedWords(bits, sent, range)).toBe(false);
    expect(range).toEqual(before);
    // One clock ran: its one word is the run.
    const word = (name: string): number => (made.offsets.get(name) as number) / 4;
    made.data[word("wingTime")] = 124;
    expect(movedWords(bits, sent, range)).toBe(true);
    expect(range).toEqual({ from: word("wingTime"), to: word("wingTime") + 1 });
    // Two words moved: the run is from the first to the last, whatever lies between, and what the buffer holds is then the block.
    made.data[word("windTime")] = 99;
    made.data[word("shadeSmokeTime")] = 7;
    expect(movedWords(bits, sent, range)).toBe(true);
    expect(range).toEqual({ from: Math.min(word("windTime"), word("shadeSmokeTime")), to: Math.max(word("windTime"), word("shadeSmokeTime")) + 1 });
    expect([...sent]).toEqual([...bits]);
    expect(movedWords(bits, sent, range)).toBe(false);
    // Words are told apart as bits: a value that is not a number moved once, not on every frame after.
    made.data[word("rainFold")] = Number.NaN;
    expect(movedWords(bits, sent, range)).toBe(true);
    expect(movedWords(bits, sent, range)).toBe(false);
  });

  it("turns a plugin's reads of the frame's uniforms to the block, and leaves the material's own where they are", () => {
    expect(frameReads("a=material.windTime*material.foliageAmp+material.wetLine-material.wetCap;")).toBe(
      `a=${FRAME_BLOCK}.windTime*material.foliageAmp+${FRAME_BLOCK}.wetLine-material.wetCap;`,
    );
    // A longer name that begins with one of the block's is not the block's.
    expect(frameReads("material.windTimeScale")).toBe("material.windTimeScale");
    expect(ownFields([{ name: "windTime", type: "f32" }, { name: "foliageAmp", type: "f32" }])).toEqual([{ name: "foliageAmp", type: "f32" }]);
    expect(ownValues({ windTime: [1], foliageAmp: [2], fadeWiden: [0, 1, 0] })).toEqual({ foliageAmp: [2], fadeWiden: [0, 1, 0] });
  });

  it("turns a stage's reads of what the block holds to the block, by the block's name for each, and leaves the stage's own", () => {
    const as = { rainCam: "fadeEye", rainExposure: "frameExposure" };
    expect(stageReads("let a=u.rainFold*u.rainSpeeds.x+length(u.rainCam-p)+u.rainExposure;let u=shaderUniforms;", as)).toBe(
      `let a=${FRAME_BLOCK}.rainFold*u.rainSpeeds.x+length(${FRAME_BLOCK}.fadeEye-p)+${FRAME_BLOCK}.frameExposure;let u=shaderUniforms;`,
    );
    // A longer name that begins with one of the block's is not the block's, and nothing but a read of `u` is touched.
    expect(stageReads("u.rainFoldScale+menu.rainFold+hikeFrame.rainFold")).toBe("u.rainFoldScale+menu.rainFold+hikeFrame.rainFold");
    // A name the block is said to hold and does not is a mistake, said.
    expect(() => stageReads("u.rainCam", { rainCam: "noSuchField" })).toThrow(/noSuchField/);
    const record = { rainFold: [1], rainSpeeds: [1, 2, 3, 4], rainCam: [0, 0, 0], rainExposure: [1] };
    const own = stageOwn(record, as);
    expect(Object.keys(own)).toEqual(["rainSpeeds"]);
    // The stage's own values are the record's arrays, so a record filled in place is what is written.
    expect(own["rainSpeeds"]).toBe(record.rainSpeeds);
    const clocks = stageClocks(record);
    expect(Object.keys(clocks)).toEqual(["rainFold"]);
    expect(clocks["rainFold"]).toBe(record.rainFold);
  });

  it("leaves a material given the block only what is its own, and no read of the frame's from its own buffer", () => {
    const shared = block();
    const look = foliageLook("crown", FOLIAGE_PROFILES.TREE, 30);
    const v: Vegetation = {
      eye: { x: 1, y: 2, z: 3 }, frame: { height: 600 }, foliage: look, match: false, light: true, fade: true, conform: true, moss: null, deadwood: null, sky: false, shared,
    };
    const plugins = {
      air: atmospherePlugin(emptyAtmosphereUniforms(), MAP, shared),
      wet: surfaceWetPlugin(emptyWetUniforms(), shared),
      terrainWet: terrainWetPlugin(emptyWetUniforms(), shared),
      vegetation: vegetationPlugin(v),
    };
    expect(names(plugins.air)).toEqual([]);
    expect(names(plugins.wet)).toEqual(["wetCap"]);
    expect(names(plugins.terrainWet)).toEqual(["wetCap"]);
    expect(names(plugins.vegetation).filter(inFrameBlock)).toEqual([]);
    expect(names(plugins.vegetation)).toContain("foliageAmp");
    expect(names(plugins.vegetation)).toContain("fadeWiden");
    for (const plugin of Object.values(plugins)) {
      expect(plugin.getUniformBlocks?.()).toEqual([shared]);
      const reads = [...code(plugin).matchAll(/\bmaterial\.(\w+)/g)].map((m) => m[1] as string);
      expect(reads.filter(inFrameBlock)).toEqual([]);
      // What it still reads from the material is declared there, or is Lite's own.
      const declared = new Set(names(plugin));
      expect(reads.filter((name) => !declared.has(name) && /^(wind|foliage|fade|wet|atm|gc|deadwood)/.test(name))).toEqual([]);
    }
    expect(code(plugins.air)).toContain(`${FRAME_BLOCK}.atmFarColour`);
    expect(code(plugins.vegetation)).toContain(`${FRAME_BLOCK}.windTime`);
    expect(code(plugins.vegetation)).toContain(`${FRAME_BLOCK}.fadeRows`);
    expect(code(plugins.wet)).toContain(`${FRAME_BLOCK}.wetWeather`);
    expect(code(plugins.wet)).toContain("material.wetCap");
  });

  it("writes a material given the block its own values alone: a cap, a look's numbers, a fade's widening", () => {
    const shared = block();
    const offsets = new Map([["wetCap", 64]]);
    const data = new Float32Array(32).fill(-99);
    const wet = emptyWetUniforms();
    wet.wetCap[0] = 0.7;
    surfaceWetPlugin(wet, shared).writeUbo?.(data, offsets);
    expect([...data].filter((v) => v !== -99)).toEqual([Math.fround(0.7)]);
    expect(data[16]).toBe(Math.fround(0.7));

    const look = foliageLook("crown", FOLIAGE_PROFILES.TREE, 30);
    const plugin = vegetationPlugin({
      eye: { x: 1, y: 2, z: 3 }, frame: { height: 600 }, foliage: look, match: false, light: false, fade: true, widen: { band: [10, 20], factor: 3 },
      conform: false, moss: null, deadwood: null, sky: false, shared,
    });
    const own = new Map<string, number>();
    let at = 64;
    for (const name of names(plugin)) {
      own.set(name, at);
      at += 16;
    }
    const material = new Float32Array(at / 4).fill(-99);
    plugin.writeUbo?.(material, own);
    expect(readUniform(material, own, "foliageHeight", 1)).toEqual([30]);
    expect(readUniform(material, own, "fadeWiden", 3)).toEqual([10, 20, 2]);
    // Nothing of the frame's was asked of the material's buffer: a write of one would have thrown for want of its field.
    expect([...own.keys()].filter(inFrameBlock)).toEqual([]);
  });

  it("draws the terrain from the block alone when it is given it, and from its own buffer when it is not", () => {
    const shared = block();
    const textures = Object.fromEntries(
      ["albedo", "nor", "rah", "roadCenter", "trailTable", "featureTex"].map((key) => [key, standInTexture(key)]),
    ) as unknown as Parameters<typeof terrainPlugin>[1];
    const paints = { road: true, trail: true, features: true };
    const own = terrainPlugin(emptyTerrainMaterialUniforms(), textures, true, paints);
    const given = terrainPlugin(emptyTerrainMaterialUniforms(), textures, true, paints, shared);
    expect(own.getUniforms?.().ubo).toEqual(TERRAIN_FIELDS);
    expect(own.getUniformBlocks).toBeUndefined();
    expect(given.getUniforms).toBeUndefined();
    expect(given.getUniformBlocks?.()).toEqual([shared]);
    const terrainNames = new Set(TERRAIN_FIELDS.map((field) => field.name));
    const reads = (plugin: MaterialPlugin, from: string): string[] =>
      [...code(plugin).matchAll(new RegExp(`\\b${from}\\.(\\w+)`, "g"))].map((m) => m[1] as string).filter((name) => terrainNames.has(name));
    expect(reads(given, "material")).toEqual([]);
    expect(reads(given, FRAME_BLOCK).length).toBeGreaterThan(0);
    expect(new Set(reads(given, FRAME_BLOCK))).toEqual(new Set(reads(own, "material")));
    // The same text but for where the terrain's uniforms are read from.
    expect(code(given)).toBe(code(own).replace(new RegExp(`\\bmaterial\\.(${[...terrainNames].join("|")})\\b`, "g"), `${FRAME_BLOCK}.$1`));
  });
});
