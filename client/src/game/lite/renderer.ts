/**
 * The hike's renderer on Babylon Lite: the terrain under the atmosphere, lit
 * by the sun and the sky's fill for the hour and the weather, seen from the
 * player's eye or the free camera. It answers the whole of `Renderer`
 * (`renderer.ts`), and what it does not draw yet it answers as nothing
 * (`notDrawn.ts` has the list).
 *
 * What it draws with is the game's own, computed with no engine: the
 * terrain's uniforms, tables, layers and vertex data, the air's uniforms,
 * the lights and the lens. This module is where those meet Lite: an engine,
 * a scene, a camera, two lights, the terrain's two materials and their
 * meshes.
 *
 * **The engine is Lite's own, made from the canvas, and making it takes
 * time**: a device is asked for, the ground's images are decoded, the scene
 * is registered. So the renderer is handed back at once and stands empty
 * until that is done: `sync` places the camera and keeps the lights' and the
 * air's numbers, `drawFrame` draws nothing, and `skyReady` and `whenReady`
 * resolve only once it stands, so no start draws a frame before it. A
 * renderer that cannot be made (no WebGPU device, a shader refused) says so
 * in the console and stays empty.
 *
 * **Colour** is the low tier's material path: Lite's display curve as
 * Babylon's image processing has it there (Khronos PBR Neutral, contrast
 * 1.1), under the weather's and the hour's exposure. There is no post chain.
 */
import {
  NeutralToneMapping, addToScene, createBankedFreeCamera, createDirectionalLight, createEngine, createHemisphericLight, createPbrMaterial,
  createSceneContext, disposeEngine, disposeScene, enableMaterialPlugins, enablePbrMaterialPluginVertexData, markLightDirty,
  markMaterialUboDirty, onEngineDeviceLost, onEngineGpuError, registerScene, renderFrame, resizeEngine, vec3,
  type BankedFreeCamera, type DirectionalLight, type EngineContext, type HemisphericLight, type MaterialPlugin, type PbrMaterialProps,
  type SceneContext,
} from "@babylonjs/lite";
import { PLAYER_EYE_OFFSET } from "../../sim/constants.js";
import type { Forest } from "../../sim/forest.js";
import { FOG_DISTANCE } from "../../sim/forestConstants.js";
import type { Level } from "../../sim/level.js";
import { activeTerrainVariant, type LakeSource } from "../../sim/terrain.js";
import type { ListenerPose } from "../ambientAudio.js";
import { atmosphereUniforms, emptyAtmosphereUniforms } from "../atmosphereParams.js";
import { BASE_SPACING_BY_TIER } from "../clipmap.js";
import { noCloud } from "../cloudParams.js";
import type { EngineHandle } from "../engineHandle.js";
import { blendedEye, type EyePose } from "../eyeBlend.js";
import { FACE_PATCH_Z_UNITS } from "../facePatches.js";
import { featureTableFor } from "../featureTable.js";
import { GAME_FOV, lensProjection } from "../gameLens.js";
import { writeListenerPose } from "../listenerPose.js";
import { sharedSeconds } from "../oceanWindSea.js";
import { fittingFeatureTable, fittingRings } from "../preparedScene.js";
import { QUALITY, detectTier } from "../quality.js";
import type { FreecamView, Renderer, RendererOptions } from "../renderer.js";
import { startSkySource, type SkySource } from "../skyWorker.js";
import { DEFAULT_HOUR, sunAltitudeDeg, whenSkyHeld } from "../skyWait.js";
import { finish, stepSlices } from "../syncJobs.js";
import { followRoadCentre, terrainTablesFor, type TerrainTables } from "../terrainTables.js";
import { terrainCoverFor, terrainSurfaceUnder, terrainUniforms, type TerrainUniformInputs } from "../terrainUniforms.js";
import { createViewBob } from "../viewBob.js";
import { WATER_ROWS, lakeWaterRow } from "../waterShading.js";
import { emptyWetUniforms, setWetWeather, wetLineFor, wetUniforms, type WetBody } from "../wetSurface.js";
import { windRecordUnder, type WindRecord } from "../windParams.js";
import { atmospherePlugin } from "./atmospherePlugin.js";
import { cameraAxes, projectToCanvas, restAxes, type CameraPose } from "./cameraPose.js";
import { GROUND_IMAGES, cloudMapTexture, loadGroundArrays, tableTexture, type TableTexture } from "./groundTextures.js";
import { notDrawnMembers } from "./notDrawn.js";
import { createTerrainMeshes, type TerrainMeshes } from "./terrainMeshes.js";
import { emptyTerrainMaterialUniforms, terrainPlugin, terrainSplitPlugin, terrainWetPlugin } from "./terrainPlugins.js";
import { createWorldLight } from "./worldLight.js";

