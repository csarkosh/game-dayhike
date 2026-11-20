/**
 * The water's shading in WGSL, statement for statement the game's GLSL: what
 * `water.fragment.glsl`, `lakeRipples.fragment.glsl`,
 * `lakeMirror.fragment.glsl`, `waterLights.fragment.glsl` and
 * `waterCompose.fragment.glsl` say of a lake on the tiers that blend their
 * water over what lies under it (`lakePlugin.ts` hands these to Lite's PBR
 * material; the stages named are the recorded ones the tests hold them to).
 * The text is in `shaders/water/`, imported with `?raw`.
 *
 * What is written differently, and why:
 *
 * - **Uniforms** are read as `material.<name>` under the GLSL's names; the
 *   ones every lake reads alike are the frame's (`frameBlock.ts`), and the
 *   plugin turns their reads to the block.
 * - **The bed's square and the skyline** are 32-bit floats read at the
 *   nearest texel, which WGSL does with `textureLoad` at a whole texel: the
 *   texel a nearest read of the GLSL's coordinate lands on, clamped at the
 *   picture's edges as its sampler clamps.
 * - **The first ripple octave** is the PBR material's own bump on
 *   Babylon.js, drifting by its texture's offset. Here the plugin reads the
 *   same picture at the mesh's coordinate plus the drift
 *   (`waterBumpOffset`) and turns it on the surface's frame itself
 *   (`WATER_BUMP_WGSL`): on a level surface whose coordinates run with the
 *   world's x and z, the frame Babylon.js derives from the screen's
 *   derivatives is those two axes, each turned over, for the side seen
 *   from above.
 * - **The environment's intensity** (`vLightingIntensity.z`) is drawn into
 *   the sky's capture here (`skyCapture.ts`), so the probe's radiance is
 *   read as it is and the skyline's shade arrives already scaled by it.
 * - **The split of the base colour** into albedo and F0 follows the plugin's
 *   statements, as Babylon.js's reflectivity block follows its plugin point:
 *   water's F0 is half the dielectric's, its grazing reflectance that half.
 * - **`mod`** is written out as `x - y * floor(x / y)`: WGSL's `%`
 *   truncates.
 *
 * - **The frame behind the surface**, on the tier that draws its water
 *   opaque over it (`waterThroughWgsl`), is the frame as the opaque draws
 *   left it (`waterBehind.ts`): its colour read through a filtering sampler
 *   at the fragment's own place moved by the ripples, which the GLSL finds
 *   by `waterScreen` and this by the picture's own size; its depth read at
 *   the fragment's own texel, as stored, and turned into a distance along
 *   the view by the two terms of the frame's projection (Lite's depth runs
 *   from 1 at the near plane to 0), where the GLSL linearises Babylon.js's
 *   by the camera's near and far. A picture is laid top row first here and
 *   bottom row first there, so the ripples' move down the picture is taken
 *   the other way. `waterHigh` is no uniform: a tier's material is the one
 *   or the other, and carries only its own branch.
 *
 * - **The mirror's picture** (`LAKE_MIRROR_WGSL`) is laid top row first and
 *   turned over left to right against the one Babylon.js draws (the pass
 *   is drawn through a camera of the ordinary kind, `mirrorPass.ts`), so a
 *   read at the GLSL's coordinate is made at one less each of its two; and
 *   the frame's height the smear is measured in is the frame's block's
 *   (`fadeRows`), where the GLSL has its reciprocal in `waterScreen`.
 *
 * Left out, as nothing here reads them: the cat's-paws' mask (`lakePaw`,
 * `lakePawThreshold`), which the GLSL keeps and no longer calls. The lens
 * of the second octave and the read of the frame behind the surface are a
 * material's only on the tier that draws its water opaque, the mirror's
 * read only on the tier that draws a mirror, and the shore's panorama only
 * where it is handed one (`LAKE_PANORAMA_WGSL`, `lakeComposeWgsl`): a tier
 * carries neither the read nor the picture of what it does not draw.
 *
 * Loads nothing.
 */
