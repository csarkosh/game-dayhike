/**
 * Distance dither: the one fade every scenery instance
 * uses. A fragment-stage screen-door — the fragment is discarded when its
 * bucket's visibility at the instance's eye distance falls below a fixed
 * screen-space noise threshold — so a tuft, a bush or a tree never grows,
 * shrinks or pops: it thickens out of nothing, or thins into it, at a range
 * chosen per class where it is a few pixels. Replaces clutterFadePlugin.ts,
 * whose shrink-toward-the-base read as spawning.
 *
 * At a seam, TWO buckets draw the same pixel against the SAME noise sample
 * (the pattern is a fixed function of gl_FragCoord). A naive discard —
 * `n < visibility`, i.e. keep when `n < dfIn·dfOut` — makes the outgoing
 * bucket keep `n ≤ v` and the incoming bucket, tested the identical way,
 * ALSO keep `n ≤ v`: nested sets, not complementary ones, so at mid-seam
 * (v = 0.5 both ways) only half the noise values are drawn by either
 * bucket and the other half are drawn by both. The fix partitions instead
 * of duplicating the test: the incoming side's discard checks `1 − n`, so
 * outgoing keeps whenever `dfOut ≥ n` and incoming keeps whenever
 * `dfIn ≥ 1 − n` — complementary halves of every noise value, at every
 * pixel, for any mix of in/out visibility. The two keep-sets partition the
 * pixel exactly: no hole at mid-band, nothing drawn twice.
 *
 * The bands are a per-INSTANCE thin-instance attribute, `fadeBands`
 * (inStart, inEnd, outStart, outEnd): on- and off-lattice impostors share a
 * material but end at different ranges, and a tree that sits in two LOD
 * buckets inside a seam carries each bucket's bands. Every bucket writes a
 * constant per instance; the attribute is what makes one material serve.
 *
 * Renderer-only by design — no constant here may migrate into sim/ or a
 * tunables registry (the foliagePlugin.ts rule). Peers need not agree on it.
 *
 * Distance is measured from the instance ORIGIN (finalWorld[3]) in XZ, the
 * clutterFadePlugin measure, so a whole tuft or tree fades as one. The
 * vertex stage runs at CUSTOM_VERTEX_UPDATE_WORLDPOS (priority 205, after
 * the wind's 200) only to have finalWorld in scope; it writes two varyings.
 * The fragment stage discards at CUSTOM_FRAGMENT_MAIN_BEGIN, before any
 * texture fetch, so a dropped fragment costs nothing else.
 *
 * The shadow depth pass runs none of this (Babylon's shadowMap shader has
 * no fragment hook).
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";

/** (inStart, inEnd, outStart, outEnd) in metres from the eye. */
export type FadeBands = readonly [number, number, number, number];

/** A band that never fires. Two DISTINCT edges: smoothstep(e, e, x) is
 * undefined in GLSL, so a no-op band cannot be a degenerate one. Negative,
 * so every real distance is already past it; 1e8, so none reaches it. */
export const FADE_NONE_IN: readonly [number, number] = [-2, -1];
export const FADE_NONE_OUT: readonly [number, number] = [1e8, 2e8];
export const FADE_ALWAYS: FadeBands = [FADE_NONE_IN[0], FADE_NONE_IN[1], FADE_NONE_OUT[0], FADE_NONE_OUT[1]];

