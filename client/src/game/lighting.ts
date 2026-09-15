import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
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
import { SkyMaterial } from "@babylonjs/materials/sky/skyMaterial.js";

import { QUALITY, type QualityTier } from "./quality.js";
import { sunPositionAt } from "./sky.js";
import {
  DEFAULT_WEATHER,
  WEATHER_PRESETS,
  weatherFadeAt,
  type WeatherParams,
  skyMaterialParamsUnder,
  sunIntensityUnder,
  sunColourUnder,
  fillIntensityUnder,
  ambientColourUnder,
  fogDensityUnder,
  fogColourUnder,
  shadowDarknessUnder,
  exposureUnder,
  saturationUnder,
  gradeUnder,
  ambientCollapseUnder,
} from "./weather.js";

/** Matches the `/time` command's `defaultValue` in `commands.ts`. */
export const DEFAULT_HOUR = 12;

/** Big enough to sit outside any view, small enough to stay inside the far plane. */
const SKYBOX_SIZE = 8000;

/** Cube face resolution for the environment probe. */
const PROBE_SIZE = 128;

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
  readonly shadows: CascadedShadowGenerator | null;
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
   * Releases the objects this created: the sky material and skybox, the sun
   * and fill lights, the shadow generator, and the reflection probe. It does
   * not restore the scene state it borrowed and mutated in place — fog mode,
   * density and colour, clear colour, tone-mapping enabled/type/contrast,
   * exposure, and the engine's hardware scaling are the caller's to reset,
   * because `createLighting` never owned them, only set them. In practice the
   * renderer disposes the whole `Scene` on teardown, so restoring here would
   * be dead code; if that ever stops being true, restoring becomes this
   * function's job too.
   */
  dispose(): void;
};

/**
 * Everything that turns a scene from flat to lit: a procedural sky, a sun with
 * cascaded shadows, image-based ambient captured from that sky, ACES tone
 * mapping, and aerial perspective tinted to match.
 *
 * This is the Babylon shell. Every number it applies comes from `sky.ts` and
 * `quality.ts`, which are pure and tested; what is left here is wiring, and the
 * traps are in the wiring rather than the arithmetic.
 *
 * On the sky, there are two valid paths and this is the development
 * one: a dynamic sky captured to a reflection probe, which is what lets the sun
 * move. Shipped levels are to use a baked `.env` instead, because a probe's cube
 * is not prefiltered and its glossy response at high roughness is approximate.
 * Acceptable here precisely because terrain is almost entirely rough.
 */