import { CAUSTIC_DEPTH_M, CAUSTIC_GAIN, CAUSTIC_MAX, LENS_STEP_M } from "../lakeRipples.js";
import { SKYLINE_TEXELS } from "../lakeSkyline.js";
import { LAKE_MOTION_SMEAR_CAP, MIRROR_DEPTH_FULL } from "@csarkosh/engine/game/mirrorView";
import { PANORAMA_EYE_UP, PANORAMA_HEIGHT_M } from "../panoramaTurn.js";
import { WATER_F0 } from "@csarkosh/engine/game/waterShading";
import vertexSource from "../shaders/water/vertex.wgsl?raw";
import defsSource from "../shaders/water/defs.wgsl?raw";
import throughDefsSource from "../shaders/water/throughDefs.wgsl?raw";
import lakeLensSource from "../shaders/water/lakeLens.wgsl?raw";
import throughLensSource from "../shaders/water/throughLens.wgsl?raw";
import throughSource from "../shaders/water/through.wgsl?raw";
import lakeRipplesSource from "../shaders/water/lakeRipples.wgsl?raw";
import lakeShoreSource from "../shaders/water/lakeShore.wgsl?raw";
import lakePanoramaSource from "../shaders/water/lakePanorama.wgsl?raw";
import lakeMirrorSource from "../shaders/water/lakeMirror.wgsl?raw";
import bumpSource from "../shaders/water/bump.wgsl?raw";
import lakeLightsSource from "../shaders/water/lakeLights.wgsl?raw";
import splitSource from "../shaders/water/split.wgsl?raw";
import lakeMirrorReadSource from "../shaders/water/lakeMirrorRead.wgsl?raw";
import lakeComposeSource from "../shaders/water/lakeCompose.wgsl?raw";
import { fill, wgsl } from "@csarkosh/engine/game/shaders/shaderText";
import throughFinalSource from "../shaders/water/throughFinal.wgsl?raw";

/** Babylon.js's dielectric F0 at an F0 factor of 1: water's F0 is the factor's share of it. */
const PBR_DIELECTRIC_F0 = 0.04;

/** The lake's varyings from the vertex stage: the bed's depth under the vertex and the vertex's view depth, metres. */
export const WATER_VERTEX_WGSL = wgsl(vertexSource);

/** `water.fragment.glsl`: the bed's depth, the horizon-safe normal and the skin. */
export const WATER_DEFS_WGSL = fill(wgsl(defsSource), { splitRatio: (WATER_F0 / PBR_DIELECTRIC_F0).toFixed(4) });

/** `water.fragment.glsl`'s numbers of the read through the surface: how far a ripple bends the read, over what depth of water. */
export const WATER_THROUGH_DEFS_WGSL = wgsl(throughDefsSource);

/** `lakeRipples.fragment.glsl`'s lens: the second octave's tilt's divergence a metre, which lights the bed under a lake that is read through. */
export const LAKE_LENS_WGSL = fill(wgsl(lakeLensSource), { lensStepM: LENS_STEP_M.toFixed(4), causticGain: CAUSTIC_GAIN.toFixed(2), causticMax: CAUSTIC_MAX.toFixed(1), causticDepthM: CAUSTIC_DEPTH_M.toFixed(1) });

/**
 * `waterLights.fragment.glsl`'s branch of the tier that reads through its
 * surface, in the place of the one alpha: the bed's light through the water,
 * read from the frame kept behind it and bent by the ripples, dimmed by the
 * metres of water it comes through; the water's own colour only where the
 * bed is not seen; and the surface written whole. On a `lake` the bed is lit
 * by the second octave's lens. `wTransmit` is added after the fog
 * (`WATER_THROUGH_FINAL_WGSL`).
 */
export function waterThroughWgsl(lake: boolean): string {
  return fill(wgsl(throughSource), { lensBed: lake ? wgsl(throughLensSource) : "" });
}

/** `waterFinal.fragment.glsl`: the bed's light, added past the surface's own haze, since the frame it is read from is hazed already. */
export const WATER_THROUGH_FINAL_WGSL = wgsl(throughFinalSource);

/** `lakeRipples.fragment.glsl`: the breeze's field, the octaves' amplitude, the rain's rings and the second octave. */
export const LAKE_RIPPLES_WGSL = wgsl(lakeRipplesSource);

