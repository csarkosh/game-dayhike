/**
 * The wet look in WGSL, for the materials Babylon Lite draws: what water and
 * weather do to a surface (`wetSurface.ts` has the numbers and says what the
 * look is). Its uniforms are read as `material.<name>` under the names
 * `wetUniforms` gives them. The text is in `shaders/wet/`, imported with
 * `?raw`.
 *
 * The swash's table is 256 vec4s of floats. Lite lays out a plugin's array
 * only as `array<vec4<u32>, N>`, so the floats ride as their bits and the
 * shader casts them back.
 *
 * The swash's band (`wetShore`) is laid from the level of the wet line's
 * body, in a window of z alone (`wetCoveShare`). The cove is the sea's, so
 * `wetUniforms` gives `wetCove` no cove while the wet line is a lake's, and
 * the window is shut at every z of the lake's bank.
 */
import { WET_SWASH_VECS, emptyWetUniforms, type WetUniforms } from "../wetSurface.js";
import { uniformFields, writeUniforms, type UniformField, type UniformOffsets, type UniformRecord } from "./pluginUniforms.js";
import defsSource from "../shaders/wet/defs.wgsl?raw";
import weatherSource from "../shaders/wet/weather.wgsl?raw";
import lightsSource from "../shaders/wet/lights.wgsl?raw";
import { wgsl } from "../shaders/shaderText.js";

/** The wet look's constants and functions: a material's fragment definitions. */
export const WET_WGSL = wgsl(defsSource);

/** The weather's share, where a material's base colour and roughness are
 * known and its albedo is not yet split from its F0: a porous surface darkens
 * and glosses with the weather's wetness, up to the material's cap. */
export const WET_WEATHER = wgsl(weatherSource);

/**
 * The wet look where a material's albedo and roughness are known and no
 * light has run (`WET_LIGHTS`, without the terrain's
 * made features, which `terrainPlugins.ts` adds): the surface under a body's wet line and inside its disc
 * darkens and glosses, the swash's band soaks, dampens and speckles it, and
 * the water above takes its colour a channel.
 */
export const WET_LIGHTS = wgsl(lightsSource);

/** The swash table's field: its vec4s as bits (above). */
export const WET_SWASH_FIELD: UniformField = { name: "wetSwash", type: `array<vec4<u32>,${WET_SWASH_VECS}>` };

/** The wet look's uniforms but the swash's table, which is laid out as bits (`WET_SWASH_FIELD`). */
function wetScalars(values: WetUniforms): UniformRecord {
  const { wetSwash: _swash, ...scalars } = values;
  void _swash;
  return scalars;
}

/** A wet plugin's fields: one a uniform, in the record's order, the swash's table last. */
export const WET_FIELDS: readonly UniformField[] = [...uniformFields(wetScalars(emptyWetUniforms())), WET_SWASH_FIELD];

/** Writes `values` (`wetUniforms`) into a material's uniform buffer at the wet fields' offsets, the swash's table float for float. */
export function writeWetUniforms(data: Float32Array, offsets: UniformOffsets, values: WetUniforms): void {
  writeUniforms(data, offsets, wetScalars(values));
  const swash = offsets.get(WET_SWASH_FIELD.name);
  if (swash === undefined) throw new Error(`no uniform ${WET_SWASH_FIELD.name} in the material's buffer`);
  data.set(values.wetSwash, swash / 4);
}
