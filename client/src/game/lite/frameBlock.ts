/**
 * The frame's uniform block on Babylon Lite: what every material of the hike
 * reads alike and what changes with the frame, in one buffer written once a
 * frame.
 *
 * A material's plugins read their numbers from the material's own uniform
 * buffer, which Lite writes again whenever the material is marked. Most of
 * those numbers are not the material's: the air (`atmosphereParams.ts`), the
 * wet line and the weather's wetness (`wetSurface.ts`), the wind, its clock
 * and the players who bend the foliage (`foliageUniforms.ts`), the eye the
 * fades and the foliage measure from and the frame's height
 * (`distanceFade.ts`), the clock the birds' wings beat on (`wingParams.ts`),
 * what every lake's water reads alike (`waterSurface.ts`: the lakes' time,
 * the wind and its integral, the rain, the sun's share, the bump's drift)
 * and the terrain's whole record (`terrainUniforms.ts`, which its two
 * materials share). They are the same for every material and
 * most of them move every frame, so with them in each material's buffer
 * every material was written every frame: sixty-odd buffer writes at a
 * forest view to say one thing.
 *
 * Here they are one block (`createPluginUniformBlock` in Lite), which a
 * plugin names beside its own uniforms and reads as `hikeFrame.<name>`. A
 * material keeps what is its own (a look's numbers, a porosity cap, a
 * fade's widening), which is written when the material is made and again
 * only if it changes.
 *
 * This module is the block's contents with no engine: its fields, from the
 * plain uniform modules' own records, so a name or a size cannot drift from
 * them; which names are the block's; the rewrite of a plugin's WGSL from
 * `material.<name>` to the block for those names; and the write of a
 * frame's values at the offsets Lite lays the fields out at.
 *
 * **The hike's own stages read it too** (the sky's dome, the mist banks,
 * the motes, the rain and its splashes: shader materials, which name the
 * block as a plugin does). Each carried a copy of what the block holds, the
 * scene's fog and the eye, and was written its own exposure, contrast and
 * clock every frame. So the block carries the display curve's exposure and
 * contrast and those stages' clocks, under the names their records give
 * them, and a stage's text is rewritten from `u.<name>` to the block for
 * every name the block holds (`stageReads`), the stage's name for a value
 * the block holds under another given beside it. What is left in a stage's
 * own buffer (`stageOwn`) is written when the hour or the weather moves it:
 * a frame with the camera still and the clocks running writes the block
 * and nothing of theirs.
 *
 * **The view is the scene's own.** Lite declares its scene uniforms ahead
 * of every stage, a shader material's too: the view, the view's projection
 * of the world and the eye, written once a pass. The hike's own stages read
 * those (`scene.viewProjection`, `scene.view`, `scene.vEyePosition`) and
 * declare none of Lite's system uniforms, which are a copy of the same
 * matrices in a buffer a mesh, written again for each whenever the camera
 * moves. The one matrix the scene's do not hold, the projection alone,
 * which the motes lay their quads out by, rides in the block.
 */
import { emptyAtmosphereUniforms, type AtmosphereUniforms } from "../atmosphereParams.js";
import { emptyFadeUniforms } from "../distanceFade.js";
import { emptyMoteUniforms } from "../moteField.js";
import { emptyRainUniforms } from "../rainField.js";
import { emptySplashUniforms } from "../splashField.js";
import { FOLIAGE_PLAYERS, FOLIAGE_PROFILES, emptyFoliageUniforms, foliageLook, foliageUniforms } from "../foliageUniforms.js";
import { emptyTerrainUniforms, type TerrainUniforms } from "../terrainUniforms.js";
import { emptyWaterFrameUniforms, type WaterFrameUniforms } from "../waterSurface.js";
import { WET_SWASH_VECS, emptyWetUniforms, type WetUniforms } from "../wetSurface.js";
import { uniformFields, writeUniforms, type UniformField, type UniformOffsets, type UniformRecord } from "./pluginUniforms.js";

/** The block's name in WGSL: a field is read as `hikeFrame.<name>`. */
export const FRAME_BLOCK = "hikeFrame";

/** The wind's part of the foliage's record: the page's wind, the eye and the players. The rest is a look's own. */
export const FRAME_WIND_NAMES = ["windDir", "windLean", "windGust", "windFlutter", "windTime", "windEye", "windPlayers"] as const;
/** The one field of the wet look's record that is a material's own: its porosity cap. */
export const WET_OWN_NAME = "wetCap";
/** The frame's height in pixels, which the fade's noise turns a fragment's row over by. */
export const FADE_ROWS_NAME = "fadeRows";
/** The terrain's albedo under the weather, beside its record. */
export const TERRAIN_ALBEDO_NAME = "terrainAlbedo";
/** The clock every wing beats on, seconds, wrapped (`wingParams.ts`). */
export const WING_TIME_NAME = "wingTime";