/** The display curve's contrast on the material colour path, as the lighting sets Babylon's. */
const DISPLAY_CONTRAST = 1.1;

/** How far ahead of the eye the point the camera looks at is put, metres. */
const LOOK_AHEAD = 10;

/** GPU errors said in the console before the rest are left out: one broken
 * shader reports again every frame. */
const GPU_ERRORS_SAID = 8;

/**
 * A depth offset toward the eye, for a surface drawn over another it lies
 * on: the steep ground's patches over the rings. Lite's PBR material has no
 * depth bias, so the vertex stage moves the clip-space depth itself, by
 * `units` of a 24-bit depth buffer's steps as Babylon's `zOffsetUnits`
 * counts them. Lite's depth runs from 1 at the near plane to 0 far away, so
 * toward the eye is up. The slope-scaled half of Babylon's offset
 * (`zOffset`) has no like in a vertex stage and is left out.
 */
export function depthAheadPlugin(units: number): MaterialPlugin {
  const ahead = units / 2 ** 24;
  return {
    name: "DepthAhead",
    priority: 950,
    defines: { units },
    getCustomCode: (stage) => (stage === "vertex" ? { CUSTOM_VERTEX_MAIN_END: `out.clipPos.z+=${ahead.toExponential(6)}*out.clipPos.w;` } : null),
  };
}

/** What stands once the renderer is made: Lite's engine and scene, and what is drawn in it. */
type Standing = {
  engine: EngineContext;
  scene: SceneContext;
  camera: BankedFreeCamera;
  sun: DirectionalLight;
  fill: HemisphericLight;
  materials: PbrMaterialProps[];
  terrain: TerrainMeshes | null;
  road: TableTexture | null;
};

/**
 * A hike's renderer on `canvas` for `forest`'s world (null: a hand-authored
 * level, of which nothing is drawn yet). Of `options` it reads the tier, the
 * clock, the start, the prepared scene's rings and feature table, whether
 * the rings' first build is deferred, and the sky's table; the rest belong
 * to parts not drawn yet. It makes its own engine: one handed in is refused.
 */
