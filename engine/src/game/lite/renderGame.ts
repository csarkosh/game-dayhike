/**
 * What a game hands the renderer: its side of a frame. The renderer draws the world (the
 * terrain, the forest, the water, the sky, the weather) and calls a game's side at fixed points
 * of making itself and of each frame, for what is the game's own to draw and to say: its bodies
 * and its scenery, the camera a scene takes, the lamp, how far the horror look is turned, and
 * what the animals are told of the match. The points are named for the step of the renderer
 * they stand at, and their order is the renderer's.
 */
import type { EngineContext, MaterialPlugin, Mesh, PluginUniformBlock, SceneContext } from "@babylonjs/lite";
import type { Forest } from "../../sim/forest.js";
import type { emptyAtmosphereUniforms } from "../atmosphereParams.js";
import type { LampState } from "../lampParams.js";
import type { QualityTier } from "../quality.js";
import type { StareLens } from "../stareLens.js";
import type { SyncJobs } from "../syncJobs.js";
import type { WetUniforms } from "../wetSurface.js";
import type { PlayerPoint, WildlifeEvent } from "../wildlifeBehaviour.js";
import type { MatchState, View } from "../wildlifeDirector.js";
import type { CameraAxes, CameraPose, ViewFrustumPlane } from "./cameraPose.js";
import type { FrameUploads } from "./frameUploads.js";
import type { LiteShadeMask } from "./shadeMask.js";
import type { SkinClock } from "./skinnedModels.js";

/** What the renderer reads of a player to place the camera, the wind and the animals. */
export type RenderPlayer = {
  id: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  grounded: boolean;
};

/** What the renderer reads of a simulation's state. A game's state has these and its own beside them. */
export type RenderState<P extends RenderPlayer> = { tick: number; players: Map<number, P> };

/** What a renderer shares with a game's side for its whole life: read when a point is called, never copied. */
export type RenderHost = {
  readonly tier: QualityTier;
  /** Whether the frame goes through a post chain (the tiers above low) or is graded in its materials. */
  readonly chained: boolean;
  readonly forest: Forest | null;
  /** The frame's eye, the one record the renderer moves each frame. */
  readonly pose: CameraPose;
  readonly lens: { readonly near: number; readonly far: number; readonly fov: number };
  readonly jobs: SyncJobs;
  readonly uploads: FrameUploads;
  clock(): number;
  /** Whether the renderer stands: its scene is registered and every part of it is made. A frame's points are called only while it does. */
  stands(): boolean;
  disposed(): boolean;
  /** Settles when the renderer has been made, or could not be. */
  readonly whenMade: Promise<void>;
  /** The air's colour nearest the eye, as the sky last gave it. */
  nearColour(): { r: number; g: number; b: number };
  /** Has the rain's cover map drawn again: something that stood in it as hard cover has left. */
  redrawCover(): void;
};

/** What a game's parts are made with before the scene is registered, so their pipelines are in its first build. */
export type RenderMakeEarly = {
  engine: EngineContext;
  scene: SceneContext;
  shared: PluginUniformBlock;
};

/** The same, once the mask the shadow figures are drawn into is made (null where this world has none). */
export type RenderMakeMasked = RenderMakeEarly & { mask: LiteShadeMask | null };

/** What a game's parts are made with once the scene is registered. */
export type RenderMakeLate = RenderMakeMasked & {
  /** The air's plugin for a material, which every material that stands in the world's air wears. */
  air(): MaterialPlugin;
  /** The wet look's uniforms for a surface that takes at most `cap` of the weather's wetness. */
  wetAt(cap: number): WetUniforms;
  /** A plugin that draws a mesh a little ahead of where it stands, for a surface laid on another. */
  ahead(units: number, slope?: number): MaterialPlugin;
  skinClock: SkinClock;
  /** Where a mesh that keeps the rain off is told to the rain's cover map, where there is one. */
  hardCover: { add(mesh: Mesh, place?: MaterialPlugin): void; remove(mesh: Mesh): void } | undefined;
};

/** How far the horror look is turned, as a game last set it: the renderer reads these each frame. */
export type RenderLook = {
  /** The colour cast over the frame, 0 to 1. */
  cast: number;
  /** How far dread reaches the lens, 0 to 1. */
  unsettle: number;
  /** What the frame is dimmed by, 1 for no dimming: the exposure's where the materials grade, the chain's own where it does. */
  dim: number;
  /** The night's dread, which thickens the ground cloud, 0 to 1. */
  haunt: number;
  /** How far the mist has come in, 0 to 1. */
  mistIn: number;
};

