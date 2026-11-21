/**
 * The sea's waves and shading in WGSL, statement for statement the game's
 * GLSL: what `oceanSurface.glsl`, `oceanSwash.glsl`,
 * `oceanDisplace.vertex.glsl`, `oceanShade.fragment.glsl`, the rain's rings of
 * `water.fragment.glsl` and the sea's halves of `waterLights.fragment.glsl` and
 * `waterCompose.fragment.glsl` say of the sea on the tiers that blend their
 * water over what lies under it (`seaPlugin.ts` hands these to Lite's PBR
 * material; the stages named are the recorded ones the tests hold them to).
 * The water's own definitions are `waterWgsl.ts`'s, which a lake reads too.
 * The text is in `shaders/sea/`, imported with `?raw`.
 *
 * What is written differently, and why:
 *
 * - **Uniforms** are read as `material.<name>` under the GLSL's names; the
 *   ones that move with the frame are the frame's (`frameBlock.ts`), and the
 *   plugin turns their reads to the block. Three of them are the sea's
 *   under names of their own, since a lake's material reads the same GLSL
 *   names with other values: its clock (`seaTime` for `waterTime`), the
 *   wind's direction integrated over the run (`seaWindTime` for
 *   `waterWindTime`) and the bump's drift (`seaBumpOffset`). The swell's
 *   components and the rings' records are arrays, which Lite lays out as
 *   vec4s of bits and the stage casts back.
 * - **The tables** (the swell's atlas, the swash's row) are 32-bit floats
 *   the GLSL reads at a texel's centre with a nearest sampler: here
 *   `textureLoad` at that texel.
 * - **A function's several results** are a struct it returns, where the
 *   GLSL writes them through `out` parameters.
 * - **A vertex is placed by the stage itself.** On Babylon.js a ring's mesh
 *   is made again when the ring moves and its vertices carry their place,
 *   their stitch to the coarser ring and the depth of water under them. Here
 *   the rings are one lattice made once (`seaLattice.ts`): a vertex carries
 *   its column, its row and its ring, the stage reads where the ring and
 *   its hole stand from the frame's block and works out the place and the
 *   stitch as `water.ts` does (`seaVertexAt` is the same arithmetic, held to
 *   `waterRingGeometry` by the tests), and the depth is read from a table a
 *   ring. A cell of the hole's frame that the finer ring covers is drawn as
 *   nothing: its four vertices are put at one point.
 * - **The first ripple octave** on the tier that draws the wind sea with it
 *   is the PBR material's own bump on Babylon.js. Here the plugin reads the
 *   same picture at the lattice's coordinate plus the drift and turns it on
 *   the frame Babylon.js derives from the screen's derivatives of the place
 *   and the coordinate about the ring's own normal, which is up
 *   (`SEA_BUMP_WGSL`), for the side seen from above.
 * - **The wind sea's field** is read only on the tiers that draw one: the
 *   loop's branch where the field is the baked loop, and before it the three
 *   cascades' branch on the tier whose field is computed each frame, which
 *   falls back to the loop where that cannot be had (`windSeaField.ts`). The
 *   cascades' slopes are read through the displacement's sampler, which is
 *   set as theirs is. Where no field is drawn its displacement and its
 *   slopes are nothing in the GLSL, and the statements that only scale them
 *   are left out.
 * - **The skin** is off on the sea (its share is 0), and its statements are
 *   left out; the roughness the GLSL writes over Babylon.js's own line is
 *   set where the sea's statements end, before Lite derives anything from
 *   it.
 * - **`mod`** is written out as `x - y * floor(x / y)`: WGSL's `%`
 *   truncates.
 *
 * - **The read of the frame behind the surface**, on the tier that draws
 *   its sea opaque over it, is `waterWgsl.ts`'s (`waterThroughWgsl`), in the
 *   place of the one alpha, in a look that reads `through`.
 *
 * Loads nothing.
 */
