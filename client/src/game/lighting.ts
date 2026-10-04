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
import { ReflectionProbe } from "@babylonjs/core/Probes/reflectionProbe.js";

import { QUALITY, type QualityTier } from "./quality.js";
import { sunPositionAt } from "./sky.js";
import { NOON_ALTITUDE_DEG, type SkyTable } from "./skyTable.js";
import { SKY_IBL_SCALE, skyStateFor, type SkyState } from "./skyState.js";
import { createSkyDome } from "./skyDome.js";
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
  addShadowMesh(mesh: AbstractMesh): void;
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

  scene.getEngine().setHardwareScalingLevel(settings.hardwareScaling);

  // The dome: the sky's table drawn on a box that rides with the camera. It
  // adds no light, so the sun below stays light 0 and the fill light 1, the
  // order the foliage light plugin reads them in.
  const dome = createSkyDome(scene, options.colourPath);

  const sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
  // Hemispheric fill stays for ambient. Its intensity and colour are the sky
  // state's, set by `apply()` once the table holds its slices; until then it
  // keeps Babylon's defaults, which no frame shows.
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);

  // CascadedShadowGenerator needs float or half-float render targets, which
  // NullEngine does not have and weak hardware may not either. Constructing it
  // regardless throws, so the check is not optional — and the low tier wants no
  // shadows anyway.
  const shadows =
    settings.shadowMapSize > 0 && CascadedShadowGenerator.IsSupported
      ? new CascadedShadowGenerator(settings.shadowMapSize, sun)
      : null;
  if (shadows !== null) {
    shadows.numCascades = settings.shadowCascades;
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
    shadows.lambda = 0.9;
    shadows.shadowMaxZ = SHADOW_DISTANCE;
    // Already the constructor default; pinned explicitly so it reads as a
    // deliberate choice rather than an oversight among the settings above that
    // are load-bearing.
    shadows.usePercentageCloserFiltering = true;
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
    scene.fogDensity = fogDensityUnder(weather, viewDistance);

    // The fill: the sky's light on level ground by day and moonlight by night,
    // weighed by the night factor (`skyState.ts`). By day the probe below does
    // most of the ambient work; at night the fill is the light left.
    fill.diffuse = new Color3(s.fillColour.r, s.fillColour.g, s.fillColour.b);
    const collapse = ambientCollapseUnder(weather);
    fill.intensity = s.fillIntensity * collapse;
    // The probe's share of the ambient collapses with the fill, so the top
    // plateau reads as the light going, not the fill alone dimming.
    scene.environmentIntensity = collapse * SKY_IBL_SCALE;

    // Read on both paths: the grade pass reads it from the same record, and on
    // the post path the value is simply unused by materials.
    image.exposure = exposureUnder(weather, s.sunDir.y);
    // Overcast has no directional shadows: fade them rather than reconfigure the CSM.
    shadows?.setDarkness(shadowDarknessUnder(weather));

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

  // The /weather fade — and the escalation's turn toward eerie — advance
  // here. apply() re-renders the probe each tick; its render list is one dome,
  // six cheap faces.
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
    addShadowMesh(mesh) {
      mesh.receiveShadows = true;
      shadows?.addShadowCaster(mesh);
    },
    removeShadowMesh(mesh) {
      shadows?.removeShadowCaster(mesh);
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