/** `lakeMirror.fragment.glsl`'s shore on the tiers with no mirror: the skyline's shade under the treeline. */
export const LAKE_SHORE_WGSL = fill(wgsl(lakeShoreSource), { skylineTexels: SKYLINE_TEXELS });

/**
 * `lakeMirror.fragment.glsl`'s shore on the tier with a panorama: the picture
 * of the shore where the reflected ray meets the cylinder of the lake's
 * radius under the skyline and the capture drew something, the fallback
 * elsewhere. The picture is laid top row first, as a pass writes it here,
 * so a hit's height over the level is read down from the picture's last
 * row where the GLSL reads it up from its first; the skyline is read at the
 * hit's own azimuth.
 */
export const LAKE_PANORAMA_WGSL = fill(wgsl(lakePanoramaSource), { panoramaHeightM: PANORAMA_HEIGHT_M.toFixed(1), panoramaEyeUp: PANORAMA_EYE_UP.toFixed(1) });

/**
 * `lakeMirror.fragment.glsl`'s mirror, on the tier that draws one: where a
 * point of the surface is read in the picture (its place in the mirrored
 * camera's view, moved by the ripple's slope and never up the screen), one
 * read of it, and the four reads down the screen that smear it.
 */
export const LAKE_MIRROR_WGSL = fill(wgsl(lakeMirrorSource), { mirrorDepthFull: MIRROR_DEPTH_FULL.toFixed(1), lakeMotionSmearCap: LAKE_MOTION_SMEAR_CAP.toFixed(2) });

/**
 * The first ripple octave: the bump's picture at the mesh's coordinate plus
 * the drift, turned on the level surface's frame (the world's x and z, each
 * turned over, as Babylon.js's frame comes out for the side seen from
 * above) and left as the lighting normal, as Babylon.js's PBR leaves it
 * before the plugin's point. The albedo is taken back to the base colour, which is
 * what that point is handed there.
 */
export const WATER_BUMP_WGSL = wgsl(bumpSource);

/**
 * `waterLights.fragment.glsl` on a lake: its depth, its ripples and its skin, and
 * either the one alpha its water is blended by or, `through`, the read of
 * the frame behind it.
 */
export function lakeLightsWgsl(through: boolean): string {
  return fill(wgsl(lakeLightsSource), { blend: through ? waterThroughWgsl(true) : `
alpha=1.0-(1.0-wF)*exp(-2.0*wKdMean*wDepth);`, skin: through ? `
  wTransmit*=1.0-wSkin;` : "" });
}

/** A lake's lights where its water is blended over what lies under it. */
export const LAKE_LIGHTS_WGSL = lakeLightsWgsl(false);

/**
 * What Babylon.js's own PBR does after the plugin's point and Lite's did
 * before it: the view's angle on the normal the statements above left, and
 * the split of the base colour by water's F0 (the dielectric's times the
 * material's F0 factor, which is also its grazing reflectance).
 */
export const WATER_SPLIT_WGSL = wgsl(splitSource);

/**
 * `waterCompose.fragment.glsl` on a lake: the shore in place of the probe's
 * radiance, and the skin held matte; then the lit colour summed again from
 * its parts, which Lite has summed already by this point. With a
 * `panorama` the shore is the picture's where the lake is the one it is
 * of (`waterPanoramaOn`, 0 or 1, which the GLSL mixes by: here the read is
 * not made where it would be dropped). With a `mirror` it is the mirror's
 * image where its pass drew something, smeared by the cat's-paws and by the
 * eye's travel over the frames the picture is held.
 */
export function lakeComposeWgsl(panorama: boolean, mirror = false): string {
  return fill(wgsl(lakeComposeSource), { mirrorRead: mirror ? wgsl(lakeMirrorReadSource) : "", shoreDeclaration: panorama || mirror ? "var" : "let", panoramaRead: panorama ? `
  if(material.waterPanoramaOn>0.5){wShore=waterPanoramaRadiance(input.worldPos,wShoreRay,wShore);}` : "", mirrorMix: mirror ? `
  wShore=mix(wShore,wMirror.rgb,step(0.5,material.waterMirrorOn)*wMirror.a);` : "" });
}

/** The compose of a lake with no panorama. */
export const LAKE_COMPOSE_WGSL = lakeComposeWgsl(false);