export function createLiteRenderer(canvas: HTMLCanvasElement, level: Level, forest: Forest | null, options: RendererOptions = {}): Renderer {
  if (options.engine !== undefined) throw new Error("the hike's renderer makes its own engine from its canvas: none is handed to it");
  if (forest === null && level.brushes.length > 0) console.info(`the level's ${level.brushes.length} brushes are not drawn yet`);

  const tier = options.tier ?? detectTier(globalThis.navigator);
  const clock = options.clock ?? (() => performance.now());
  const lens = lensProjection();
  const { members: absent } = notDrawnMembers();

  // The sky's slices: the page's table or, given none, a source of this renderer's own.
  let ownSky: SkySource | null = null;
  if (options.skyTable === undefined) ownSky = startSkySource(sunAltitudeDeg(DEFAULT_HOUR));
  const skyTable = options.skyTable ?? (ownSky as SkySource).table;
  const light = createWorldLight(skyTable, FOG_DISTANCE);

  // What the terrain is drawn with, each one record filled in place a frame.
  const prepared = options.prepared?.tier === tier ? options.prepared : null;
  const featureTable = forest === null ? null : fittingFeatureTable(prepared, forest.seed) ?? featureTableFor(forest.seed);
  const tables: TerrainTables = forest === null ? { road: null, trail: null, features: null } : terrainTablesFor(forest.seed, featureTable);
  const cover = terrainCoverFor(tier);
  const drawnWith: TerrainUniformInputs = {
    eye: null, wetness: 0, rain: 0, seconds: 0,
    // The sward floor stands for the shaded ground between the blades, which are not drawn.
    sward: false,
    relief: true,
    road: tables.road, trail: tables.trail, features: tables.features,
  };
  const terrainValues = emptyTerrainMaterialUniforms();
  const wetValues = emptyWetUniforms();
  const airValues = emptyAtmosphereUniforms();
  const cloud = noCloud();

  // The wet line follows the nearest body, sea or lake, though no water is drawn.
  const wetBodies: WetBody[] = [];
  if (forest !== null) {
    const variant = activeTerrainVariant();
    if (variant.waterLevel !== undefined) {
      wetBodies.push({ ...WATER_ROWS.sea, level: variant.waterLevel, x: 0, z: 0, radius: Number.POSITIVE_INFINITY, bound: Number.POSITIVE_INFINITY });
    }
    const lakes = variant.waterBodies?.(forest.seed).filter((body): body is LakeSource => body.kind === "lake") ?? [];
    for (const lake of lakes) {
      wetBodies.push({ ...lakeWaterRow(lake.murk), level: lake.level, x: lake.x, z: lake.z, radius: lake.shape.shoreMax, bound: lake.bound });
    }
  }

  // The view: where the camera stands and how it is turned, as `sync` last left it.
  const pose: CameraPose = { x: 0, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0 };
  const axes = restAxes();
  let fov = lens.fov;
  let freecam: FreecamView | null = null;
  const bob = createViewBob();
  const eyeScratch: EyePose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const listenerPose: ListenerPose = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0 };
  let wind: WindRecord = windRecordUnder(light.weather, 0);
  let windOverride: number | null = null;
  /** When the weather's fade was last stepped, on the renderer's clock (ms). */
  let steppedAt: number | null = null;

  let disposed = false;
  let standing: Standing | null = null;
  /** The light's version the lights and the cleared frame were last written for. */
  let litVersion = -1;
  /** The canvas's size the engine was last fitted to, CSS pixels. */
  let fittedWidth = -1;
  let fittedHeight = -1;
  /** Ground images still being fetched or decoded. */
  let loading = forest === null ? 0 : GROUND_IMAGES;
  let gpuErrors = 0;
  const disposal = new AbortController();

  let markSynced: () => void = () => undefined;
  const firstSynced = new Promise<void>((resolve) => {
    markSynced = resolve;
  });

  /** Lets go of what stands: the meshes, the scene, the engine and its device. */
  function release(made: Standing): void {
    made.terrain?.dispose();
    disposeScene(made.scene);
    disposeEngine(made.engine);
  }

  async function make(): Promise<void> {
    // The tier's scaling of the canvas's pixels: Lite sizes its surface by the
    // device's pixel ratio, held at the ratio the tier draws at.
    const engine = await createEngine(canvas, { msaaSamples: 4, maxDevicePixelRatio: 1 / QUALITY[tier].hardwareScaling });
    if (disposed) {
      disposeEngine(engine);
      return;
    }
    onEngineGpuError(engine, (error) => {
      if (gpuErrors++ < GPU_ERRORS_SAID) console.error(`the hike's renderer: ${error.message}`);
    });
    onEngineDeviceLost(engine, (info) => {
      // Its own letting go destroys the device too: only a loss it did not ask for is said.
      if (!disposed) console.error(`the hike's renderer lost its device (${info.reason === undefined ? "no reason given" : info.reason}): ${info.message}`);
    });
    const scene = createSceneContext(engine);
    scene.imageProcessing.toneMappingEnabled = true;
    scene.imageProcessing.toneMapping = NeutralToneMapping;
    scene.imageProcessing.contrast = DISPLAY_CONTRAST;
    scene.imageProcessing.exposure = light.exposure;

    // Never given controls: the camera is placed by `sync` alone.
    const camera = createBankedFreeCamera(vec3(pose.x, pose.y, pose.z), vec3(pose.x, pose.y, pose.z + LOOK_AHEAD), vec3(0, 1, 0));
    camera.fov = lens.fov;
    camera.nearPlane = lens.near;
    camera.farPlane = lens.far;
    addToScene(scene, camera);
    scene.camera = camera;

    // The sun and the fill, set by the first frame's light.
    const sun = createDirectionalLight([0, -1, 0], 1);
    const fill = createHemisphericLight([0, 1, 0], 1);
    addToScene(scene, sun);
    addToScene(scene, fill);

    const materials: PbrMaterialProps[] = [];
    let terrain: TerrainMeshes | null = null;
    let road: TableTexture | null = null;
    if (forest !== null) {
      const arrays = await loadGroundArrays(engine, disposal.signal, () => {
        loading--;
      });
      if (disposed) {
        disposeScene(scene);
        disposeEngine(engine);
        return;
      }
      road = tableTexture(engine, tables.road);
      const textures = {
        ...arrays,
        roadCenter: road.texture,
        trailTable: tableTexture(engine, tables.trail).texture,
        featureTex: tableTexture(engine, tables.features).texture,
      };
      const cloudMap = cloudMapTexture(engine);
      const paints = { road: tables.road !== null, trail: tables.trail !== null, features: tables.features !== null };
      const surface = terrainSurfaceUnder(light.weather);
      const material = (extra: MaterialPlugin[]): PbrMaterialProps => {
        const made = createPbrMaterial({
          baseColorFactor: [surface.albedo[0], surface.albedo[1], surface.albedo[2], 1],
          metallicFactor: surface.metallic,
          roughnessFactor: surface.roughness,
          usePhysicalLightFalloff: true,
        });
        made.plugins = [
          terrainPlugin(terrainValues, textures, cover.farLow, paints),
          terrainWetPlugin(wetValues),
          terrainSplitPlugin(),
          atmospherePlugin(airValues, cloudMap),
          ...extra,
        ];
        materials.push(made);
        return made;
      };
      terrain = createTerrainMeshes(
        engine, scene,
        // The patches: the ground's material again, a depth offset ahead of the ground they lie on.
        { ground: material([]), patches: material([depthAheadPlugin(-FACE_PATCH_Z_UNITS)]) },
        forest.seed, tier,
        {
          start: options.start,
          rings: fittingRings(prepared, forest.seed, options.start ?? { x: 0, z: 0 }, BASE_SPACING_BY_TIER[tier]),
          trail: activeTerrainVariant().trailGraph?.(forest.seed) ?? null,
        },
      );
      if (options.deferClipmap !== true) finish(terrain.firstBuild());
    }
    enablePbrMaterialPluginVertexData();
    enableMaterialPlugins(scene);
    await registerScene(scene);
    const made: Standing = { engine, scene, camera, sun, fill, materials, terrain, road };
    if (disposed) {
      release(made);
      return;
    }
    standing = made;
  }

  /** Resolved once the renderer stands, or cannot: a failure is said and leaves it empty. */
  const made: Promise<void> = make().catch((error: unknown) => {
    loading = 0;
    if (!disposed) console.error("the hike's renderer could not be made; nothing of the world is drawn", error);
  });

  const handle = {
    isDisposed: false,
    dispose(): void {
      if (handle.isDisposed) return;
      handle.isDisposed = true;
      disposed = true;
      stopLoop();
      disposal.abort();
      light.dispose();
      ownSky?.dispose();
      markSynced();
      if (standing !== null) release(standing);
      standing = null;
    },
  };

  /** The frames the page is shown, each calling every function `runLoop` was given, then every frame's-end listener. */
  const frames = new Set<() => void>();
  const frameEnds = new Set<() => void>();
  let scheduled: number | null = null;
  function tick(): void {
    scheduled = requestAnimationFrame(tick);
    for (const frame of [...frames]) frame();
    for (const end of [...frameEnds]) end();
  }
  function stopLoop(frame?: () => void): void {
    if (frame === undefined) frames.clear();
    else frames.delete(frame);
    if (frames.size === 0 && scheduled !== null) {
      cancelAnimationFrame(scheduled);
      scheduled = null;
    }
  }

  /** The engine's surface fitted to the canvas, when the canvas's size has moved. */
  function fit(made: Standing): void {
    if (canvas.clientWidth === fittedWidth && canvas.clientHeight === fittedHeight) return;
    fittedWidth = canvas.clientWidth;
    fittedHeight = canvas.clientHeight;
    resizeEngine(made.engine);
  }

  /** The lights and the cleared frame, written again when the hour's or the weather's light has moved. */
  function relight(made: Standing): void {
    const lights = light.lights;
    if (lights === null || litVersion === light.version) return;
    litVersion = light.version;
    const { sun, fill, scene } = made;
    sun.direction.x = light.sunTravel.x;
    sun.direction.y = light.sunTravel.y;
    sun.direction.z = light.sunTravel.z;
    sun.intensity = lights.sun.intensity;
    // A highlight takes the light's own colour, as under Babylon's PBR, which reads no other.
    sun.diffuse = [lights.sun.colour.r, lights.sun.colour.g, lights.sun.colour.b];
    sun.specular = [lights.sun.colour.r, lights.sun.colour.g, lights.sun.colour.b];
    markLightDirty(sun);
    fill.intensity = lights.fill.intensity;
    fill.diffuseColor = [lights.fill.colour.r, lights.fill.colour.g, lights.fill.colour.b];
    fill.specularColor = [lights.fill.colour.r, lights.fill.colour.g, lights.fill.colour.b];
    fill.groundColor = [lights.fill.groundColour.r, lights.fill.groundColour.g, lights.fill.groundColour.b];
    markLightDirty(fill);
    // The cleared frame is the air over the horizon: with no dome drawn, it is the sky.
    scene.clearColor = { r: lights.air.r, g: lights.air.g, b: lights.air.b, a: 1 };
  }

  /** The frame's numbers into what stands: the camera, the lights, the exposure and the terrain's materials. */
  function draw(made: Standing, wetness: number): void {
    const { camera, scene } = made;
    camera.position.x = pose.x;
    camera.position.y = pose.y;
    camera.position.z = pose.z;
    camera.target.x = pose.x + axes.fx * LOOK_AHEAD;
    camera.target.y = pose.y + axes.fy * LOOK_AHEAD;
    camera.target.z = pose.z + axes.fz * LOOK_AHEAD;
    camera.upVector.x = axes.ux;
    camera.upVector.y = axes.uy;
    camera.upVector.z = axes.uz;
    camera.fov = fov;
    relight(made);
    scene.imageProcessing.exposure = light.exposure;
    // The road's table follows the eye before the uniforms are made: they carry where it is centred.
    if (tables.road !== null && made.road !== null && followRoadCentre(tables.road, pose.z)) made.road.write();
    terrainUniforms(drawnWith, terrainValues);
    const surface = terrainSurfaceUnder(light.weather);
    terrainValues.terrainAlbedo[0] = surface.albedo[0];
    terrainValues.terrainAlbedo[1] = surface.albedo[1];
    terrainValues.terrainAlbedo[2] = surface.albedo[2];
    setWetWeather(wetness);
    // Everywhere but under the water of the high tier's own path, the water above darkens what stands in it.
    wetUniforms({ ...wetLineFor(wetBodies, pose.x, pose.z), attenuate: true, cap: 0 }, wetValues);
    // The ground cloud is not marched: no steps.
    atmosphereUniforms(light.air, cloud, 0, airValues);
    for (const material of made.materials) {
      const colour = material.baseColorFactor;
      if (colour !== undefined) {
        colour[0] = surface.albedo[0];
        colour[1] = surface.albedo[1];
        colour[2] = surface.albedo[2];
      }
      material.roughnessFactor = surface.roughness;
      markMaterialUboDirty(material);
    }
  }

  let skyWait: Promise<void> | null = null;

  const renderer: Renderer = {
    ...absent,
    engine: handle as EngineHandle,
    engineName: "webgpu",
    firstSynced,
    skyReady() {
      // The sky's slices and the renderer itself: no frame is drawn before both.
      skyWait ??= Promise.all([whenSkyHeld(skyTable, () => light.hour, { signal: disposal.signal }), made]).then(() => {
        skyWait = null;
      });
      return skyWait;
    },
    whenReady(maxMs) {
      return new Promise<void>((resolve) => {
        const bound = setTimeout(resolve, Math.max(0, maxMs));
        void made.then(() => {
          clearTimeout(bound);
          resolve();
        });
      });
    },
    waitingItems() {
      return loading;
    },
    sync(state, localId, alpha, frame = { dt: 0, sprinting: false }) {
      if (disposed) return;
      const now = clock();
      const seconds = now / 1000;
      // The weather's fade, a frame of the renderer's clock at a time.
      light.step(steppedAt === null ? 0 : Math.max(0, (now - steppedAt) / 1000));
      steppedAt = now;
      const weather = light.weather;
      // The wind's time is the simulation's, so every peer's blows the same way; a clock handed in is kept.
      wind = windRecordUnder(weather, options.clock !== undefined ? seconds : sharedSeconds(state.tick, alpha), windOverride ?? undefined);

      // The world follows the camera in freecam, the player otherwise.
      let centre: { x: number; z: number } | null = null;
      if (freecam !== null) {
        centre = freecam;
        pose.x = freecam.x;
        pose.y = freecam.y;
        pose.z = freecam.z;
        pose.yaw = freecam.yaw;
        pose.pitch = freecam.pitch;
        pose.roll = freecam.roll ?? 0;
        fov = freecam.fov ?? GAME_FOV;
        // Flying is not walking.
        bob.reset();
      } else {
        const local = state.players.get(localId);
        if (local !== undefined) {
          centre = local.pos;
          const offset = bob.update(
            {
              x: local.pos.x,
              z: local.pos.z,
              speed: Math.sqrt(local.vel.x * local.vel.x + local.vel.z * local.vel.z),
              velY: local.vel.y,
              grounded: local.grounded,
              sprinting: frame.sprinting,
            },
            frame.dt,
          );
          // The eye between the frame's last tick and the one before it; the
          // lateral bob rides the camera's right vector, (cos yaw, 0, -sin yaw).
          const eye = blendedEye(frame.before ?? null, local, alpha, eyeScratch);
          pose.x = eye.x + offset.dx * Math.cos(eye.yaw);
          pose.y = eye.y + PLAYER_EYE_OFFSET + offset.dy;
          pose.z = eye.z - offset.dx * Math.sin(eye.yaw);
          pose.yaw = eye.yaw;
          pose.pitch = eye.pitch;
          pose.roll = offset.roll;
          fov = GAME_FOV;
        }
      }
      cameraAxes(pose.yaw, pose.pitch, pose.roll, axes);
      drawnWith.eye = pose;
      drawnWith.wetness = weather.wetness;
      drawnWith.rain = weather.rain;
      drawnWith.seconds = seconds;
      if (standing !== null) {
        // The terrain first: the frame draws the ground where the view now is.
        if (centre !== null) standing.terrain?.update(centre.x, centre.z);
        draw(standing, weather.wetness);
      }
      if (centre !== null) markSynced();
    },
    listener() {
      writeListenerPose(listenerPose, pose.x, pose.y, pose.z, pose.yaw, pose.pitch);
      return listenerPose;
    },
    cameraPosition() {
      return { x: pose.x, y: pose.y, z: pose.z };
    },
    project(pos) {
      return projectToCanvas(pose, axes, fov, lens.near, canvas.clientWidth, canvas.clientHeight, pos.x, pos.y, pos.z);
    },
    resize() {
      // Fitted again whatever the size last seen: the device's pixel ratio may be what moved.
      fittedWidth = -1;
      if (standing !== null) fit(standing);
    },
    drawFrame() {
      if (standing === null) return;
      fit(standing);
      renderFrame(standing.engine, 1000 / 60);
    },
    runLoop(frame) {
      if (disposed) return;
      frames.add(frame);
      scheduled ??= requestAnimationFrame(tick);
    },
    stopLoop,
    onFrameEnd(fn) {
      frameEnds.add(fn);
      return () => void frameEnds.delete(fn);
    },
    dispose() {
      handle.dispose();
    },
    retire() {
      // Nothing of a Lite engine is kept for the next hike yet: it goes with its renderer.
      handle.dispose();
      return handle;
    },
    setFreecam(view) {
      freecam = view;
    },
    setHour(hour) {
      light.setHour(hour);
    },
    setWeather(next, fadeSeconds) {
      light.setWeather(next, fadeSeconds);
    },
    setView(hour, weather) {
      light.setView(hour, weather);
    },
    followHour(hour) {
      light.followHour(hour);
    },
    setBobScale(scale) {
      bob.setScale(scale);
    },
    wind() {
      return wind;
    },
    setWindOverride(next) {
      windOverride = next === null ? null : Math.min(1, Math.max(0, next));
    },
    async buildFirstClipmap(sliceMs, onRing) {
      await made;
      const terrain = standing?.terrain ?? null;
      if (terrain !== null) await stepSlices(terrain.firstBuild(onRing), sliceMs, () => disposed);
    },
    buildClipmapNow() {
      const terrain = standing?.terrain ?? null;
      if (terrain !== null) finish(terrain.firstBuild());
    },
  };
  return renderer;
}