export function createLighting(scene: Scene, options: LightingOptions): Lighting {
  const settings = QUALITY[options.tier];
  let hour = options.hour ?? DEFAULT_HOUR;
  let weather: WeatherParams = { ...(options.weather ?? WEATHER_PRESETS[DEFAULT_WEATHER]) };
  const viewDistance = options.viewDistance;
  let fadeFrom: WeatherParams | null = null;
  let fadeTarget: WeatherParams = weather;
  let fadeDuration = 0;
  let fadeElapsed = 0;

  scene.getEngine().setHardwareScalingLevel(settings.hardwareScaling);

  const sky = new SkyMaterial("skyMaterial", scene);
  sky.backFaceCulling = false;
  // Drive the sky from an explicit sun vector rather than from its own
  // inclination and azimuth, so exactly one function decides where the sun is
  // and the light and the sky cannot disagree.
  sky.useSunPosition = true;

  const skybox = MeshBuilder.CreateBox("skybox", { size: SKYBOX_SIZE }, scene);
  skybox.material = sky;
  skybox.infiniteDistance = true;
  skybox.isPickable = false;
  // Load-bearing, not cosmetic. SkyMaterial participates in fog like any other
  // material, and `infiniteDistance` only translates the box with the camera —
  // it does not shrink the geometry, so a face centre is still ~4000m out at
  // SKYBOX_SIZE = 8000. EXP2 fog's exponent grows with distance squared, so at
  // any view distance worth having, that saturates to fully fogged: the sun
  // disc, Rayleigh gradient and Mie scatter all collapse to one flat colour,
  // and the reflection probe (which renders exactly this skybox) captures six
  // uniform faces instead of a directional sky.
  skybox.applyFog = false;

  const sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
  // Hemispheric fill stays for ambient. Intensity and
  // colour are both set by `apply()`, below, which runs once at the end of
  // this function — there is no separate value assigned here to drift out of
  // step with it.
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

  const probe = new ReflectionProbe("environment", PROBE_SIZE, scene);
  // Assignment, not `renderList?.push(...)`: a null `renderList` means "render
  // the entire scene" in Babylon, so the optional chain would silently skip
  // rather than fail loudly if that default ever changed.
  probe.renderList = [skybox];
  // The sky only changes when the hour does, so re-rendering the probe every
  // frame would be six cube faces of pure waste.
  probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  scene.environmentTexture = probe.cubeTexture;

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
    // Colour curves carry the split-tone grade on this path. Neutral is 0 on
    // Babylon's scale, so enabling them under clear weather changes nothing.
    image.colorCurves ??= new ColorCurves();
    image.colorCurvesEnabled = true;
  }

  scene.fogMode = Scene.FOGMODE_EXP2;

  function apply(): void {
    const toSun = sunPositionAt(hour);
    // A DirectionalLight's `direction` is the direction light TRAVELS, which is
    // the negation of the direction toward the sun. Backwards here lights the
    // world from underground at noon.
    sun.direction.set(-toSun.x, -toSun.y, -toSun.z);

    const skyParams = skyMaterialParamsUnder(weather);
    sky.turbidity = skyParams.turbidity;
    sky.luminance = skyParams.luminance;
    sky.rayleigh = skyParams.rayleigh;
    sky.mieCoefficient = skyParams.mieCoefficient;
    sky.mieDirectionalG = skyParams.mieDirectionalG;

    sun.intensity = sunIntensityUnder(weather, hour);
    const warm = sunColourUnder(weather, hour);
    sun.diffuse = new Color3(warm.r, warm.g, warm.b);
    // Specular defaults to white; without this, sunrise goes warm orange while
    // every highlight stays neutral, disagreeing about what colour the sun is.
    sun.specular = sun.diffuse;

    sky.sunPosition = new Vector3(toSun.x, toSun.y, toSun.z);

    const air = fogColourUnder(weather, hour);
    scene.fogColor = new Color3(air.r, air.g, air.b);
    // Matters even behind a skybox: it is what shows through on any frame the
    // skybox has not drawn, and it keeps the sandbox level coherent too.
    scene.clearColor = new Color4(air.r, air.g, air.b, 1);
    scene.fogDensity = fogDensityUnder(weather, viewDistance);

    // The fill's colour and intensity, not the sky's own colour and a fixed
    // intensity: at night the sky is near-black, and a fill lit by it plus a
    // sun contributing zero is why night used to render pure black (roughly
    // 0.005 of ambient light at hour 21 versus ~4.0 at noon). `ambientColourFor`
    // swaps in a moonlight tint instead of
    // following the sky all the way to black, and `fillIntensityFor` raises
    // the intensity to match, since the fill is the only light left once the
    // sun sets. Kept low by day for the opposite reason: the reflection probe
    // below is doing most of the ambient work by then, and a fixed 0.55 (the
    // old constant) would wash out everything the image-based lighting
    // contributes.
    const ambient = ambientColourUnder(weather, hour);
    fill.diffuse = new Color3(ambient.r, ambient.g, ambient.b);
    const collapse = ambientCollapseUnder(weather);
    fill.intensity = fillIntensityUnder(weather, toSun.y) * collapse;
    // The probe's share of the ambient collapses with the fill, so the top
    // plateau reads as the light going, not the fill alone dimming.
    scene.environmentIntensity = collapse;

    // Read on both paths: the grade pass reads it from the same record, and on
    // the post path the value is simply unused by materials.
    image.exposure = exposureUnder(weather, toSun.y);
    // The grade is nine writes on a rig Babylon already builds and enables, so
    // it costs no pass and no allocation. Densities are the strength control:
    // at `clear` every one is 0, which is why the sunny frame survives intact.
    if (options.colourPath === "material" && image.colorCurves) {
      const curves = image.colorCurves;
      const grade = gradeUnder(weather);
      curves.globalSaturation = saturationUnder(weather);
      curves.shadowsHue = grade.shadowsHue;
      curves.shadowsDensity = grade.shadowsDensity;
      curves.shadowsSaturation = grade.shadowsSaturation;
      curves.midtonesHue = grade.midtonesHue;
      curves.midtonesDensity = grade.midtonesDensity;
      curves.midtonesSaturation = grade.midtonesSaturation;
      curves.highlightsHue = grade.highlightsHue;
      curves.highlightsDensity = grade.highlightsDensity;
      curves.highlightsSaturation = grade.highlightsSaturation;
    }
    // Overcast has no directional shadows: fade them rather than reconfigure the CSM.
    shadows?.setDarkness(shadowDarknessUnder(weather));

    // One more capture at the new sun angle, then idle again.
    probe.cubeTexture.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  }

  // The /weather fade — and, later, the scripted sunny-to-eerie turn — advance
  // here. apply() re-renders the probe each tick; its render list is one skybox,
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
      scene.onBeforeRenderObservable.remove(fadeObserver);
      // Guarded by identity: only clear the environment texture if it is still
      // the one this created. ReflectionProbe.dispose() disposes its render
      // target and nulls its own reference but never touches
      // `scene.environmentTexture`, which would otherwise keep pointing at a
      // disposed cube texture that `scene.pure.js` re-adds to `_renderTargets`
      // every frame. The identity check means this never clobbers an
      // environment texture a later task installed instead.
      if (scene.environmentTexture === probe.cubeTexture) {
        scene.environmentTexture = null;
      }
      probe.dispose();
      shadows?.dispose();
      sun.dispose();
      fill.dispose();
      skybox.dispose();
      sky.dispose();
    },
  };
}