import { HOLE_CELLS } from "../clipmap.js";
import { WATER_RING_CELLS, WATER_RING_COUNT, WATER_UV_SCALE } from "../water.js";
import { waterThroughWgsl } from "./waterWgsl.js";
import fftConstsSource from "../shaders/sea/fftConsts.wgsl?raw";
import cascadesBranchSource from "../shaders/sea/cascadesBranch.wgsl?raw";
import surfaceCascadesSource from "../shaders/sea/surfaceCascades.wgsl?raw";
import surfaceLoopSource from "../shaders/sea/surfaceLoop.wgsl?raw";
import surfaceChopSource from "../shaders/sea/surfaceChop.wgsl?raw";
import surfaceSource from "../shaders/sea/surface.wgsl?raw";
import ringSource from "../shaders/sea/ring.wgsl?raw";
import holeSource from "../shaders/sea/hole.wgsl?raw";
import vertexSource from "../shaders/sea/vertex.wgsl?raw";
import lipShapeSource from "../shaders/sea/lipShape.wgsl?raw";
import lipVertexSource from "../shaders/sea/lipVertex.wgsl?raw";
import restVertexSource from "../shaders/sea/restVertex.wgsl?raw";
import rainSource from "../shaders/sea/rain.wgsl?raw";
import shadeCascadesSource from "../shaders/sea/shadeCascades.wgsl?raw";
import shadeLoopSource from "../shaders/sea/shadeLoop.wgsl?raw";
import shadeBumpSource from "../shaders/sea/shadeBump.wgsl?raw";
import shadeSource from "../shaders/sea/shade.wgsl?raw";
import bumpSource from "../shaders/sea/bump.wgsl?raw";
import albedoSource from "../shaders/sea/albedo.wgsl?raw";
import lightsWindSource from "../shaders/sea/lightsWind.wgsl?raw";
import lightsCapSource from "../shaders/sea/lightsCap.wgsl?raw";
import lightsSource from "../shaders/sea/lights.wgsl?raw";
import composeSource from "../shaders/sea/compose.wgsl?raw";
import { fill, wgsl } from "../shaders/shaderText.js";

/** What a tier's sea is drawn with beside its swell. */
export type SeaLook = {
  /** A field of the wind sea is read: the baked loop's branch is in the stages. */
  loop: boolean;
  /** The three cascades computed each frame are read too, before the loop (the tier that computes them; never without `loop`). */
  fft?: boolean;
  /** The ripple bump draws the wind sea (the tier with no field of it). */
  bump: boolean;
  /** The surface is opaque and reads the frame behind it (the tier that keeps that frame), in the place of the one alpha. */
  through?: boolean;
};

const mod = (x: string, y: string): string => `(${x}-${y}*floor((${x})/${y}))`;

/** The cascades' size and their tiles' lengths, metres (`oceanSpectrum.ts`). */
const FFT_CONSTS_WGSL = wgsl(fftConstsSource);

/**
 * The cascades' branch before the loop's, where the look reads them: `body`
 * while the wind sea's mode says the cascades are drawn, else the loop's
 * branch, which follows. Nothing where the look has no cascades.
 */
function cascadesBranch(look: SeaLook): (body: string) => string {
  return (body) => (look.fft === true ? fill(wgsl(cascadesBranchSource), { body }) : "");
}

/** `oceanSurface.glsl` and `oceanSwash.glsl`: the swell's sum, the wind sea's field and the swash's sheet, for both stages. */
export function seaSurfaceWgsl(look: SeaLook): string {
  const cascades = cascadesBranch(look);
  const loop = !look.loop ? "" : fill(wgsl(surfaceLoopSource), { fftConsts: look.fft === true ? FFT_CONSTS_WGSL : "", nextFrame: mod("(f0+1.0)", "LOOP_FRAMES"), cascadesDisplace: cascades(wgsl(surfaceCascadesSource)) });
  const displace = look.loop
    ? wgsl(surfaceChopSource)
    : `o.disp=sum.disp;`;
  return fill(wgsl(surfaceSource), { foamPhase: mod("(-crestPhase)", "OCEAN_TWO_PI"), rollPhase: mod("crestPhase", "OCEAN_TWO_PI"), loop, displace });
}

/** A lattice vertex's ring, where the ring and its hole stand, and the ring's spacing. */
const SEA_RING_WGSL = wgsl(ringSource);

/** A cell of the hole's frame that the finer ring covers, drawn as nothing: its four vertices at one point. */
const SEA_HOLE_WGSL = fill(wgsl(holeSource), { holeCells: HOLE_CELLS });

/**
 * The vertex stage's last step: the lattice's vertex placed on its ring
 * (`seaVertexAt`), then `oceanDisplace.vertex.glsl` on that place, and the
 * depth of water under it from its ring's table.
 */
export const SEA_VERTEX_WGSL = fill(wgsl(vertexSource), { ring: SEA_RING_WGSL, ringLast: WATER_RING_COUNT - 1, ringCells: WATER_RING_CELLS, ringMid: WATER_RING_CELLS / 2, holeCells: HOLE_CELLS, uvScale: WATER_UV_SCALE, hole: SEA_HOLE_WGSL });

/**
 * `oceanLipShape.vertex.glsl`: the plunging lip's strip, vertex definitions
 * after the sea's surface, on the strip's material alone. The crests the
 * strip draws (the tracker's state: a row a slot, a texel a column) and the
 * baked cross-section (a row a keyframe, a texel a vertex) are read at the
 * texel the GLSL's nearest read lands on.
 */