/** The display curve's exposure and contrast, for the stages that end with it themselves (`displayCurve.ts`). */
export const FRAME_EXPOSURE_NAME = "frameExposure";
export const FRAME_CONTRAST_NAME = "frameContrast";
/**
 * The clocks of the hike's own stages, under the names their records give them: the motes' clock and the wind's carry
 * of them (`moteField.ts`), the rain's folded time, its smoothed frame, the wind's drift of it and the canopy's water
 * (`rainField.ts`), and the splashes' folded time (`splashField.ts`).
 */
export const FRAME_CLOCK_NAMES = ["moteClock", "moteTravel", "rainDrift", "rainFold", "rainDt", "rainCanopyWater", "splashTime"] as const;

/** The camera's projection, for a stage that lays a quad out in the view's space (the motes). */
export const FRAME_PROJECTION_NAME = "frameProjection";

/** A table of floats laid out as Lite lays a plugin's array out: vec4s of bits, which the shader casts back. */
const bits = (name: string, vecs: number): UniformField => ({ name, type: `array<vec4<u32>,${vecs}>` });

/** A record's fields but the arrays, which are laid out as bits. */
function scalarFields(record: object, arrays: readonly string[]): UniformField[] {
  const scalars: Record<string, ArrayLike<number>> = {};
  for (const [name, value] of Object.entries(record)) if (!arrays.includes(name)) scalars[name] = value as ArrayLike<number>;
  return uniformFields(scalars);
}

/** The block's fields, part by part: the air's, the wet look's, the wind's, the fade's, the terrain's, the wings' clock, the lakes'. */
export const FRAME_FIELDS: readonly UniformField[] = [
  ...uniformFields(emptyAtmosphereUniforms()),
  ...scalarFields(emptyWetUniforms(), ["wetSwash"]).filter((field) => field.name !== WET_OWN_NAME),
  bits("wetSwash", WET_SWASH_VECS),
  ...scalarFields(emptyFoliageUniforms(), ["windPlayers"]).filter((field) => (FRAME_WIND_NAMES as readonly string[]).includes(field.name)),
  bits("windPlayers", FOLIAGE_PLAYERS),
  { name: "fadeEye", type: "vec3<f32>" },
  { name: FADE_ROWS_NAME, type: "f32" },
  ...uniformFields(emptyTerrainUniforms()),
  { name: TERRAIN_ALBEDO_NAME, type: "vec3<f32>" },
  { name: WING_TIME_NAME, type: "f32" },
  ...uniformFields(emptyWaterFrameUniforms()),
  { name: FRAME_EXPOSURE_NAME, type: "f32" },
  { name: FRAME_CONTRAST_NAME, type: "f32" },
  ...uniformFields({ ...emptyMoteUniforms(), ...emptyRainUniforms(), ...emptySplashUniforms() }).filter((field) => (FRAME_CLOCK_NAMES as readonly string[]).includes(field.name)),
  { name: FRAME_PROJECTION_NAME, type: "mat4x4<f32>" },
];

const FRAME_NAMES: ReadonlySet<string> = new Set(FRAME_FIELDS.map((field) => field.name));
if (FRAME_NAMES.size !== FRAME_FIELDS.length) throw new Error("two of the frame's uniforms share a name");
if (emptyFadeUniforms().fadeEye.length !== 3) throw new Error("the fade's eye is three floats");

/** Whether the uniform `name` is the frame's: read from the block, not from a material's own buffer. */
export function inFrameBlock(name: string): boolean {
  return FRAME_NAMES.has(name);
}

/** Of a plugin's `fields`, the material's own: those the frame's block does not hold. */
export function ownFields(fields: readonly UniformField[]): UniformField[] {
  return fields.filter((field) => !FRAME_NAMES.has(field.name));
}

/** Of `record`, the material's own values: those the frame's block does not hold. */
export function ownValues(record: UniformRecord): UniformRecord {
  const own: Record<string, ArrayLike<number>> = {};
  for (const name in record) if (!FRAME_NAMES.has(name)) own[name] = record[name] as ArrayLike<number>;
  return own;
}

const READS = new RegExp(`\\bmaterial\\.(${[...FRAME_NAMES].join("|")})\\b`, "g");

/** `wgsl` with every read of one of the frame's uniforms from the material's buffer turned to the block. */
export function frameReads(wgsl: string): string {
  return wgsl.replace(READS, `${FRAME_BLOCK}.$1`);
}

/** A stage's uniforms by name, as its module fills them: one to four floats each. */
export type StageRecord = Readonly<Record<string, readonly number[]>>;

/** The block's name for the stage's uniform `name`: `as`'s for it, or its own. */
function blockName(name: string, as: Readonly<Record<string, string>>): string {
  const field = Object.hasOwn(as, name) ? (as[name] as string) : name;
  if (Object.hasOwn(as, name) && !FRAME_NAMES.has(field)) throw new Error(`the frame's block holds no ${field} for a stage to read as ${name}`);
  return field;
}

/**
 * `wgsl`, a stage of the hike's own, with every read of `u.<name>` that the
 * frame's block holds turned to the block: a name the block holds itself (a
 * clock), or one `as` gives the block's name for (the stage's exposure, its
 * fog, its eye).
 */
