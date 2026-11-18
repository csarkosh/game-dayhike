/**
 * The renderer as the hike holds it, the view it is handed and what it is
 * made with: types alone, which load nothing, so whatever holds a renderer
 * (the hike, the ladders that swap one for another, the staged scenes, the
 * tests) names it here and loads no engine by doing so. What is named of an
 * engine is named as the page holds it: a handle that can be let go of
 * and which engine it is (`engineHandle.ts`), the watch a
 * renderer keeps on one it made (`engineWatch.ts`) and the measurement
 * mode's report (`gpuTimeReport.ts`). No renderer is handed an engine here:
 * the hike's makes its own (`hikeRenderer.ts`).
 */
import type { Vec3, WorldState } from "../sim/types.js";
import type { ListenerPose } from "./ambientAudio.js";
import type { EngineHandle, EngineName } from "./engineHandle.js";
import type { WatchEngine } from "./engineWatch.js";
import type { EyePose } from "./eyeBlend.js";
import type { FirstBuilds } from "./firstBuilds.js";
import type { GpuTimeReport } from "./gpuTimeReport.js";
import type { PaintPaletteName } from "./gradeParams.js";
import type { ImpostorBake } from "./impostorBake.js";
import type { PreparedScene } from "./preparedScene.js";
import type { QualityTier } from "./quality.js";
import type { EndSceneNow, EndSceneSetup } from "./scenePlay.js";
import type { SkyTable } from "./skyTable.js";
import type { StareLens } from "./stareLens.js";
import type { SurfSound } from "./surfSound.js";
import type { WaterLifeSound } from "./waterLifeAudio.js";
import type { WeatherParams, WeatherPresetName } from "./weather.js";
import type { WildlifeEvent } from "./wildlifeBehaviour.js";
import type { WindRecord } from "./windParams.js";

/** The free camera's view; `fov` (rad, vertical) and `roll` (rad) are a film
 * shot's, absent for the game's own lens and no roll. */
export type FreecamView = { x: number; y: number; z: number; yaw: number; pitch: number; fov?: number; roll?: number };

/** This frame's view inputs that come from neither the world nor the clock. */
/** `before` is the local player's pose as the frame's last tick began
 * (`eyeBlend.ts`): the eye is drawn `alpha` of the way from it to the pose
 * now. Absent or null, the eye is drawn where the tick left it. */
export type FrameView = { dt: number; sprinting: boolean; before?: EyePose | null };

/**
 * The renderer as the hike holds it: what it is told, what it is asked, and
 * what it reads back, in the game's own terms. Nothing here says what draws
 * the world: the renderer on Babylon Lite the hike is given answers it
 * (`lite/renderer.ts`).
 */