export const SEA_LIP_SHAPE_WGSL = wgsl(lipShapeSource);

/**
 * The strip's vertex, `oceanLip.vertex.glsl`, in place of the lattice's on the
 * strip's material: its position carries the column's world z, the slot and
 * the section's vertex, and `oceanLipPlace` makes the place from them. The
 * swell goes on to the fragment stage as the lattice hands it on, so the
 * sea's shading draws the strip unchanged; the strip carries no depth of
 * its own, which the fragment stage reads from the bed's square.
 */
export const SEA_LIP_VERTEX_WGSL = wgsl(lipVertexSource);

/**
 * The lattice's vertex at rest: on its ring at `level`, no wave on it. What
 * the rain's cover map draws the sea as, as the game draws its rings there
 * with the map's own material.
 */
export function seaRestVertexWgsl(level: number): string {
  return fill(wgsl(restVertexSource), { ring: SEA_RING_WGSL, level: level.toFixed(4), hole: SEA_HOLE_WGSL });
}

/** The rain's rings of `water.fragment.glsl`, the puddles' own: the sea's. */
export const SEA_RAIN_WGSL = fill(wgsl(rainSource), { rainTime: mod("material.seaTime", "3600.0") });

/** `oceanShade.fragment.glsl`: the white water, the whitecaps, the wind sea's slopes and the plunging lip. */
export function seaShadeWgsl(look: SeaLook): string {
  const cascades = cascadesBranch(look);
  const loop = !look.loop ? "" : fill(wgsl(shadeLoopSource), { cascadesSlopes: cascades(wgsl(shadeCascadesSource)), crestKeepBranch: look.fft === true ? "if(material.oceanCoast.w>1.5){return oceanWindPixelKeep(FFT_CASCADE_1,FFT_N,pixel);}\n  " : "" });
  const bump = !look.bump ? "" : wgsl(shadeBumpSource);
  return fill(wgsl(shadeSource), { capCycle: mod("k", "OCEAN_CAP_CYCLES"), capClock: mod("material.seaTime", "(OCEAN_CAP_CYCLES*OCEAN_CAP_PERIOD)"), bump, loop, aheadPhase: mod("(crestPhase+0.5*OCEAN_TWO_PI)", "OCEAN_TWO_PI") });
}

/**
 * The first ripple octave under the sea that draws its wind sea with it:
 * the bump's picture at the lattice's coordinate plus the drift, turned on
 * the frame Babylon.js builds for a normal map with no tangents (the
 * screen's derivatives of the place and of the coordinate, about the ring's
 * own normal, which is up; a derivative down the screen taken the other way
 * round, as Babylon.js's are), and left as the lighting normal. The albedo
 * is taken back to the base colour, which is what Babylon.js hands that
 * point.
 */
export const SEA_BUMP_WGSL = wgsl(bumpSource);

/** Where no bump is read: the albedo taken back to the base colour alone. */
export const SEA_ALBEDO_WGSL = wgsl(albedoSource);

/** The sea's half of `waterLights.fragment.glsl`, its water blended or read through as the look says, then the roughness of the slope variance its normal leaves undrawn. */
export function seaLightsWgsl(look: SeaLook): string {
  const wind = look.loop
    ? wgsl(lightsWindSource)
    : `let wSurfaceHeight=wOceanHeight;`;
  const steep = look.loop ? `let wWindSteep=wWindAmp*oceanWindSlopeLimit(material.oceanWindDir.z,wOceanChop,wWindDrawn*wWindAmp*wWindAmp);` : "";
  const extra = [
    ...(look.bump ? ["N.xz/max(N.y,0.05)*oceanBumpScale(wWindShare,wOceanFoam.y,wOceanChop)"] : []),
    ...(look.loop ? ["wWindSlope*wWindSteep"] : []),
  ].join("+") || "vec2<f32>(0.0)";
  const variance = look.loop ? "wOceanDrawn+wWindDrawn*wWindSteep*wWindSteep" : "wOceanDrawn";
  const cap = look.loop
    ? wgsl(lightsCapSource)
    : `wOceanCap=oceanCapCells(input.vOceanXZ,wOceanPixel,wWindShare);`;
  return fill(wgsl(lightsSource), { wind, steep, extra, variance, through: look.through === true ? waterThroughWgsl(false) : `
alpha=1.0-(1.0-wF)*exp(-2.0*wKdMean*wDepth);`, cap, transmit: look.through === true ? `
wTransmit*=1.0-wFoam;` : "" });
}

/**
 * `waterCompose.fragment.glsl` on the sea: the white water held matte; then
 * the lit colour summed again from its parts, which Lite has summed already
 * by this point.
 */
export const SEA_COMPOSE_WGSL = wgsl(composeSource);
