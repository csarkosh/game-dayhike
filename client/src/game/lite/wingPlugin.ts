/**
 * A wing's beat as a material plugin on Babylon Lite: each wing turned about
 * its body's forward axis by amp·sin(ωt + phase), weighted by how far out
 * along the wing a vertex lies, so the body holds still and the tip moves
 * most (`wingParams.ts` has the numbers; the recorded `wing.glsl` is the
 * same stage in GLSL, and this is it statement for
 * statement). Position only: normals are left unturned, as there.
 *
 * What differs is where a bird's own numbers ride. A flock's beats change
 * every frame, as its matrices do, and a second buffer would be a second
 * write a frame; so here they ride in the instance's matrix,
 * in the three floats of its last row a placed thing leaves at zero: the
 * phase, the amplitude and, for the one model that wears them, which of
 * its colourways the instance is. The stage reads them there, turns the
 * vertex in the bird's own frame and places it by the matrix's other three
 * rows, so a flock costs its matrices a frame and nothing else.
 *
 * The clock is the frame's (`frameBlock.ts`): every wing reads one.
 */
import type { MaterialPlugin, PluginUniformBlock } from "@babylonjs/lite";
import { wingHalfSpan } from "@csarkosh/engine/game/wingParams";
import { frameReads } from "./frameBlock.js";
import { wgslFloat } from "./forestPlugins.js";
import type { UniformOffsets } from "@csarkosh/engine/game/lite/pluginUniforms";
import wingSource from "../shaders/wing/wing.wgsl?raw";
import tintSource from "../shaders/wing/tint.wgsl?raw";
import { fill, wgsl } from "@csarkosh/engine/game/shaders/shaderText";

/** Where a bird's numbers ride in its instance's matrix: the last float of each of its first three columns. */
export const WING_PHASE_AT = 3;
export const WING_AMP_AT = 7;
export const WING_COLOURWAY_AT = 11;

/** The vertex stage's last step: `shaders`'s wing beat in the bird's own frame, then the place the matrix gives it. */
export const WING_WGSL = wgsl(wingSource);

/**
 * The plugin for a model whose wings beat at `omega` (rad/s) against a half
 * span of `halfSpan` (m), reading the clock from `shared`, the frame's
 * block. `colourways`, for a model worn in several: the instance's tint is
 * the one its matrix names, by the shade its vertex carries in the first of
 * its texture coordinates, as the game lays a pattern and a colourway over
 * a white material.
 */
export function wingPlugin(halfSpan: number, omega: number, shared: PluginUniformBlock, colourways: readonly (readonly [number, number, number])[] | null = null): MaterialPlugin {
  const span = wingHalfSpan(halfSpan);
  const tint = colourways === null ? "" : fill(wgsl(tintSource), { lastWay: wgslFloat(colourways.length - 1), wayCount: String(colourways.length), wayColours: colourways.map((c) => `vec3<f32>(${wgslFloat(c[0])},${wgslFloat(c[1])},${wgslFloat(c[2])})`).join(",") });
  return {
    name: "Wing",
    priority: 220,
    defines: { tint: colourways !== null },
    getCustomCode: (stage) =>
      stage === "vertex"
        ? { CUSTOM_VERTEX_MAIN_END: frameReads(WING_WGSL) + tint }
        : colourways === null ? null : { CUSTOM_FRAGMENT_BEFORE_LIGHTS: "surfaceAlbedo*=input.vWingTint*input.uv.x;" },
    getUniforms: () => ({ ubo: [{ name: "wingOmega", type: "f32", visibility: "vertex" as const }, { name: "wingHalfSpan", type: "f32", visibility: "vertex" as const }] }),
    getUniformBlocks: () => [shared],
    ...(colourways === null ? {} : { getVaryings: () => [{ name: "vWingTint", type: "vec3<f32>" as const }] }),
    writeUbo(data: Float32Array, offsets: UniformOffsets) {
      data[(offsets.get("wingOmega") as number) / 4] = omega;
      data[(offsets.get("wingHalfSpan") as number) / 4] = span;
    },
  };
}