export type Renderer = {
  /** The engine the renderer draws with, as the page holds one
   * (`engineHandle.ts`): what a failure is reported against. */
  readonly engine: EngineHandle;
  /** Which engine the renderer draws with, for its life: WebGPU for the
   * hike's renderer, which draws with nothing else. */
  readonly engineName: EngineName;
  /**
   * The renderer's own watch on the engine it made for itself
   * (`engineWatch.ts`): the hike's ladders put it on once the renderer stands
   * and answer what it tells (a lost device) by building the renderer again.
   * Null for a renderer that keeps none (a stand-in in a test).
   */
  readonly ownWatch: WatchEngine | null;
  /**
   * Resolves once a renderer that makes its engine for itself stands (true)
   * or cannot be made (false: it is handed back all the same, stays empty and
   * draws nothing). Absent on a renderer that stands from the moment it is
   * made (a stand-in in a test).
   */
  readonly whenMade?: Promise<boolean>;
  /** The measurement mode's readout (`?gpuTime`, `lite/gpuTimeReadout.ts`); null without it. */
  gpuTime: { read(): GpuTimeReport } | null;
  /** Resolves once the forest's first fill, billboards included, is drawn
   * (`ForestMeshes.ready`); at once in a world without a forest. */
  readonly forestReady: Promise<void>;
  /** Resolves at the end of the first `sync` that showed the shells where
   * the view is (a local player's place, or the free camera's): from then
   * each has begun its first build. A joiner the host has not welcomed has
   * no such frame yet. A renderer disposed first resolves it too. */
  readonly firstSynced: Promise<void>;
  /** Resolves once the sky's table holds the slices the lighting needs:
   * those either side of noon and of the hour the renderer is set to, read
   * again as each slice arrives (`whenSkyHeld`). Until then the lighting has
   * applied nothing, so no start draws a frame before it (the hike's, a
   * swap's, the scene routes', the tier check's) and the forest bakes no
   * billboard before it (`BakeOptions.sky`). Callers while it waits share
   * one wait; for a renderer disposed first it never resolves. */
  skyReady(): Promise<void>;
  /** Resolves once the world is in: the scene ready with nothing still
   * loading, and the forest's first fill drawn (`forestReady`), or after
   * `maxMs`, the bound of whoever waits (`worldWait.ts`). */
  whenReady(maxMs: number): Promise<void>;
  /** How many of the scene's loads (models, textures) are still in flight. */
  waitingItems(): number;
  /**
   * `frame` carries this frame's local, non-simulated view inputs — its
   * duration in seconds and whether sprint is held. Only the walking cue reads
   * them: its ease and landing dip are the one genuinely time-based part of the
   * render path, and sprint is input state the world snapshot does not carry.
   */
  sync(state: WorldState, localId: number, alpha: number, frame?: FrameView): void;
  /**
   * This frame's wildlife events, DRAINED: the shell's own list is emptied and
   * its contents handed over in a reused array, so calling this twice in a frame
   * yields the events once. Copying rather than returning the live list is what
   * makes that unambiguous — the alternative, handing out the shell's array and
   * clearing it later, has no moment at which "later" is both after the caller
   * read it and before the next `sync` appended to it. Empty for a
   * hand-authored level, which has no wildlife at all.
   */
  wildlifeEvents(): readonly WildlifeEvent[];
  /**
   * The wildlife director's own sighting log — `lite/wildlifeMeshes.ts`'s
   * `directorLog()`, read straight through. Empty for a hand-authored level
   * (no wildlife shell at all) and empty for as long as nothing has been
   * arranged for the player to see; a test seam, not something `app.ts` reads.
   */
  wildlifeDirectorLog(): readonly number[];
  /**
   * Whether this world has a wildlife shell at all. False for a hand-authored
   * level, which has no forest and therefore no animals — and so nothing for the
   * audio shell to voice, no reason to fetch its clips, and no reason to write
   * the listener every frame.
   */
  readonly hasWildlife: boolean;
  /**
   * Whether this world has the lake's insects and frogs (`waterLifeScene.ts`): a
   * forest world with a lake, the animals not turned off. False, `app.ts`
   * builds no audio for them.
   */
  readonly hasWaterLife: boolean;
  /**
   * The lake's life as heard on the last `sync` (`WaterLife.sound`): one
   * reused object, read by `app.ts` after each `sync`. Silent, never null,
   * without a lake, and after any `sync` that did not step it (the player's
   * branch with no local player), so no frame's calls are voiced twice.
   */
  waterLifeSound(): WaterLifeSound;
  /**
   * Whether this world has the sea's surf to hear (`surfSound.ts`): whether it
   * has a sea, on every tier, so a renderer swapped in on another tier says the
   * same. Fixed at the renderer's creation; false, `app.ts` builds no audio for it.
   */
  readonly hasSea: boolean;
  /**
   * The surf as heard on the last `sync`: one reused record, read by
   * `app.ts` after each `sync`. Silent and frozen (`SILENT_SURF_SOUND`), never
   * null, without a sea, before the swash's first fill and after any `sync`
   * that did not step it (the player's branch with no local player), so no
   * frame's plunges or backwash are voiced twice.
   */
  surfSound(): SurfSound;
  /**
   * Where the camera is and which way it looks, in Babylon's left-handed world
   * — `wildlifeAudio.ts` mirrors it for Web Audio. One reused object: this is
   * read every frame and its nine numbers are copied straight into AudioParams.
   */
  listener(): ListenerPose;
  /** Where the camera stands in the world, as the last `sync` left it: the
   * local player's eye where it followed the player, the free camera's place
   * under one, and where the camera was made, (0, 2, 0), before any `sync`.
   * A copy, the caller's to keep. */
  cameraPosition(): Vec3;
  /** The local player's stare as `sync` last stepped it, for the audio (stareAudio.ts). */
  stare(): StareLens;
  /** The chase's cast, 0 to 1 (escalation.ts): the grade pulls the frame toward burgundy by it. */
  setChase(cast: number): void;
  /** The haunt, 0 to 1 (escalation.ts): the pale mist at the player's sides comes in by it. */
  setHaunt(level: number): void;
  /** Hold the ground cloud's density at a level (0 to 1) whatever the night, or null to let the night set it; returns the density now drawn. */
  setMist(density: number | null): number;
  /** How far the mist has come in, 0 to 1 (acts.ts): the ground cloud rises by it, after the night. */
  setMistIn(level: number): void;
  /**
   * The end for this player, once; a second call changes nothing. Died: the
   * camera is the death's from now (ending.ts). Won: the end scene plays
   * over the player's camera from now (endScene.ts): the run, the car, the
   * road, the arrival judged each frame from the local body.
   */
  setEnding(kind: "died"): void;
  setEnding(kind: "won", scene: EndSceneSetup): void;
  /** The end scene as the last `sync` stepped it; null when none plays. One reused object. */
  endScene(): EndSceneNow | null;
  /** A scene (cutscene.ts): the camera is the scene's from now; the summit's five shots for SUMMIT_SCENE_S (`at` the body, with the Hollow's feet and the party's eye); the cap's for CAP_SCENE_S, turned to it. */
  setScene(kind: "summit" | "cap", at: { x: number; y: number; z: number }, more?: { hollow: { x: number; y: number; z: number }; party: { x: number; y: number; z: number } }, fromS?: number): void;
  /** A death's ending undone (a return in the chase, deathReturn.ts): the camera is the player's again and a scene's may run; its dark and blur lift over `liftS` seconds (at once by default). The won scene is left as it is. */
  clearEnding(liftS?: number): void;
  /**
   * A world point as CSS pixels on the canvas, with its distance from the
   * camera, or null when it is behind the camera. Drives the interact prompt.
   */
  project(pos: Vec3): { x: number; y: number; depth: number } | null;
  resize(): void;
  /** Draws one frame of the world as the last `sync` left it. */
  drawFrame(): void;
  /** Calls `frame` once for each frame the page shows from now on, until
   * `stopLoop`: the loop that steps the world and draws it. */
  runLoop(frame: () => void): void;
  /** Stops calling `frame`; with none named, every function `runLoop` was
   * given. */
  stopLoop(frame?: () => void): void;
  /** Calls `fn` at the end of each frame drawn; the function returned stops
   * it. */
  onFrameEnd(fn: () => void): () => void;
  /** Calls `fn` each time a shader has compiled, on either engine; the
   * function returned stops it. */
  onShaderCompiled(fn: () => void): () => void;
  /**
   * The engine has failed (`answerFailures`): the asynchronous work still
   * under way on it, which would otherwise poll a dead engine until the
   * rebuild disposes this renderer and report failures of its own, ends at
   * once and quietly: the forest's billboard bakes (`ForestMeshes.abandon`).
   * The renderer stands until `dispose`.
   */
  abandon(): void;
  /** Lets the renderer go, and its engine with it: none is kept. */
  dispose(): void;
  setFreecam(view: FreecamView | null): void;
  setWireframe(on: boolean): void;
  setSkinShading(on: boolean): void;
  setHour(hour: number): void;
  setWeather(next: WeatherParams, fadeSeconds?: number): void;
  /** The hour and the weather together, the weather at once, applied once
   * (`Lighting.setView`). */
  setView(hour: number, weather: WeatherParams): void;
  /** The sun's light alone at `hour`, on every frame between two `setView`s
   * (`Lighting.followHour`), so the shadows move with the hour. */
  followHour(hour: number): void;
  /** The weather preset the console set, which the lake's calm reads by
   * name (`calmShare`): its share fades from the last preset's to this one's
   * over `fadeSeconds` (3 absent, as `setWeather`'s), at once at 0. The
   * escalation's weather departs from it and keeps it. */
  setWeatherName(name: WeatherPresetName, fadeSeconds?: number): void;
  /** The painted palette by name (gradeParams.ts), faded in over `fadeSeconds` (the post chain's default unless given). */
  setPalette(name: PaintPaletteName, fadeSeconds?: number): void;
  /** 0 switches the walking cue off; 1 is the tuned default. */
  setBobScale(scale: number): void;
  /** 0 silences the lens-side dread effects; 1 is full. */
  setUnsettle(level: number): void;
  /** The wind record computed by the last `sync` (weather-driven, or the
   * `/wind` override) — what the foliage sways in (`lite/forestPlugins.ts`) and what
   * `ambientAudio.ts`'s wind bed hears. */
  wind(): WindRecord;
  /** How wet the canopy is, 0 to 1, as the rain stepped it on the last
   * `sync` (`canopyWaterStep`, `weather.ts`): what the drips are drawn from
   * and what `ambientAudio.ts`'s drip layer hears, one value for both. */
  canopyWater(): number;
  /** The canopy over the camera, 0 to 1, as the lens read it on the last
   * `sync` (`forestDensity`, read again once the camera has moved a metre):
   * what keeps the rain off the lens and what `ambientAudio.ts`'s drip layer
   * hears, one read for both. In freecam it is the camera's canopy, not the
   * player's: the drips hear what the lens sees. */
  canopyOver(): number;
  /** `null` restores the weather-driven speed; otherwise clamped to [0, 1]
   * and used in place of it (the `/wind` command). */
  setWindOverride(level: number | null): void;
  /** The far forest's billboard bakes as they stand (`ForestMeshes.impostorBakes`):
   * still baking, ready or failed, and how long each took. Empty without a
   * forest, or until its models have loaded. */
  impostorBakes(): readonly ImpostorBake[];
  /** Depth of field on or off, for a film shot's insert. The post chain has
   * no depth of field today, so this is nothing yet; the insert's blur is
   * the recording's. */
  setDepthOfField(on: boolean): void;
  /** The first clipmap build, for a renderer made with `deferClipmap`:
   * stepped, the thread given back whenever `sliceMs` have passed so the page
   * paints between, each ring's level told to `onRing` as it is sampled.
   * Nothing to do without a forest, or once it has run; a renderer disposed
   * while it runs ends it quietly, no slice touching the scene it lost. */
  buildFirstClipmap(sliceMs: number, onRing?: (level: number) => void): Promise<void>;
  /** The first clipmap build run whole, for a start with nothing to paint
   * between its slices. */
  buildClipmapNow(): void;
};