/** What a scene's shot asks of the frame it is played on. */
export type RenderShot = {
  /** The shot's lens, or null for the game's own. */
  fov: number | null;
  /** Whom the world is built round, where it is not the local player. */
  centre: { x: number; z: number } | null;
  /** Whether the rain's cover follows the camera and not the local player. */
  coverAtEye: boolean;
};

/** The one lamp the lens carries, as a frame places it: a game's scene may move it and relight it. */
export type RenderLamp = {
  at: { x: number; y: number; z: number; dx: number; dy: number; dz: number; angle: number; range: number };
  lit: { on: boolean; state: LampState };
};

/** A path the ground cloud is kept off, in place of the trail: how far a place stands from it, and how the cloud meets its edge. */
export type RenderCloudPath = { distance(x: number, z: number): number; edge: number; fade: number };

/** What the animals are handed of the match each frame, made from a game's state. */
export type RenderWildlife<S> = {
  readonly director: { readonly view: View; readonly match: MatchState };
  players(state: S): readonly PlayerPoint[];
  look(state: S, x: number, y: number, z: number, yaw: number, pitch: number, fov: number, aspect: number, hour: number, mist: number): void;
  drain(source: WildlifeEvent[] | undefined): readonly WildlifeEvent[];
};

/** A game's side of one renderer: made with it, let go with it. */
export type RenderSide<S, P> = {
  readonly look: RenderLook;
  readonly wildlife: RenderWildlife<S>;

  // ---- making
  /** Adds the game's lights to the scene, after the renderer's own three: before any mesh is made, since a mesh is built for the lights its scene holds. */
  lights(scene: SceneContext): void;
  /** Makes the parts whose pipelines belong in the scene's first build: after the air's own, before the rain's. */
  early(make: RenderMakeEarly): void;
  /** Makes the parts that are drawn into the mask, once it is made and before the post chain is. */
  masked(make: RenderMakeMasked): void;
  /** Makes the parts that join a registered scene. */
  late(make: RenderMakeLate): void;
  /** The renderer stands: what was asked of a part before it was made is given to it now. */
  stood(): void;
  /** Lets go what was made late, before the mask is let go. */
  releaseBodies(): void;
  /** Lets go the rest, after the mask. */
  release(): void;
  /** Settles when the game's own models are in, for a world that waits to be shown whole. */
  ready(): Promise<unknown> | undefined;
  /** How many of the game's own files are still loading. */
  waiting(): number;
  /** Whether the scene is being built again for something of the game's (a new light): no frame is drawn meanwhile. */
  rebuilding(): boolean;

  // ---- a frame, in the renderer's order
  /** The frame opens: the state is in, nothing is placed yet. Called whether or not the renderer stands. */
  begin(state: S, localId: number, alpha: number, dt: number): void;
  /** Whether the local player's lamp is lit. */
  lampOn(local: P): boolean;
  /**
   * The local player's eye is placed in `pose`: a scene may take the camera from there, and says what its shot
   * asks. The record handed back is the side's own, read at once and written again next frame.
   */
  shot(seconds: number, pose: CameraPose, local: P, state: S, localId: number, alpha: number): RenderShot;
  /** The lamp is placed at the eye: a scene may move it. */
  lamp(lamp: RenderLamp): void;
  /** The air's own (the mist, the motes) are updated. */
  afterAir(seconds: number): void;
  /** The skinned bodies' clock has stepped. */
  bodies(dt: number, lamp: LampState): void;
  /** The view's planes are known; `cover` is the rain map's square on a frame that draws it. */
  seen(planes: ViewFrustumPlane[], cover: { x: number; z: number; half: number } | null): void;
  /** A path the ground cloud stands off this frame in place of the trail, or null: the same record while the path is the same. */
  cloudPath(): RenderCloudPath | null;
  /** The dark that closes on the frame, stepped: from the local player's state and what the eye is turned to. */
  stare(state: S, localId: number, pose: CameraPose, axes: CameraAxes, dt: number): StareLens;
  /** Where no chain grades the frame: what the game adds to the air's own uniforms. */
  haze(air: ReturnType<typeof emptyAtmosphereUniforms>): void;
  /** What a fault report says of the game's frame: whether a scene plays, whether an ending does, and how far its dark has closed. */
  facts(): { scene: boolean; ending: boolean; dark: number };
};

/** A game, as a renderer is made with it: its side, and the methods of its own the renderer wears beside its own. */
export type RenderGame<S, P, X> = (host: RenderHost) => { side: RenderSide<S, P>; api: X };
