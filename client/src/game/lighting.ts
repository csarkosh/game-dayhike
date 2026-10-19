import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
// Non-`.pure` imports, and it is load-bearing. Babylon 9 splits each of these
// into a `.pure.js` half that defines behaviour and a wrapper that registers it.
// `cascadedShadowGenerator.js` calls RegisterCascadedShadowGenerator();
// `reflectionProbe.js` calls RegisterReflectionProbe(). Import the `.pure` paths
// instead and there is no error and no shadows — the same failure mode that cost
// hours on thin instances in `renderer.ts`.
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator.js";
import { installSoftShadows } from "./softShadowInclude.js";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { ReflectionProbe } from "@babylonjs/core/Probes/reflectionProbe.js";

import { QUALITY, type QualitySettings, type QualityTier } from "./quality.js";
import { sunPositionAt } from "./sky.js";
import { NOON_ALTITUDE_DEG, type SkyTable } from "./skyTable.js";
import { SKY_IBL_SCALE, skyStateFor, type SkyState } from "./skyState.js";
import { createSkyDome } from "./skyDome.js";
import { sightUnder } from "./gradeParams.js";
import {
  DEFAULT_WEATHER,
  WEATHER_PRESETS,
  weatherFadeAt,
  type WeatherParams,
  fogDensityUnder,
  shadowDarknessUnder,
  exposureUnder,
  ambientCollapseUnder,
} from "./weather.js";

/** Matches the `/time` command's `defaultValue` in `commands.ts`. */
export const DEFAULT_HOUR = 12;

/** Cube face resolution for the environment probe. */
const PROBE_SIZE = 128;

/**
 * The sun's altitude at `hour`, in degrees: the altitude the sky's table is
 * read at. Below the lowest slice the table serves the lowest slice
 * (`sliceBracket`), so the deep night needs no slice of its own.
 */
export function sunAltitudeDeg(hour: number): number {
  return (Math.asin(sunPositionAt(hour).y) * 180) / Math.PI;
}

/**
 * Whether `table` holds what the sky state at `hour` is made from: the
 * slices either side of noon, which fix the scale and the adaptation, and
 * those either side of the hour's sun.
 */
export function skyHeld(table: SkyTable, hour: number): boolean {
  return table.has(NOON_ALTITUDE_DEG) && table.has(sunAltitudeDeg(hour));
}

/** How long a wait for the sky goes on before it says so in the console. */
export const SKY_WAIT_WARN_MS = 10_000;

/**
 * Resolves once `skyHeld(table, hour())` holds. `hour` is read again at every
 * slice that arrives, so an hour changed while the first slices are made is
 * the one waited for. Still waiting `SKY_WAIT_WARN_MS` after it began, it
 * warns once, and waits on: a page whose slices never come is held, not shown
 * unlit, but not in silence. Once `options.signal` is aborted it stops
 * listening to the table and never resolves: what waited on it has gone.
 */
