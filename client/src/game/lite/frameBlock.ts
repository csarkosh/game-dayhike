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
 * (`distanceFade.ts`), and the terrain's whole record (`terrainUniforms.ts`,
 * which its two materials share). They are the same for every material and
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
 */
import { emptyAtmosphereUniforms, type AtmosphereUniforms } from "../atmosphereParams.js";
import { emptyFadeUniforms } from "../distanceFade.js";
import { FOLIAGE_PLAYERS, FOLIAGE_PROFILES, emptyFoliageUniforms, foliageLook, foliageUniforms } from "../foliageUniforms.js";
import { emptyTerrainUniforms, type TerrainUniforms } from "../terrainUniforms.js";
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

/** A table of floats laid out as Lite lays a plugin's array out: vec4s of bits, which the shader casts back. */
const bits = (name: string, vecs: number): UniformField => ({ name, type: `array<vec4<u32>,${vecs}>` });

/** A record's fields but the arrays, which are laid out as bits. */
function scalarFields(record: object, arrays: readonly string[]): UniformField[] {
  const scalars: Record<string, ArrayLike<number>> = {};
  for (const [name, value] of Object.entries(record)) if (!arrays.includes(name)) scalars[name] = value as ArrayLike<number>;
  return uniformFields(scalars);
}

/** The block's fields, part by part: the air's, the wet look's, the wind's, the fade's, the terrain's. */
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
 * the fade's eye and rows, and the terrain's record.
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
  writeUniforms(data, offsets, values.terrain);
}