export type RendererOptions = {
  tier?: QualityTier;
  /** The clock (ms) the wind, the post effects and everything that moves
   * with time read; `performance.now` absent. A scene stepped a frame at a
   * time hands in its own, so the grass and the water move in step with it. */
  clock?: () => number;
  /** Where the hike's player starts (`trailheadStart`): the first terrain
   * rings and the water (its bed and its rings) are made around it, so the
   * player's first frame finds them in place. Absent or null (a world with
   * no trail), the origin and the level's first spawn, and that first frame
   * builds them again. */
  start?: { x: number; z: number } | null;
  /** The hike's first scene, sampled ahead by the world's worker
   * (`preparedScene.ts`): the terrain's rings, the water's rings, bed and
   * ocean field, and each lake's plants, life, surface and skyline. For the
   * hike's first renderer alone: the builders take its arrays as their own.
   * Each piece is used only where it is the one this renderer would sample
   * for its seed, terrain, tier and start; the rest it samples. */
  prepared?: PreparedScene | null;
  /** The loader of first builds, for a start whose intro's film covers the
   * hike (`firstBuilds.ts`): the forest, the ground cover, the blades, the
   * duff and the props hand it the builds that cannot wait, and it steps
   * them. Absent, each runs whole in the frame that asked for it. */
  firstBuilds?: FirstBuilds;
  /** Leave the clipmap's first build to `buildFirstClipmap` or
   * `buildClipmapNow`, so a start can step it between paints; the renderer
   * draws no terrain until one has run. Absent, it is built here as always. */
  deferClipmap?: boolean;
  /** The wildlife shell: absent or true, as the world's forest allows; false, none at
   * all (a scene recorded a frame at a time, which the director's own steps would not follow). */
  wildlife?: boolean;
  /** The sky's slices (`skyTable.ts`): the page's table, made once for its
   * life (`app.ts`) and handed to every renderer it builds, so a swap of
   * tier makes none of them again. Absent, the renderer starts a source of
   * its own (`startSkySource`) and stops it on dispose. */
  skyTable?: SkyTable;
  /** The measurement mode (`?gpuTime`, `parseGpuTime`, `gpuTimeReport.ts`): the GPU's timings
   * read out as `window.__gpuTime()` and a corner line (`lite/gpuTimeReadout.ts`), and
   * the render scale held at full. */
  gpuTime?: boolean;
};
