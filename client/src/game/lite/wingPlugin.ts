/**
 * A wing's beat as a material plugin on Babylon Lite: each wing turned about
 * its body's forward axis by amp·sin(ωt + phase), weighted by how far out
 * along the wing a vertex lies, so the body holds still and the tip moves
 * most (`wingParams.ts` has the numbers; `wingPlugin.ts` beside the game's
 * Babylon.js shells is the same stage in GLSL, and this is it statement for
 * statement). Position only: normals are left unturned, as there.
 *
 * What differs is where a bird's own numbers ride. On Babylon.js they are
 * a buffer of their own, two floats an instance. Lite sends a material's
 * per-instance data only when its draw is recorded again, and a flock's
 * beats change every frame; so here they ride in the instance's matrix,
 * in the three floats of its last row a placed thing leaves at zero: the
 * phase, the amplitude and, for the one model that wears them, which of
 * its colourways the instance is. The stage reads them there, turns the
 * vertex in the bird's own frame and places it by the matrix's other three
 * rows, so a flock costs its matrices a frame and nothing else.
 *
 * The clock is the frame's (`frameBlock.ts`): every wing reads one.
 */
import type { MaterialPlugin, PluginUniformBlock } from "@babylonjs/lite";
import { wingHalfSpan } from "../wingParams.js";
import { frameReads } from "./frameBlock.js";
import { wgslFloat } from "./forestPlugins.js";
import type { UniformOffsets } from "./pluginUniforms.js";

/** Where a bird's numbers ride in its instance's matrix: the last float of each of its first three columns. */
export const WING_PHASE_AT = 3;
export const WING_AMP_AT = 7;
export const WING_COLOURWAY_AT = 11;

/** The vertex stage's last step: `shaders`'s wing beat in the bird's own frame, then the place the matrix gives it. */
export const WING_WGSL = /* wgsl */ `{
let wingPhase=finalWorld[0].w;
let wingAmp=finalWorld[1].w;
var wingPos=position;
let wingSide=select(1.0,-1.0,wingPos.x<0.0);
let wingAbsX=abs(wingPos.x);
let wingSpan=clamp(wingAbsX/material.wingHalfSpan,0.0,1.0);
let wingA=wingAmp*sin(material.wingTime*material.wingOmega+wingPhase)*wingSpan;
let wingC=cos(wingA);
let wingS=sin(wingA);
let wingY0=wingPos.y;
wingPos.y=wingY0*wingC+wingAbsX*wingS;
wingPos.x=wingSide*(wingAbsX*wingC-wingY0*wingS);
let wingWorld=(finalWorld*vec4<f32>(wingPos,1.0)).xyz;
out.worldPos=wingWorld;
out.clipPos=scene.viewProjection*vec4<f32>(wingWorld,1.0);
}`;

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
  const tint = colourways === null ? "" : `{
let wingWay=u32(clamp(finalWorld[2].w,0.0,${wgslFloat(colourways.length - 1)}));
var wingTints=array<vec3<f32>,${colourways.length}>(${colourways.map((c) => `vec3<f32>(${wgslFloat(c[0])},${wgslFloat(c[1])},${wgslFloat(c[2])})`).join(",")});
out.vWingTint=wingTints[wingWay];
}`;
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