export function stageReads(wgsl: string, as: Readonly<Record<string, string>> = {}): string {
  return wgsl.replace(/\bu\.(\w+)\b/g, (whole, name: string) => {
    const field = blockName(name, as);
    return FRAME_NAMES.has(field) ? `${FRAME_BLOCK}.${field}` : whole;
  });
}

/** Of `record`, a stage's uniforms, the stage's own: those it does not read from the frame's block (`stageReads`). The
 * values are the record's own arrays. */
export function stageOwn(record: StageRecord, as: Readonly<Record<string, string>> = {}): Record<string, number[]> {
  const own: Record<string, number[]> = {};
  for (const name in record) if (!FRAME_NAMES.has(blockName(name, as))) own[name] = record[name] as number[];
  return own;
}

/** Of `record`, a stage's uniforms, the clocks the frame's block carries: the record's own arrays, read at each write. */
export function stageClocks(record: StageRecord): Record<string, readonly number[]> {
  const clocks: Record<string, readonly number[]> = {};
  for (const name of FRAME_CLOCK_NAMES) if (Object.hasOwn(record, name)) clocks[name] = record[name] as readonly number[];
  return clocks;
}

/** What a frame's block is written from: the plain modules' records as the renderer fills them, the eye and the frame's height. */
export type FrameValues = {
  air: AtmosphereUniforms;
  /** The wet look under the frame's wet line; its cap is not read. */
  wet: WetUniforms;
  terrain: TerrainUniforms & { terrainAlbedo: ArrayLike<number> };
  /** The eye the foliage and the fades measure from. */
  eye: { readonly x: number; readonly y: number; readonly z: number };
  /** The frame's height, pixels. */
  rows: number;
  /** The wings' clock, seconds, wrapped (`wingTime`). */
  wingTime: number;
  /** What every lake reads alike (`waterFrameUniforms`): zeros in a world with no lake. */
  water: WaterFrameUniforms;
  /** The display curve's exposure and contrast. */
  exposure: number;
  contrast: number;
  /** The clocks of the stages that stand (`stageClocks`), each as its stage's last update left it. */
  clocks: readonly Readonly<Record<string, readonly number[]>>[];
  /** The camera's projection, sixteen floats as Lite hands a matrix; absent, the block's stands as it was. */
  projection?: ArrayLike<number>;
};

/** The wind's values are the foliage's own, read through a look that adds nothing to them. */
const WIND_LOOK = foliageLook("frame", FOLIAGE_PROFILES.TREE, 1);
const windValues = emptyFoliageUniforms();

function offsetOf(offsets: UniformOffsets, name: string): number {
  const at = offsets.get(name);
  if (at === undefined) throw new Error(`no uniform ${name} in the frame's block`);
  return at / 4;
}

/**
 * Writes a frame's values into `data`, the block's floats, at `offsets`:
 * the air, the wet look but its cap (the swash's table float for float),
 * the page's wind with the eye and the players (xyz each, a vec4 a player),
 * the fade's eye and rows, the wings' clock, the lakes' record and the
 * terrain's.
 */
export function writeFrameBlock(data: Float32Array, offsets: UniformOffsets, values: FrameValues): void {
  writeUniforms(data, offsets, values.air);
  const { wetSwash, wetCap: _cap, ...wet } = values.wet;
  void _cap;
  writeUniforms(data, offsets, wet);
  data.set(wetSwash, offsetOf(offsets, "wetSwash"));
  const wind = foliageUniforms(WIND_LOOK, values.eye, windValues);
  for (const name of FRAME_WIND_NAMES) {
    if (name === "windPlayers") continue;
    const value = wind[name];
    const at = offsetOf(offsets, name);
    for (let i = 0; i < value.length; i++) data[at + i] = value[i] as number;
  }
  const players = offsetOf(offsets, "windPlayers");
  for (let i = 0; i < FOLIAGE_PLAYERS; i++) {
    data[players + i * 4] = wind.windPlayers[i * 3] as number;
    data[players + i * 4 + 1] = wind.windPlayers[i * 3 + 1] as number;
    data[players + i * 4 + 2] = wind.windPlayers[i * 3 + 2] as number;
  }
  const eye = offsetOf(offsets, "fadeEye");
  data[eye] = values.eye.x;
  data[eye + 1] = values.eye.y;
  data[eye + 2] = values.eye.z;
  data[offsetOf(offsets, FADE_ROWS_NAME)] = values.rows;
  data[offsetOf(offsets, WING_TIME_NAME)] = values.wingTime;
  writeUniforms(data, offsets, values.water);
  writeUniforms(data, offsets, values.terrain);
  data[offsetOf(offsets, FRAME_EXPOSURE_NAME)] = values.exposure;
  data[offsetOf(offsets, FRAME_CONTRAST_NAME)] = values.contrast;
  for (const clocks of values.clocks) writeUniforms(data, offsets, clocks);
  if (values.projection !== undefined) {
    const at = offsetOf(offsets, FRAME_PROJECTION_NAME);
    for (let i = 0; i < 16; i++) data[at + i] = values.projection[i] as number;
  }
}