export function fadeBands(
  inBand: readonly [number, number] | null,
  outBand: readonly [number, number] | null,
): FadeBands {
  const i = inBand ?? FADE_NONE_IN;
  const o = outBand ?? FADE_NONE_OUT;
  return [i[0], i[1], o[0], o[1]];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The visibility DISTANCE_FADE_FRAGMENT computes: 0 before the in-band,
 * 1 between the bands, 0 at and beyond the out-band, smoothstep across each. */
export function fadeVisibility(dist: number, bands: FadeBands): number {
  return smoothstep(bands[0], bands[1], dist) * (1 - smoothstep(bands[2], bands[3], dist));
}

/** The GLSL discard predicate (`FADE_FRAGMENT_MAIN_BEGIN`), mirrored exactly:
 * `true` means the fragment is KEPT (not discarded) at this noise sample.
 * `smoothstep(bands.x, bands.y, dist)` is the in-band term and
 * `1 - smoothstep(bands.z, bands.w, dist)` the out-band term — NOT their
 * product (an earlier version had this bug): each is tested against noise on its
 * own side of the partition, `1 − noise` for the incoming (in-band) term, so
 * two buckets meeting at a seam keep complementary halves of every pixel
 * instead of nested or gapped ones. */
export function fadeKeeps(dist: number, bands: FadeBands, noise: number): boolean {
  const dfIn = smoothstep(bands[0], bands[1], dist);
  const dfOut = 1 - smoothstep(bands[2], bands[3], dist);
  return !(dfIn < 1 - noise || dfOut < noise);
}

/** The single-edge CPU sibling of `fadeVisibility`'s out-band half: 1 inside
 * `edgeStart`, 0 at and beyond `edgeEnd`, smoothstep between. Moved here from
 * the retired clutter edge-fade plugin — `wildlifeMeshes.ts`
 * still needs it: a pooled creature is a container CLONE sharing its
 * species' material, so it cannot carry the per-instance `fadeBands`
 * attribute this file's thin-instance path uses, and shrinks its own root
 * transform toward zero by this weight instead, on the CPU. */
export function fadeWeight(distance: number, edgeStart: number, edgeEnd: number): number {
  return 1 - smoothstep(edgeStart, edgeEnd, distance);
}

/** Interleaved gradient noise (Jimenez 2014) on pixel coordinates — a fixed
 * screen-space pattern, so the dissolve does not crawl as the camera moves. */
export function ign(x: number, y: number): number {
  const f = (v: number) => v - Math.floor(v);
  return f(52.9829189 * f(0.06711056 * x + 0.00583715 * y));
}

export function writeFadeBands(buf: Float32Array, offset: number, bands: FadeBands): void {
  buf[offset] = bands[0];
  buf[offset + 1] = bands[1];
  buf[offset + 2] = bands[2];
  buf[offset + 3] = bands[3];
}

// The attribute is declared under the plugin define only, the groundConform
// precedent: a non-instanced clone (the impostor bake clones LOD1) shares the
// material, and its draw must compile without a per-instance buffer. The
// varyings are always declared so the fragment stage always links.
const FADE_VERTEX_DEFS = `
#ifdef DISTANCEFADE
attribute vec4 fadeBands;
varying vec4 vFadeBands;
varying float vFadeDist;
#endif
`;

// finalWorld[3] is the instance origin only under THIN_INSTANCES; a
// non-instanced draw is always visible (the no-op bands), and its distance
// is irrelevant.
const FADE_VERTEX_WORLDPOS = `
#ifdef DISTANCEFADE
#ifdef THIN_INSTANCES
vFadeBands = fadeBands;
vFadeDist = distance(finalWorld[3].xz, fadeEye.xz);
#else
vFadeBands = vec4(-2.0, -1.0, 1.0e8, 2.0e8);
vFadeDist = 0.0;
#endif
#endif
`;

const FADE_FRAGMENT_DEFS = `
#ifdef DISTANCEFADE
varying vec4 vFadeBands;
varying float vFadeDist;
float dfNoise(vec2 p) {
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}
#endif
`;

const FADE_FRAGMENT_MAIN_BEGIN = `
#ifdef DISTANCEFADE
{
  float dfN = dfNoise(gl_FragCoord.xy);
  float dfIn = smoothstep(vFadeBands.x, vFadeBands.y, vFadeDist);
  float dfOut = 1.0 - smoothstep(vFadeBands.z, vFadeBands.w, vFadeDist);
  if (dfIn < 1.0 - dfN || dfOut < dfN) discard;
}
#endif
`;

export class DistanceFadePlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "DistanceFade", 205, { DISTANCEFADE: false });
    this._enable(true);
  }

  override getClassName(): string {
    return "DistanceFadePlugin";
  }

  // One line, for the eslint-disable reason foliagePlugin.ts records.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.DISTANCEFADE = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push("fadeBands");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string } {
    return {
      ubo: [{ name: "fadeEye", size: 3, type: "vec3" }],
      vertex: `
#ifdef DISTANCEFADE
uniform vec3 fadeEye;
#endif
`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    // From the camera, not a Babylon-internal uniform name (the
    // terrainTexture.ts precedent), so the fade cannot break on an engine rename.
    const eye = scene.activeCamera?.globalPosition;
    uniformBuffer.updateFloat3("fadeEye", eye?.x ?? 0, eye?.y ?? 0, eye?.z ?? 0);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return { CUSTOM_VERTEX_DEFINITIONS: FADE_VERTEX_DEFS, CUSTOM_VERTEX_UPDATE_WORLDPOS: FADE_VERTEX_WORLDPOS };
    }
    if (shaderType === "fragment") {
      return { CUSTOM_FRAGMENT_DEFINITIONS: FADE_FRAGMENT_DEFS, CUSTOM_FRAGMENT_MAIN_BEGIN: FADE_FRAGMENT_MAIN_BEGIN };
    }
    return null;
  }
}

/**
 * Attach only where a `discard` is already in the shader:
 * `material.needAlphaTesting()`
 * true, or `options.force`. A `discard` anywhere in a fragment shader
 * disables early depth rejection — and Apple TBDR hidden-surface removal —
 * for that whole draw, so attaching this plugin to an OPAQUE material does
 * not just cost its own branch: it makes every occluded fragment of that
 * material get fully shaded behind whatever sits in front of it. Paired
 * frame-time samples at 8.16× pixels (2026-09-03) measured the plugin on
 * every material at +10.7 ms roadside / +20 ms meadow over `main`; bisecting
 * instance counts changed nothing; restricting it to the 18 of 44 scene
 * materials that already alpha-test (foliage/grass/flower/bush cards,
 * understory, impostors — which discard regardless, so this plugin's added
 * discard is free) dropped those to +1.4 / +9.6.
 *
 * Opaque materials (bark, rock, boulder, driftwood, fungus) hand off to
 * their next LOD or impostor geometrically instead of by dither: mesh-to-mesh
 * at the LOD rings, or sub-pixel at their disc edges (rock
 * 2.8 px, boulder 4 px, fungus 1.7 px). `options.force` is the documented
 * escape hatch for the one exception judged worth the cost in practice:
 * `forestMeshes.ts`'s deadwood bucket forces it, because the LOD2 trunk to
 * billboard hand-off at 120 m is a visible pop otherwise on that one
 * material's ~24 instances (40-50 px at the hand-off — judged in-browser,
 * not measured by a pixel formula the way the disc-edge classes were).
 *
 * Idempotent either way: both LOD buckets of a clutter class share the
 * GLB's material, so attach is reached twice.
 */
export function attachDistanceFade(material: Material, options: { force?: boolean } = {}): void {
  if (material.pluginManager?.getPlugin("DistanceFade")) return;
  if (!options.force && !material.needAlphaTesting()) return;
  new DistanceFadePlugin(material);
}