export function whenSkyHeld(table: SkyTable, hour: () => number, options: { signal?: AbortSignal } = {}): Promise<void> {
  return new Promise((resolve) => {
    const signal = options.signal;
    if (signal?.aborted) return;
    if (skyHeld(table, hour())) {
      resolve();
      return;
    }
    const warning = setTimeout(() => {
      console.warn(`the sky's slices have not arrived after ${SKY_WAIT_WARN_MS / 1000} s; still waiting for them`);
    }, SKY_WAIT_WARN_MS);
    const stop = (): void => {
      off();
      clearTimeout(warning);
      signal?.removeEventListener("abort", stop);
    };
    const off = table.onChange(() => {
      if (!skyHeld(table, hour())) return;
      stop();
      resolve();
    });
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/**
 * How far cascaded shadows reach, in metres. Deliberately NOT `viewDistance`.
 *
 * The two were one number while the fog horizon was 70 m and the difference did
 * not exist. It does now: the fog reaches 4 km, and feeding that to
 * `shadowMaxZ` stretches the same four cascades across 57× the depth. Babylon
 * splits the frustum at `lambda·log + (1-lambda)·uniform` (`_splitFrustum`),
 * and with the camera's 0.05 m near plane the log term is negligible, so the
 * first cascade's extent tracks `shadowMaxZ` almost linearly: 2.0 m at 70 m,
 * 100.8 m at 4000 m. That is a ~50× coarser near-field shadow texel, spent
 * entirely on shadows kilometres away that 4 km of haze has already washed
 * flat. At 300 m the first cascade is 7.9 m — 3.9× the texel the `normalBias`
 * below was tuned against, rather than 49.7×.
 *
 * A few hundred metres is the useful shadow range at any view distance: cast
 * shadows read at human and boulder scale, while a mountain's own form comes
 * from its normals and the sun angle, not from the shadow it throws on the next
 * ridge.
 */
const SHADOW_DISTANCE = 300;
/** Since 2026-10-15 the reach and the split are the tier's
 * (`QualitySettings.shadowDistance`, `shadowLambda`): medium keeps the
 * 300 m above at lambda 0.9; high reaches 1500 m over three cascades at
 * lambda 0.97, which split at about 16.5 m of camera depth (Babylon's
 * split with the 0.05 m near plane: 0.97 × 1.55 + 0.03 × 500) and 77 m,
 * so the near field keeps a texel finer than the 18.5 m slice the bias
 * below was tuned against, the middle distance a 4 cm one, and the far
 * field's hillsides and tree lines keep their shadows at 70 cm. The
 * distance above is what medium reads. */

/**
 * The sun's size for the soft-edged shadows, in the shadow map's UV units:
 * Babylon's `contactHardeningLightSizeUVRatio`, the light's width over the
 * first cascade's world extent.
 *
 * The sun subtends about 0.53°, so a caster `d` metres above the ground
 * throws a penumbra `d × tan(0.53°)` ≈ 0.0093 d metres wide: 28 mm under a
 * branch 3 m up, 19 cm under a canopy 20 m up. Babylon's percentage-closer
 * soft shadow sizes its filter as a radius over a unit disc of taps,
 * `(Δdepth + 10 texels) × ratio` of the map's extent, where Δdepth is the
 * receiver's depth less the average blocker's, over the first cascade's depth
 * range in the light's view (the other cascades are scaled to it). So the
 * penumbra's radius in metres is `Δz × ratio × X / Z`, with `X` the first
 * cascade's width and `Z` its depth range, and the sun's is
 * `ratio = tan(0.265°) × Z / X` ≈ 0.00463 Z / X.
 *
 * `X` follows the reach: medium's two cascades at lambda 0.9 split 300 m at
 * 18.5 m of camera depth, and the stabilised first cascade is the sphere
 * round that slice of the 1.4 rad frustum, 66 m across in a 16:9 window
 * (41 m in a window twice as tall as wide), 32 mm a texel at 2048. `Z` is not
 * the slice's: without depth clamping, which the soft shadow turns off to
 * keep true distances, the light's near plane is pushed back to hold every
 * caster, and the clipmap's outer rings reach 4 km from the camera, so `Z`
 * is their reach up-sun: about 1.4 km at noon, with the sun 76° up, 4.5 km
 * at 08:00 and 16:00 at 29°. At noon in a 16:9 window the sun is
 * 0.00463 × 1400 / 66 ≈ 0.1 (Babylon's default, by coincidence): a penumbra
 * of 14 mm radius, 28 mm wide, at 3 m, over a floor of one texel at the
 * contact. The same ratio is a third of the sun's at 08:00, and 1.6× it in
 * the tall window; a value set once cannot follow both. The blocker search
 * runs over the same ratio of the map, 6.6 m round the sample at noon with
 * sixteen fixed taps, the nearest 0.55 m out, so a caster narrower than the
 * taps' spacing can go unfound, and a receiver that finds no blocker is lit:
 * what to look at in the browser is the shadows of trunks, rocks and fronds
 * at the contact, not only the softness under the canopy.
 */
export const SUN_LIGHT_SIZE_UV = 0.15;

/* Amended 2026-10-15 with the high tier's three cascades to 1500 m: the
 * first cascade's slice is 16.5 m of camera depth, so `X` is about 59 m in a
 * 16:9 window and the sun's ratio at noon 0.00463 × 1400 / 59 ≈ 0.11; 0.15
 * widens the penumbra a little past that, toward the soft edge a cast
 * shadow has under real sky at a few metres. */
/** What the shadow generator filters with, by tier: the plain
 * percentage-closer filter at Babylon's default quality (a 5×5 texel
 * kernel, nine hardware-compared taps), or the percentage-closer soft shadow
 * with the sun's size at the quality given. */
export type ShadowFilter =
  | { readonly filter: "pcf" }
  | { readonly filter: "pcss"; readonly quality: number; readonly lightSizeUV: number };

/**
 * The shadow filter a tier's settings ask for. The soft shadow takes
 * `ShadowGenerator.QUALITY_MEDIUM`: on Babylon's cascaded path that is
 * sixteen search taps and thirty-two filter taps a sample. The low quality
 * is sixteen and sixteen, which leaves the filter under a canopy, six texels
 * across, speckled; the high quality's thirty-two and sixty-four is twice
 * the reads for a filter whose radius at the contact is one texel. Pure, so
 * a test can read it where the generator itself cannot be built
 * (`CascadedShadowGenerator.IsSupported` is false under NullEngine).
 */
export function shadowFilterFor(settings: Pick<QualitySettings, "shadowSoftEdges">): ShadowFilter {
  return settings.shadowSoftEdges
    ? { filter: "pcss", quality: ShadowGenerator.QUALITY_MEDIUM, lightSizeUV: SUN_LIGHT_SIZE_UV }
    : { filter: "pcf" };
}

/**
 * How far a caster reaches into the cascades. `far`: every cascade, for the
 * ground, the far field's clipmap, the trees and the cliffs, whose shadows
 * are read kilometres off. `near`: every cascade but the farthest where the
 * reach is long (`farCascadeIndex`), for the small casters, the rock
 * patches, the signs, the animals and the boulders, a metre or three across:
 * the farthest cascade of a 1500 m reach has a texel of 0.6 m, which draws
 * such a shadow as a speck or not at all, and drawing 650 of them into it
 * three times a frame was a third of the high tier's draw calls (2026-10-18:
 * 2163 a frame at the meadow, 676 casters, three cascades).
 */
export type ShadowReach = "near" | "far";
/** A reach (m) from which the farthest cascade is coarser than a small caster. */
export const FAR_CASCADE_REACH_M = 500;

/** The index of the cascade the near casters are left out of, or -1 where every cascade takes them: the last of two or more cascades reaching `FAR_CASCADE_REACH_M` or more. */
export function farCascadeIndex(settings: Pick<QualitySettings, "shadowMapSize" | "shadowCascades" | "shadowDistance">): number {
  if (settings.shadowMapSize <= 0 || settings.shadowCascades < 2 || settings.shadowDistance < FAR_CASCADE_REACH_M) return -1;
  return settings.shadowCascades - 1;
}

/** The casters of `list` (its first `length`) that are not near-only: the farthest cascade's own list. */
export function farCasters(list: readonly AbstractMesh[], length: number, nearOnly: ReadonlySet<AbstractMesh>): AbstractMesh[] {
  const out: AbstractMesh[] = [];
  for (let i = 0; i < length && i < list.length; i++) {
    const mesh = list[i] as AbstractMesh;
    if (!nearOnly.has(mesh)) out.push(mesh);
  }
  return out;
}

/**
 * The least of the sun's light a cast shadow keeps: the shadow generator's
 * darkness (0 a black shadow, 1 none) never falls under this. With the
 * weather's own darkness at 0 under a clear sky, a shadowed face had only the
 * sky's light, and on the steep faces the shadows of the relief's joints
 * and slabs read as noise. Measured from the sky state, the image-based light
 * as the dome's irradiance over π and the sun as PBR's diffuse, a face
 * leaning 55° toward the sun, shadowed, kept 34 %, 36 % and 32 % of its lit
 * value at 08:00, noon and 15:00, and level ground 35 %, 25 % and 29 %; at
 * 0.17 the face keeps 45 %, 47 % and 43 %, the ground 46 %, 38 % and 41 %.
 * It is the generator's, so it holds for every receiver, not the faces
 * alone. Cloud lightens the shadows already: bright weather's 0.45 is above
 * it and keeps its own, as does every weather past it.
 */
export const SHADOW_FLOOR = 0.17;

/** The shadow generator's darkness under `w`: the weather's, held at
 * SHADOW_FLOOR or above. */
export function sunShadowDarkness(w: WeatherParams): number {
  return Math.max(SHADOW_FLOOR, shadowDarknessUnder(w));
}

export type LightingOptions = {
  tier: QualityTier;
  /** Distance at which fog has all but hidden the world, in metres. */
  viewDistance: number;
  hour?: number;
  weather?: WeatherParams;
  /**
   * Who owns colour. `"post"`: the grade pass tone-maps, grades and
   * vignettes, so materials output linear HDR (`applyByPostProcess`).
   * `"material"`: no post chain exists (low tier, or no float targets), so
   * Babylon's in-material processing carries the intent with Khronos Neutral,
   * the colour curves and dithering. Decided by `postFeaturesFor` in
   * postParams.ts before either this or the post chain is built.
   */
  colourPath: "post" | "material";
  /**
   * The sky's slices (`skyTable.ts`), filled off the main thread by whoever
   * made the table (`skyWorker.ts`). Nothing of the sky is applied until the
   * table holds the slices either side of noon and of the hour (`skyHeld`);
   * a slice that arrives while that waits tries again.
   */
  sky: SkyTable;
};

export type Lighting = {
  setHour(hour: number): void;
  readonly hour: number;
  /**
   * Starts a fade from the current weather to `next` over `fadeSeconds`
   * (default 3 s). `0` (or negative) applies instantly, with no observer tick
   * required — see the mutation check in `lighting.test.ts` for why that
   * distinction is load-bearing.
   */
  setWeather(next: WeatherParams, fadeSeconds?: number): void;
  /**
   * Sets the hour and the weather together, the weather at once as
   * `setWeather(next, 0)` sets it (ending any fade), and applies once: for a
   * caller that moves both in one frame (the escalation's chase, a swap
   * putting the view back), where `setHour` then `setWeather` would apply,
   * and re-capture the probe, twice.
   */
  setView(hour: number, weather: WeatherParams): void;
  /**
   * The local player's stare (hollow.ts), handed in every frame. On the
   * material path the frame's exposure is the weather's and the hour's
   * times what the stare leaves (`sightUnder`), written here and at every
   * apply, so a weather fade, which applies as each render starts, keeps
   * the stare's dimming. On the post path the grade pass dims by the stare
   * instead, and this changes nothing.
   */
  setStare(stare: number): void;
  /** A copy of the current, possibly mid-fade, weather parameters. */
  readonly weather: WeatherParams;
  /**
   * The sky state of the last apply (`skyStateFor`), a new object each
   * apply: what the dome drew and what the haze and the grade read. Null
   * until the table first holds the slices either side of noon and of the
   * hour.
   */
  readonly sky: SkyState | null;
  readonly shadows: CascadedShadowGenerator | null;
  /** The direction the sun's light travels (the directional light's own
   * vector, live, not a copy): the negation of the direction to the sun. */
  readonly sunDirection: Vector3;
  /**
   * Registers `mesh` as a shadow caster and marks it as a receiver too.
   *
   * In this scene a mesh that casts almost always should also receive: a
   * boulder or a tree trunk standing inside another object's shadow needs to
   * show it, not stay fully lit. Terrain is the one caller that also sets
   * `receiveShadows` itself, directly on the mesh in `createClipmapMesh`,
   * because that function is tested without a `Lighting` in the loop — this
   * still runs for it too, redundantly but harmlessly, when the renderer
   * wires it up as a caster.
   */
  addShadowMesh(mesh: AbstractMesh, reach?: ShadowReach): void;
  /**
   * Takes a mesh back out of the shadow map. Needed because Babylon's
   * `AbstractMesh.dispose` does NOT remove the mesh from a shadow generator's
   * render list, so anything whose meshes come and go — the pooled wildlife
   * creatures, which are acquired and released as the player walks — would
   * otherwise leave the generator holding every disposed animal forever.
   * Leaves `receiveShadows` alone: it describes the mesh, not the registry,
   * and a mesh that stops casting still receives.
   */
  removeShadowMesh(mesh: AbstractMesh): void;
  /**
   * Releases the objects this created: the sky dome, the sun and fill
   * lights, the shadow generator and the reflection probe, and stops
   * listening to the sky's table, which outlives it. It does not restore the
   * scene state it borrowed and mutated in place — fog mode, density and
   * colour, clear colour, tone-mapping enabled/type/contrast, exposure, and
   * the engine's hardware scaling are the caller's to reset, because
   * `createLighting` never held them, only set them. In practice the renderer
   * disposes the whole `Scene` on teardown, so restoring here would be dead
   * code; if that ever stops being true, restoring becomes this function's
   * job too.
   */
  dispose(): void;
};

/**
 * Everything that turns a scene from flat to lit: the scattering sky's dome,
 * a sun with cascaded shadows, image-based ambient captured from that dome,
 * aerial perspective tinted to match, and one of two colour paths — the grade
 * pass on `"post"`, Babylon's own Khronos Neutral tone mapping and colour
 * curves on `"material"` — chosen by `postFeaturesFor` in postParams.ts.
 *
 * This is the Babylon shell. Every number it applies comes from the sky state
 * (`skyState.ts`, made from the table's slices), `weather.ts` and
 * `quality.ts`, which are pure and tested; what is left here is wiring, and
 * the traps are in the wiring rather than the arithmetic.
 *
 * On the sky, there are two valid paths and this is the development
 * one: a dynamic sky captured to a reflection probe, which is what lets the sun
 * move. Shipped levels are to use a baked `.env` instead, because a probe's cube
 * is not prefiltered and its glossy response at high roughness is approximate.
 * Acceptable here precisely because terrain is almost entirely rough.
 */
export function createLighting(scene: Scene, options: LightingOptions): Lighting {
  const settings = QUALITY[options.tier];
  const table = options.sky;
  let hour = options.hour ?? DEFAULT_HOUR;
  let weather: WeatherParams = { ...(options.weather ?? WEATHER_PRESETS[DEFAULT_WEATHER]) };
  const viewDistance = options.viewDistance;
  let fadeFrom: WeatherParams | null = null;
  let fadeTarget: WeatherParams = weather;
  let fadeDuration = 0;
  let fadeElapsed = 0;
  /** The state of the last apply that found its slices; null before the first. */
  let sky: SkyState | null = null;
  /** The last apply found the table without its slices: the next slice to arrive applies again. */
  let waiting = true;
  /** The weather's and the hour's exposure, as of the last apply. */
  let exposure = 1;
  /** What the stare leaves of it on the material path (`setStare`); 1 on the post path. */
  let sight = 1;

  scene.getEngine().setHardwareScalingLevel(settings.hardwareScaling);

  // The dome: the sky's table drawn on a box that rides with the camera. It
  // adds no light.
  const dome = createSkyDome(scene, options.colourPath);

  // The scene's only DirectionalLight. The foliage light plugin's and the
  // terrain's far-cover sun lines find it by its directional define
  // (`DIRLIGHT<n>`), not by its order: in the game the local headlamp is made
  // first, so the sun is light 1.
  const sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
  // Hemispheric fill stays for ambient. Its intensity and colour are the sky
  // state's, set by `apply()` once the table holds its slices; until then the
  // sun and the fill keep Babylon's defaults, which neither a frame nor an
  // impostor bake shows: the renderer starts no frame and bakes no billboard
  // before its sky is held (`Renderer.skyReady`).
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);

  // CascadedShadowGenerator needs float or half-float render targets, which
  // NullEngine does not have and weak hardware may not either. Constructing it
  // regardless throws, so the check is not optional — and the low tier wants no
  // shadows anyway.
  //
  // The soft-edged tier asks for a full-float map first (half float, Babylon's
  // first choice, where the engine renders no float): the soft shadow's
  // blocker search reads its depth back as a texture, and that depth spans the
  // light's whole range, kilometres here (see `SUN_LIGHT_SIZE_UV`). Half
  // float resolves about 1 part in 2,000 of it, a metre and more, so a caster
  // nearer the ground than that could read as no caster and lose its shadow;
  // full float resolves a millimetre. The hard-edged tiers compare against
  // the depth-stencil texture and never read the map's own depth, so they
  // keep the half.
  const filter = shadowFilterFor(settings);
  const shadows =
    settings.shadowMapSize > 0 && CascadedShadowGenerator.IsSupported
      ? new CascadedShadowGenerator(settings.shadowMapSize, sun, filter.filter === "pcss")
      : null;
  /** The casters that reach every cascade but the farthest (`ShadowReach`), and that cascade's own list, remade when they change. */
  const nearOnly = new Set<AbstractMesh>();
  let farList: AbstractMesh[] | null = null;
  if (shadows !== null) {
    shadows.numCascades = settings.shadowCascades;
    // The far softening's prepass (post.ts) draws for the scene's camera
    // alone: the shadow map opts out, as every render target of the game's
    // own does.
    const shadowMap = shadows.getShadowMap();
    if (shadowMap !== null) shadowMap.noPrePassRenderer = true;
    // The farthest cascade of a long reach draws the far casters alone
    // (`farCascadeIndex`); Babylon asks for each cascade's list by its layer.
    const farCascade = farCascadeIndex(settings);
    if (shadowMap !== null && farCascade >= 0) {
      shadowMap.getCustomRenderList = (layer, list, length) => {
        if (layer !== farCascade || list === null) return null;
        if (farList === null) farList = farCasters(list, length, nearOnly);
        return farList;
      };
    }
    // Stabilisation is chosen deliberately over `autoCalcDepthBounds`, not merely
    // left at a default: the two fight, since stabilisation exists to stop
    // cascade bounds shimmering while `autoCalcDepthBounds` recomputes the depth
    // range every frame and pushes it through `setMinMaxDistance()`, moving the
    // split planes every frame. (`autoCalcDepthBounds` would also be a silent
    // no-op today regardless, since its setter early-returns when
    // `scene.activeCamera` is null at construction, which it is here — but that
    // ordering hazard is a second reason to drop it, not the main one.) This is
    // look-development for judging terrain shape with a freecam, so a stable
    // image beats marginally sharper shadows, and skipping the recompute also
    // costs one fewer depth-reduction pass per frame. Revisit once someone has
    // actually flown around and looked.
    shadows.stabilizeCascades = true;
    shadows.lambda = settings.shadowLambda > 0 ? settings.shadowLambda : 0.9;
    shadows.shadowMaxZ = settings.shadowDistance > 0 ? settings.shadowDistance : SHADOW_DISTANCE;
    if (filter.filter === "pcss") {
      // The percentage-closer soft shadow: the filter's radius grows with the
      // distance between the caster and the receiver, found by a search of
      // the map's depth round the sample. Setting it turns depth clamping off
      // for the map, so the light's near plane moves back to hold every
      // caster (`SUN_LIGHT_SIZE_UV` says what that costs the depth range).
      // The penumbra's darkness stays at Babylon's default of 1: the edge
      // fades to the shadow's own darkness, the floor below, and nothing
      // lighter.
      shadows.useContactHardeningShadow = true;
      shadows.filteringQuality = filter.quality;
      shadows.contactHardeningLightSizeUVRatio = filter.lightSizeUV;
      // The filter's taps written out, no array (`softShadowInclude.ts`):
      // the by-value Poisson table cost WebGPU the whole frame.
      installSoftShadows();
    } else {
      // Already the constructor default; pinned explicitly so it reads as a
      // deliberate choice rather than an oversight among the settings above
      // that are load-bearing.
      shadows.usePercentageCloserFiltering = true;
    }
    // Terrain registers itself as its own shadow caster (see `renderer.ts`), and
    // at the default normalBias of 0 that produced textbook self-shadow acne: a
    // concentric moiré ripple across the whole ground, confirmed in the browser
    // by removing terrain from the caster list and watching it vanish. 0.05 was
    // found by looking — nudged up from 0 until the ripple cleared while
    // hill-still-shadows-hill was preserved — not derived from the shadow map
    // resolution or texel size. Two things have moved under it since: the
    // terrain is genuinely steep now rather than the old gentle heightfield,
    // and acne severity scales with slope; and SHADOW_DISTANCE above changed
    // the cascade-0 texel it was calibrated against, by 3.9× rather than the
    // 49.7× that tying shadows to the fog horizon would have caused. Both say
    // this number wants re-checking by eye in a browser, not by arithmetic.
    //
    // Re-checked by eye, and 0.05 was indeed too low for the montane field: the
    // concentric ripple was back across the entire near ground, at every hour
    // tried. Swept 0.05 → 0.3 → 0.6 against a fixed camera. 0.3 clears it
    // wherever the first cascade lands; 0.6 is indistinguishable from 0.3 apart
    // from a slightly cleaner far strip, so it buys nothing worth the extra
    // contact-shadow offset. The large-scale light-and-dark modelling of the
    // hills is pixel-for-pixel unchanged between 0.05 and 0.3 — only the ripple
    // goes — so nothing real was traded away for it.
    //
    // The soft shadow keeps it. The bias moves the casters as the map is
    // drawn, and the filter's taps compare against that same map; a wider
    // kernel under a canopy reads texels farther out, where a slope's depth
    // differs more, but the contact, where acne shows, is filtered over a
    // texel as before. Whether 0.3 still clears the montane field's ripple
    // under the soft shadow is a thing to look at, not to derive.
    shadows.normalBias = 0.3;
  }

  // Half float where the engine renders it: the dusk horizon is brighter
  // than 1, and an 8-bit capture clipped it before any material read it.
  // Half float rather than float because RGBA16F filters on WebGL2 and on
  // WebGPU's core features alike. Gamma-flagged (linearSpace false) as it
  // always was: a linear probe flips Babylon's GAMMAREFLECTION define in
  // every PBR material, so the dome's capture branch writes the gamma
  // encoding instead and every material decodes the dome's linear radiance.
  const halfFloatTargets = scene.getEngine().getCaps().textureHalfFloatRender;
  const probe = new ReflectionProbe("environment", PROBE_SIZE, scene, true, halfFloatTargets, false);
  // Assignment, not `renderList?.push(...)`: a null `renderList` means "render
  // the entire scene" in Babylon, so the optional chain would silently skip
  // rather than fail loudly if that default ever changed.
  probe.renderList = [dome.mesh];
  // The sky changes only with the hour, the weather or the table, so
  // re-rendering the probe every frame would be six cube faces of pure waste.
  probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  // Each face the probe draws takes the dome's capture branch: the gamma
  // encoding of the linear composition on either colour path, never tone
  // mapped, and the sun's disc capped so a few texels of HDR sun do not
  // sparkle in rough reflections.
  const capture = probe.cubeTexture;
  const captureOn = capture.onBeforeRenderObservable.add(() => dome.setCapture(true));
  const captureOff = capture.onAfterRenderObservable.add(() => dome.setCapture(false));
  scene.environmentTexture = capture;

  const image = scene.imageProcessingConfiguration;
  if (options.colourPath === "post") {
    image.applyByPostProcess = true;
    image.toneMappingEnabled = false;
    image.colorCurvesEnabled = false;
    image.vignetteEnabled = false;
  } else {
    image.applyByPostProcess = false;
    image.toneMappingEnabled = true;
    image.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    image.contrast = 1.1;
    image.ditheringEnabled = true;
    // Colour curves carry the split-tone grade on this path, written by
    // post.ts's update() rather than here — see the doc comment above
    // createLighting. Neutral is 0 on Babylon's scale, so enabling them under
    // clear weather changes nothing.
    image.colorCurves ??= new ColorCurves();
    image.colorCurvesEnabled = true;
  }

  scene.fogMode = Scene.FOGMODE_EXP2;

  function apply(): void {
    // The fog's density is the weather's alone, known before any slice is,
    // so it is set on every apply, held or not: a frame drawn before the
    // first slices (a swap's cover) is fogged as the weather now stands, not
    // at Babylon's default of 0.1 or a weather since changed.
    scene.fogDensity = fogDensityUnder(weather, viewDistance);
    // The exposure too is the weather's and the hour's alone (at the sun's
    // altitude, as the sky state takes it), so it is set held or not. On the
    // material path it is the frame's own, times what the stare leaves, and
    // this is its one writer there: an apply inside a frame, a weather
    // fade's, keeps the stare's dimming. On the post path the grade pass
    // carries its own exposure and no material reads this one.
    exposure = exposureUnder(weather, sunPositionAt(hour).y);
    image.exposure = exposure * sight;
    // Until the table holds the slices either side of noon and of the hour,
    // the state cannot be made: whatever stands (the defaults, or the last
    // hour's light) stays, and the next slice to arrive tries again.
    waiting = !skyHeld(table, hour);
    if (waiting) return;
    const s = skyStateFor(table, hour, weather);
    sky = s;

    // A DirectionalLight's `direction` is the direction light TRAVELS, which is
    // the negation of the direction toward the sun. Backwards here lights the
    // world from underground at noon.
    sun.direction.set(-s.sunDir.x, -s.sunDir.y, -s.sunDir.z);
    sun.intensity = s.sunIntensity;
    sun.diffuse = new Color3(s.sunColour.r, s.sunColour.g, s.sunColour.b);
    // Specular defaults to white; without this, sunrise goes warm orange while
    // every highlight stays neutral, disagreeing about what colour the sun is.
    sun.specular = sun.diffuse;

    // The fog and the clear colour are the dome's horizon away from the sun
    // under the weather's mist (`SkyState.mistAir`), so the haze dissolves into
    // the sky it stands against. The clear colour matters even behind the
    // dome: it is what shows through on any frame the dome has not drawn.
    scene.fogColor = new Color3(s.mistAir.r, s.mistAir.g, s.mistAir.b);
    scene.clearColor = new Color4(s.mistAir.r, s.mistAir.g, s.mistAir.b, 1);

    // The fill: the sky's light on level ground by day and moonlight by night,
    // weighed by the night factor (`skyState.ts`). By day the probe below does
    // most of the ambient work; at night the fill is the light left.
    fill.diffuse = new Color3(s.fillColour.r, s.fillColour.g, s.fillColour.b);
    const collapse = ambientCollapseUnder(weather);
    fill.intensity = s.fillIntensity * collapse;
    // The probe's share of the ambient collapses with the fill, so the top
    // plateau reads as the light going, not the fill alone dimming.
    scene.environmentIntensity = collapse * SKY_IBL_SCALE;

    // Overcast has no directional shadows: fade them rather than reconfigure
    // the CSM. A clear sky's shadows keep SHADOW_FLOOR of the sun.
    shadows?.setDarkness(sunShadowDarkness(weather));

    dome.update(s, image.exposure);
    // One more capture of the dome as it now stands, then idle again.
    capture.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  }

  // A slice that arrives while an apply waits for one tries it again. Once
  // the table holds an hour's slices, later ones fill hours the sun has not
  // reached and change nothing for this one.
  const offTable = table.onChange(() => {
    if (waiting) apply();
  });

  // The /weather fade advances here (the escalation eases the weather itself
  // and sets it with no fade). apply() re-renders the probe each tick; its
  // render list is one dome, six cheap faces.
  const fadeObserver = scene.onBeforeRenderObservable.add(() => {
    if (fadeFrom === null) return;
    fadeElapsed += scene.getEngine().getDeltaTime() / 1000;
    weather = weatherFadeAt(fadeFrom, fadeTarget, fadeElapsed, fadeDuration);
    if (fadeElapsed >= fadeDuration) fadeFrom = null;
    apply();
  });

  apply();

  return {
    get hour() {
      return hour;
    },
    get weather() {
      return { ...weather };
    },
    get sky() {
      return sky;
    },
    get sunDirection() {
      return sun.direction;
    },
    shadows,
    setHour(next) {
      hour = next;
      apply();
    },
    setWeather(next, fadeSeconds = 3) {
      if (fadeSeconds <= 0) {
        weather = { ...next };
        fadeFrom = null;
        apply();
        return;
      }
      fadeFrom = { ...weather };
      fadeTarget = { ...next };
      fadeDuration = fadeSeconds;
      fadeElapsed = 0;
    },
    setView(nextHour, next) {
      hour = nextHour;
      weather = { ...next };
      fadeFrom = null;
      apply();
    },
    setStare(stare) {
      if (options.colourPath !== "material") return;
      sight = sightUnder(stare);
      image.exposure = exposure * sight;
    },
    addShadowMesh(mesh, reach = "far") {
      mesh.receiveShadows = true;
      shadows?.addShadowCaster(mesh);
      if (reach === "near") nearOnly.add(mesh);
      else nearOnly.delete(mesh);
      farList = null;
    },
    removeShadowMesh(mesh) {
      shadows?.removeShadowCaster(mesh);
      nearOnly.delete(mesh);
      farList = null;
    },
    dispose() {
      offTable();
      scene.onBeforeRenderObservable.remove(fadeObserver);
      capture.onBeforeRenderObservable.remove(captureOn);
      capture.onAfterRenderObservable.remove(captureOff);
      // Guarded by identity: only clear the environment texture if it is still
      // the one this created. ReflectionProbe.dispose() disposes its render
      // target and nulls its own reference but never touches
      // `scene.environmentTexture`, which would otherwise keep pointing at a
      // disposed cube texture that `scene.pure.js` re-adds to `_renderTargets`
      // every frame. The identity check means this never clobbers an
      // environment texture something else installed instead.
      if (scene.environmentTexture === capture) {
        scene.environmentTexture = null;
      }
      probe.dispose();
      shadows?.dispose();
      sun.dispose();
      fill.dispose();
      dome.dispose();
    },
  };
}
