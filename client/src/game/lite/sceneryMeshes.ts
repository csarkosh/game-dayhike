/**
 * The scenery a hike places once, on Babylon Lite: the fingerposts at the
 * trail's junctions, the trailhead's car and board, and the body at the
 * crest, from what the game places them with (`signParts.ts`,
 * `sceneryParts.ts`, `boardDraw.ts`, `carShadow.ts`). The hike asks for
 * each through `hikeScenery.ts` and holds what it is handed back.
 *
 * - **Every post of a world is one draw, and every plank another.** A
 *   post and a plank are instances of their models' one mesh each, where
 *   the game makes a copy of the model a post and a plank; the planks'
 *   lettering, two faces a plank, is one mesh of every face under one
 *   picture (`sceneryPaint.ts`). Three draws while a post is in sight,
 *   whatever the junctions.
 * - **A model placed once is a mesh a material** (`sceneryModels.ts`): the
 *   board two, the car seven with its glass, the body two.
 * - **What is out of sight is not drawn.** Each post is a sphere and the
 *   car, the board and the body each the box of its own geometry, tested
 *   against the view's planes and against a reach past which it is under a
 *   pixel or two of the frame (`SIGN_REACH_M`, `SCENERY_REACH_M`); the
 *   posts' two lists hold the posts in sight and are written again only
 *   when that set changes. A frame with nothing of the scenery in sight has
 *   no draw and no write for it: the frame a player arrives in, the car
 *   behind them, among them.
 * - **The posts, the car and the board are hard cover for the rain**
 *   (`rainMap.ts`). Lite leaves a hidden mesh out of every pass, so what
 *   stands in the map's square is shown for the frame that draws the map.
 * - **Until a model arrives, and for good if it never does, the box the sim
 *   collides with is drawn in its place**, as the chunk props' boxes are
 *   (`propBoxes.ts`); the body's stand-in is its cross of dark timber and
 *   pale figure. The parked car gives way to the film's car when that
 *   arrives (`filmCar`), and is then let go: nothing
 *   shows it again.
 * - **The see-through parts stand at the world's origin** with their
 *   vertices in the world's own coordinates, at their places among the
 *   see-through draws (`SEE_THROUGH_ORDER`): the patch under the car, the
 *   planks' lettering and the board's face. A car's glass rides the car's
 *   own place and turn as its opaque parts do, and is ordered from the
 *   world's origin with the rest (`Mesh.sortOrigin`).
 * - **A car's glass is one draw, its panes listed farthest first**, so a
 *   pane seen through another is laid under it. The one mesh's
 *   triangles are listed pane by pane in that order, judged in the car's
 *   own frame, and written again on the frame the order changes: when the
 *   eye crosses between two panes.
 *
 * - **The end scene drives the car as it stands, one mesh a material**
 *   (`LiteCar.stage`). Its meshes, the glass among them, are moved by
 *   their own place and turn, which writes no vertex; the patch under it
 *   and its tail lamps, which stand in the world's own coordinates, are
 *   laid again where it goes; and the
 *   parts a pose turns (the four wheels, the steering wheel, the driver's
 *   door) are runs of its meshes' vertices, turned in the vertex stage: a
 *   vertex names its turn, a float sent once with the mesh, and the turns
 *   are the car's own small block (`carParts.ts`, `carTurnsPlugin`), each
 *   the part's turn in its own frame as three rows. A pose sends the rows
 *   of the parts it has moved, in one write, and no vertex: a door that
 *   swings on a car that stands sends no wheel's, and the door's window, a
 *   pane of the glass, is turned by the door's rows, its middle carried
 *   with it for the panes' order. A pose the car already stands at writes
 *   nothing, so a parked car costs a hike and the scene's first seconds
 *   nothing. The rain's cover map draws those meshes under the same
 *   turns. The tail lamps are one mesh, shown from the catch.
 * - **The film's car is drawn in its first frames wherever it stands**, its
 *   patch and its tail lamps with it (the lamps dark, in its middle), so
 *   the pipelines its draws need are made as the hike starts and not in the
 *   end scene's first frame (`warm`).
 *
 * - **A staged scene's own car stands with no parked car before it**
 *   (`filmCar` with `alone`), on a patch the air fogs as it fogs the road.
 *   Its handset is a run of one mesh's vertices, carried on the processor
 *   from its cradle into the hand a pose gives it (`scene/stageParts.ts`),
 *   sent as that run alone on a frame that moves it, and never while it rests.
 *   Its cord is one mesh the car carries: the tube `scene/cordTubeGeometry.ts`
 *   makes, laid in the car's own frame, so a
 *   cord that hangs still is written nothing however far the car drives,
 *   and one that swings is written its positions and normals whole.
 * - **A scene's actor is one skinned body** (`sceneActor.ts`), posed from
 *   its file with no engine and judged by the view as a sphere about it.
 *
 * The board's face is painted once, when its model and its two pictures
 * have each arrived or failed: the game paints it at once with stand-ins and
 * again with the pictures, over a board no frame has yet shown.
 */
import {
  addToScene, createCapsuleData, createMeshFromData, createPbrMaterial, createPluginUniformBlock, disposeMeshGpu, flushThinInstances, rebuildSceneRenderables, releaseTexture,
  removeFromScene, setMeshVisible,
  setThinInstanceCount, setThinInstances, updateMeshGeometryCapacity, updateMeshNormals, updateMeshPositions, updateMeshTangents, writePluginUniformBlock,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type PluginUniformBlock, type SceneContext, type ShaderMaterial, type Texture2D,
} from "@babylonjs/lite";
import type { SignPost } from "../../sim/signs.js";
import { SIGN_POST_HALF } from "../../sim/signs.js";
import { BOARD_BOXES, BOARD_BOX_HALF, BOARD_BOX_STEP, CAR_HALF, CAR_MATERIAL, KIOSK_MATERIAL, boardBoxes } from "../../sim/trailhead.js";
import { BOARD_TEXTURE } from "../boardFace.js";
import { BOARD_FACE_BIAS, BOARD_FACE_ROUGHNESS, drawBoard, loadBoardImage, type BoardDrawing } from "../boardDraw.js";
import { TURNED_PART_NAMES, TURN_ROW_FLOATS, partNumbers, poseVertices, restTurns, turnPoint, turnSlots, writeTurns, type PartsPose, type TurnSlot, type VertexRun } from "../carParts.js";
import { CAR_SHADOW_BIAS, CAR_SHADOW_HALF, carShadowGrid } from "../carShadow.js";
import { TAIL_LAMP_COLOUR } from "../endScene.js";
import { quatFromEuler, type Quat } from "@csarkosh/engine/game/instancePose";
import { PROP_ROUGHNESS, propBoxGeometry, propColour, type PropBox } from "@csarkosh/engine/game/propBoxes";
import type { Renderer } from "../rendererTypes.js";
import type { CarHandle } from "../scenePlay.js";
import { invertAffine } from "../scene/actorPose.js";
import { coiledCord } from "../scene/cord.js";
import { CORD_TUBE_RADIUS, createTubeGeometry, layTube, type TubeGeometry } from "../scene/cordTubeGeometry.js";
import { CORD, composeInto as composePlaced, cordEnds, decomposeInto, handsetCarry, handsetInCradle, multiplyInto, type Placed } from "../scene/stageParts.js";
import type { ActorPose, CarPose } from "../scene/timeline.js";
import {
  BODY_OUTPUT, BODY_STAND_IN, CAB_PARTS, CAB_SKY, FILM_CAR_OUTPUT, TRAILHEAD_CAR_OUTPUT, TRAILHEAD_KIOSK_OUTPUT, boardFaceCorners, boardYaw, carYaw,
  type TrailheadSites,
} from "../sceneryParts.js";
import {
  ARM_LENGTH, LABEL_ROUGHNESS, SIGN_ARM_OUTPUT, SIGN_POST_OUTPUT, signPlaces, squareEnd, type SignPlaces,
} from "../signParts.js";
import { emptyWetUniforms, type WetUniforms } from "@csarkosh/engine/game/wetSurface";
import { sphereInView } from "./capMesh.js";
import type { ViewFrustumPlane } from "@csarkosh/engine/game/lite/cameraPose";
import { DRAW_ORDER, SEE_THROUGH_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import { baseColourPlugin, surfaceWetPlugin } from "./forestPlugins.js";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import { loadSceneActor, type SceneActor } from "./sceneActor.js";
import {
  CAR_TURNS_BLOCK, CAR_TURNS_ROWS, carTurnsFields, carTurnsPlugin, dress, farthestFirst, listPanes, loadSceneryModel, partBytes, partMesh, placeMatrix, readsTangents,
  type SceneryModel, type SceneryPart,
} from "./sceneryModels.js";
import {
  TAIL_LAMP_INDICES, airPatchMaterial, faceGeometry, faceMesh, labelAtlas, labelGeometry, paintCanvas, paintLabelAtlas, paintMaterial, paintTexture, patchGeometry,
  patchMaterial, tailLampCorners, tailLampMaterial,
} from "./sceneryPaint.js";

/**
 * How far (m) a fingerpost is drawn from. A post is 0.11 m across and its
 * planks 0.2 m tall: past this they are a tenth and a fifth of a pixel of a
 * frame 956 rows tall, and no more than half a pixel of one 2,160 rows tall.
 */
export const SIGN_REACH_M = 600;
/** How far (m) the car, the board and the body are drawn from: the car, the longest of them, is under two pixels of a frame 956 rows tall past it. */
export const SCENERY_REACH_M = 1500;

/** The sphere (m) a post with its planks is tested against the view by, about its middle. */
const POST_SPHERE_M = 0.5 + ARM_LENGTH;
/** How far (m) the ground under the car may rise or fall across its patch: the patch's box is this tall either way. */
const PATCH_RISE_M = 0.5;

/** The scenery's places among the opaque draws, from `DRAW_ORDER.scenery`: a run a kind, a place a material in its file's order. */
const PLACES = { boxes: 0, posts: 8, planks: 16, board: 24, parked: 32, film: 48, cord: 62, tailLamps: 63, body: 64, standIn: 72, actor: 80 } as const;

/**
 * The frames the film's car is drawn for wherever it stands, from the frame
 * it lands: Lite makes a draw's pipeline in the frame that first draws it,
 * so the first is the one that makes them and the second is drawn with
 * them made.
 */
export const FILM_CAR_WARM_FRAMES = 2;

/** The point every see-through mesh of the hike is ordered from (`Mesh.sortOrigin`): the world's origin, where the rest of them stand. */
const WORLD_ORIGIN: readonly [number, number, number] = [0, 0, 0];

/** The world carried into the frame of a model stood at (x, y, z) turned by `yaw`, into `out`. */
function modelFrame(x: number, y: number, z: number, yaw: number, out: Float64Array): Float64Array {
  invertAffine(placeMatrix(x, y, z, yaw), 0, out, 0);
  return out;
}
/** The handset and its cradle, by their nodes' names in the film car's file. */
const HANDSET_NODE = "handset";
const CRADLE_NODE = "cradle";
/** The cord: thin dark rubber, #1c1d1f in linear light. */
export const CORD_COLOUR: readonly [number, number, number] = [0.0116, 0.0122, 0.0137];
export const CORD_ROUGHNESS = 0.7;
/** The sphere (m) a scene's actor is tested against the view by, about a point this far over its root. */
const ACTOR_SPHERE_M = 2;
const ACTOR_SPHERE_UP_M = 1;

/** What the scenery is drawn with. */
export type SceneryOptions = {
  /** The wet look's uniforms at a prop's cap (`wetUniforms`): filled in place each frame. */
  wet: WetUniforms;
  /** The air's plugin, one a material. */
  air: () => MaterialPlugin;
  /** A depth offset toward the eye (`depthAheadPlugin`): the buffer's steps, and the slope's share. */
  ahead: (units: number, slope?: number) => MaterialPlugin;
  /** The frame's block (`frameBlock.ts`). */
  shared: PluginUniformBlock;
  /** A post chain grades the frame: the hike's own stages hand their linear colour on. */
  linear: boolean;
  uploads?: FrameUploads;
  /**
   * The rain's cover map: the posts, the car and the board are hard cover.
   * `place`: the plugin that places the mesh's vertices, for a mesh whose
   * own material's vertex stage does (a car's turned parts).
   */
  cover?: { add(mesh: Mesh, place?: MaterialPlugin): void; remove(mesh: Mesh): void };
};

/** The view a frame is drawn from, as the scenery is judged by it. */
export type SceneryView = {
  planes: readonly ViewFrustumPlane[];
  eye: { readonly x: number; readonly y: number; readonly z: number };
  /** The square the rain's cover map is drawn over this frame, or null on a frame that does not draw it. */
  cover: { readonly x: number; readonly z: number; readonly half: number } | null;
};

/**
 * The car a scene drives (`CarHandle`), with the pose it is stood at each
 * frame: the whole of it, and its parts where it has them. `hand` is the
 * matrix in the world of the hand a staged scene's handset rides in while
 * the pose says so; absent or null, the handset is in its cradle.
 */
export type LiteCar = CarHandle & { stage(pose: CarPose, hand?: ArrayLike<number> | null): void };

/** A staged scene's actor as the scene holds it. */
export type LiteActor = {
  /**
   * Resolved once the actor's model has landed and the scene is built with
   * it, or it could not land. Whoever draws the scene draws no frame between
   * asking for the actor and this: the scene is built again as the actor
   * joins, and a frame drawn meanwhile reads what that takes down.
   */
  readonly settled: Promise<void>;
  /** Stands the actor as `pose` has it; a pose given before the model lands is the one it lands in. */
  stage(pose: ActorPose): void;
  /** The matrix in the world of the node named `name` as last staged, into `out`; null before the model lands and for a name it lacks. */
  joint(name: string, out: Float64Array): Float64Array | null;
  dispose(): void;
};

/** The trailhead as the hike holds it on Lite. */
export type LiteTrailhead = {
  /**
   * Fetches the film's car and stands it in the parked car's place; quietly
   * nothing once `signal` aborts. With `alone`, at a trailhead with no parked
   * car: a staged scene's own car, stood at the world's origin until its
   * first pose, with its handset and cord, on a patch of that darkness that
   * the air fogs. Resolved once the car has landed, or could not.
   */
  filmCar(signal: AbortSignal, alone?: { darkness: number }): Promise<void>;
  /** Whether the film's car stands in the parked car's place. */
  filmCarIn(): boolean;
  /** The car as it stands, for the end scene to drive: the film's car once it has landed, else the parked model; null while only its box stands, or with no car at all. The same object each call. */
  car(): LiteCar | null;
  /** Whether the film's car is still in its first frames, drawn wherever it stands (`FILM_CAR_WARM_FRAMES`). */
  warm(): boolean;
  dispose(): void;
};

/** What the hike asks of the renderer's scenery. */
export type SceneryHost = {
  /** The fingerposts `posts`, on ground `groundH`. */
  signs(posts: readonly SignPost[], groundH: (x: number, z: number) => number): { dispose(): void };
  /** The trailhead's car and board at `sites`, the board's face carrying `board`. */
  trailhead(sites: TrailheadSites, groundH: (x: number, z: number) => number, board: BoardDrawing): LiteTrailhead;
  /** The body at the crest. */
  body(body: { pos: { x: number; y: number; z: number }; yaw: number }): { dispose(): void };
  /** A staged scene's actor: the skinned model at `url`, hidden until a pose shows it. */
  actor(url: string): LiteActor;
  /**
   * Whether the world was still streaming in at the frame last synced: a
   * rebuild handed something of the streamed world to the GPU in it, or held
   * a hand-over back for a frame with room (`frameUploads.ts`). A job a
   * crossing began hands over within a few frames of it, so a run of frames
   * with none is a world that is in. False before the renderer stands.
   */
  streaming(): boolean;
};

/** The scenery as it stands in a scene. */
export type LiteScenery = SceneryHost & {
  /** Shows what the view holds and hides the rest. */
  update(view: SceneryView): void;
  /** Meshes shown by the last update. */
  readonly shown: number;
  dispose(): void;
};

/** `renderer`'s scenery, where it is the hike's own renderer on Babylon Lite; null for any other. */
export function liteSceneryOf(renderer: Renderer): SceneryHost | null {
  return "scenery" in renderer ? (renderer as unknown as { scenery: SceneryHost }).scenery : null;
}

/**
 * The scenery as the hike may ask for it before its renderer stands: an ask
 * is taken at once and handed to `scenery` when `ready` has resolved, and a
 * piece let go before then is never made. Null from `scenery` (a renderer
 * that could not be made, a world with no scenery) leaves every ask
 * unanswered.
 */
export function deferredScenery(ready: Promise<void>, scenery: () => LiteScenery | null): SceneryHost {
  /** An ask answered once the scenery stands, unless it was let go first. */
  function later<T extends { dispose(): void }>(make: (host: LiteScenery) => T): { made(): T | null; dispose(): void } {
    let live: T | null = null;
    let gone = false;
    void ready.then(() => {
      const host = gone ? null : scenery();
      if (host !== null) live = make(host);
    });
    return {
      made: () => live,
      dispose() {
        gone = true;
        live?.dispose();
        live = null;
      },
    };
  }
  return {
    streaming: () => scenery()?.streaming() ?? false,
    signs: (posts, groundH) => later((host) => host.signs(posts, groundH)),
    body: (body) => later((host) => host.body(body)),
    actor(url) {
      /** The pose asked for before the actor stood. */
      let pose: ActorPose | null = null;
      let settle: () => void = () => undefined;
      const settled = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const piece = later((host) => {
        const made = host.actor(url);
        if (pose !== null) made.stage(pose);
        void made.settled.then(settle);
        return made;
      });
      // A scenery that never stands has no actor to wait for.
      void ready.then(() => {
        if (piece.made() === null) settle();
      });
      return {
        settled,
        stage(next) {
          pose = next;
          piece.made()?.stage(next);
        },
        joint: (name, out) => piece.made()?.joint(name, out) ?? null,
        dispose: () => piece.dispose(),
      };
    },
    trailhead(sites, groundH, board) {
      /** The film's car asked for before the trailhead stood, and who waits on it. */
      let asked: { signal: AbortSignal; alone?: { darkness: number } } | null = null;
      const waiting: (() => void)[] = [];
      const landed = (): void => {
        for (const resolve of waiting.splice(0)) resolve();
      };
      const piece = later((host) => {
        const made = host.trailhead(sites, groundH, board);
        if (asked !== null) void made.filmCar(asked.signal, asked.alone).then(landed);
        return made;
      });
      // A scenery that never stands has no car to wait for.
      void ready.then(() => {
        if (piece.made() === null) landed();
      });
      return {
        filmCar(signal, alone) {
          const made = piece.made();
          if (made !== null) return made.filmCar(signal, alone);
          asked = alone === undefined ? { signal } : { signal, alone };
          return new Promise<void>((resolve) => void waiting.push(resolve));
        },
        filmCarIn: () => piece.made()?.filmCarIn() ?? false,
        car: () => piece.made()?.car() ?? null,
        warm: () => piece.made()?.warm() ?? false,
        dispose: () => piece.dispose(),
      };
    },
  };
}

/** Whether a sphere is in sight of `view`: within `reach` of the eye and inside the view's planes; or, for cover, in the square the cover map is drawn over. */
export function inSight(view: SceneryView, x: number, y: number, z: number, radius: number, reach: number, cover: boolean): boolean {
  if (cover && view.cover !== null && Math.abs(x - view.cover.x) <= view.cover.half + radius && Math.abs(z - view.cover.z) <= view.cover.half + radius) return true;
  const dx = x - view.eye.x, dy = y - view.eye.y, dz = z - view.eye.z;
  const far = reach + radius;
  if (dx * dx + dy * dy + dz * dz > far * far) return false;
  return sphereInView(view.planes, x, y, z, radius);
}

/** A box as a view is tested against it: its middle in the world, its half sizes along its own axes, and the turn about the vertical that stands those axes in the world. */
export type SightBox = { x: number; y: number; z: number; hx: number; hy: number; hz: number; cos: number; sin: number };

/** The box from `min` to `max` in the frame of a thing standing at (x, y, z) turned by `yaw` (the sim's: 0 faces +z, a quarter turn +x). */
export function sightBox(x: number, y: number, z: number, yaw: number, min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }): SightBox {
  const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2, cz = (min.z + max.z) / 2;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  return { x: x + cx * cos + cz * sin, y: y + cy, z: z - cx * sin + cz * cos, hx: (max.x - min.x) / 2, hy: (max.y - min.y) / 2, hz: (max.z - min.z) / 2, cos, sin };
}

/**
 * Whether a box is in sight of `view`: within `reach` of the eye and not
 * wholly outside any of the view's planes; or, for cover, in the square the
 * cover map is drawn over. A box and not a sphere, for what is long one way:
 * the car a player arrives in front of stands behind them, a stride from the
 * lens, and a sphere about it reaches into the view.
 */
export function boxInSight(view: SceneryView, box: SightBox, reach: number, cover: boolean): boolean {
  const round = Math.hypot(box.hx, box.hz);
  if (cover && view.cover !== null && Math.abs(box.x - view.cover.x) <= view.cover.half + round && Math.abs(box.z - view.cover.z) <= view.cover.half + round) return true;
  const dx = box.x - view.eye.x, dy = box.y - view.eye.y, dz = box.z - view.eye.z;
  const far = reach + Math.hypot(round, box.hy);
  if (dx * dx + dy * dy + dz * dz > far * far) return false;
  for (const plane of view.planes) {
    const n = plane.normal;
    // How far the box reaches along the plane's normal: each half size by how far its axis lies along it.
    const r = Math.abs(n.x * box.cos - n.z * box.sin) * box.hx + Math.abs(n.y) * box.hy + Math.abs(n.x * box.sin + n.z * box.cos) * box.hz;
    if (n.x * box.x + n.y * box.y + n.z * box.z + plane.d <= -r) return false;
  }
  return true;
}

/** Several geometries of positions, normals and triangles as one. */
function merged(parts: readonly { positions: Float32Array; normals: Float32Array; indices: Uint32Array }[]): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  let vertices = 0;
  let triangles = 0;
  for (const part of parts) {
    vertices += part.positions.length;
    triangles += part.indices.length;
  }
  const out = { positions: new Float32Array(vertices), normals: new Float32Array(vertices), indices: new Uint32Array(triangles) };
  let v = 0;
  let t = 0;
  for (const part of parts) {
    out.positions.set(part.positions, v);
    out.normals.set(part.normals, v);
    for (let i = 0; i < part.indices.length; i++) out.indices[t + i] = (part.indices[i] as number) + v / 3;
    v += part.positions.length;
    t += part.indices.length;
  }
  return out;
}

/** A see-through part as it stands: its mesh, which rides the model's place and turn, and the order its panes are listed in. */
type Glass = {
  mesh: Mesh;
  part: SceneryPart;
  /** The triangles as the mesh now draws them; the part's own are the file's. */
  drawn: Uint32Array;
  order: number[];
  /** The panes a pose turns (a door's window): each pane's number, and its turn's place among the car's. */
  runs: { pane: number; slot: number }[];
  /** The middle of each pane's box in the model's frame, as a pose has turned it: xyz a pane. */
  paneAt: Float32Array;
};

/**
 * A car's turns as its vertex stage reads them: the block of their rows, a
 * turn for each frame a part is turned in (`turnSlots`), the block's floats
 * that are the rows, and, by the model's parts, which turn each vertex of a
 * part's mesh takes (null for a part no pose turns) and where each turned
 * pane of it lies.
 */
type CarTurns = {
  block: PluginUniformBlock;
  slots: TurnSlot[];
  rows: Float32Array;
  numbers: (Float32Array | null)[];
  panes: { pane: number; slot: number }[][];
};

/**
 * A staged scene's handset: the runs of one mesh's vertices under its node,
 * the span that holds them, that mesh's vertices as they are sent, the
 * cradle's frame and the handset's own resting frame in the car's, the
 * handset's rest in its cradle, where it was last carried, and whether its
 * vertices now stand anywhere but at rest.
 */
type Handset = {
  holder: { mesh: Mesh; rest: VertexRun; posed: VertexRun | null };
  runs: { first: number; count: number }[];
  first: number;
  count: number;
  cradle: Float64Array;
  rest: Float64Array;
  restPlaced: Placed;
  held: Placed;
  carry: Float64Array;
  carried: boolean;
};

/** A staged scene's cord: its mesh, its tube in the car's own frame, and the two ends it was last laid between. */
type Cord = { mesh: Mesh; tube: TubeGeometry; ends: Float64Array };

/**
 * A model as it stands: its meshes, a mesh a part; of them the see-through
 * ones, laid in the world; the box of its geometry in its own frame and in
 * the world; where it stands; and, for a car, the turns of the parts a pose
 * turns and the pose they were last written for, and a staged scene's
 * handset and cord.
 */
type Stood = {
  model: SceneryModel;
  meshes: Mesh[];
  glass: Glass[];
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  box: SightBox;
  at: { x: number; y: number; z: number; yaw: number };
  /** The world carried into the model's own frame where it stands: what a pane's distance from the eye is judged in. */
  toModel: Float64Array;
  turns: CarTurns | null;
  turn: PartsPose;
  handset: Handset | null;
  cord: Cord | null;
};

/** A piece of the scenery as the frame's view is handed to it. */
type Piece = { seen(view: SceneryView): number; dispose(): void };

/** The scenery of `scene`: nothing until the hike asks for a piece. */
export function createLiteScenery(engine: EngineContext, scene: SceneContext, options: SceneryOptions): LiteScenery {
  const { uploads } = options;
  const orders = createDrawOrders(DRAW_ORDER.scenery);
  const pieces = new Set<Piece>();
  let disposed = false;
  let shown = 0;
  /** The last view handed over: a piece that lands between two frames is judged by it at once. */
  let last: SceneryView | null = null;
  /** The frames' views handed over so far. */
  let frames = 0;

  /** The material of a box drawn for a prop material's name, one a name: as the chunk props' boxes wear (`propMeshes.ts`). */
  const boxMaterials = new Map<string, PbrMaterialProps>();
  function boxMaterial(name: string): PbrMaterialProps {
    let made = boxMaterials.get(name);
    if (made === undefined) {
      const colour = propColour(name);
      made = createPbrMaterial({ baseColorFactor: [colour[0], colour[1], colour[2], 1], metallicFactor: 0, roughnessFactor: PROP_ROUGHNESS, usePhysicalLightFalloff: true });
      made.plugins = [baseColourPlugin(), surfaceWetPlugin(options.wet, options.shared), options.air()];
      orders.put(made, PLACES.boxes + boxMaterials.size);
      boxMaterials.set(name, made);
    }
    return made;
  }

  /** Adds `mesh` to the scene, hidden until a view holds it, at its material's place or at `place` among the see-through draws. */
  function stand(mesh: Mesh, bytes: number, place?: number): Mesh {
    mesh.renderOrder = place ?? orders.of(mesh.material as object) ?? DRAW_ORDER.scenery;
    setMeshVisible(mesh, false);
    addToScene(scene, mesh);
    uploads?.count("geometry", bytes, 4);
    uploads?.made();
    return mesh;
  }

  function drop(mesh: Mesh, cover = false): void {
    if (cover) options.cover?.remove(mesh);
    removeFromScene(scene, mesh);
    disposeMeshGpu(mesh);
    uploads?.dropped();
  }

  /** The boxes `boxes` as one mesh in the prop material `material`, hard cover while it stands. */
  function boxMesh(name: string, material: string, boxes: readonly PropBox[]): Mesh {
    const geometry = merged(boxes.map(propBoxGeometry));
    const mesh = createMeshFromData(engine, name, geometry.positions, geometry.normals, geometry.indices);
    mesh.material = boxMaterial(material);
    stand(mesh, geometry.positions.byteLength * 2 + geometry.indices.byteLength);
    options.cover?.add(mesh);
    return mesh;
  }

  /**
   * A model's parts dressed and given their places from `first`; the weather
   * soaks it where `wet`. Given a car's `turns`, a part that holds a turned
   * run wears the plugin that turns it.
   */
  function dressed(model: SceneryModel, first: number, wet: boolean, turns: CarTurns | null = null): void {
    for (const [n, part] of model.parts.entries()) {
      dress(part, { wet: wet ? options.wet : null, air: options.air, shared: options.shared });
      if (turns !== null && turns.numbers[n] !== null) part.material.plugins = [...(part.material.plugins ?? []), carTurnsPlugin(turns.block, readsTangents(part))];
      orders.put(part.material, first + n);
    }
  }

  /**
   * The turns of `model`, a car: a turn for each frame one of its primitives
   * hangs in under a part a pose turns, opaque or see-through, in a block of
   * the car's own that stands at rest. Null for a model with no such part.
   */
  function carTurnsOf(model: SceneryModel): CarTurns | null {
    const runs: { part: number; pane: number; name: string; local: Float32Array; first: number; count: number }[] = [];
    for (const [n, part] of model.parts.entries()) {
      for (const [i, pane] of part.panes.entries()) {
        const name = TURNED_PART_NAMES.find((node) => pane.nodes.includes(node));
        if (name !== undefined) runs.push({ part: n, pane: i, name, local: pane.local, first: pane.vertexFirst, count: pane.vertexCount });
      }
    }
    if (runs.length === 0) return null;
    const { slots, of } = turnSlots(runs);
    const block = createPluginUniformBlock(engine, CAR_TURNS_BLOCK, carTurnsFields(slots.length), "vertex");
    const at = (block.offsets.get(CAR_TURNS_ROWS) ?? 0) / 4;
    const rows = block.data.subarray(at, at + slots.length * TURN_ROW_FLOATS);
    rows.set(restTurns(slots.length));
    writePluginUniformBlock(engine, block);
    uploads?.count("uniforms", block.data.byteLength);
    const mine = model.parts.map((_, n) => runs.map((run, r) => ({ ...run, slot: of[r] as number })).filter((run) => run.part === n));
    return {
      block, slots, rows,
      numbers: model.parts.map((part, n) => ((mine[n] as (typeof mine)[number]).length === 0 ? null : partNumbers(part.positions.length / 3, mine[n] as (typeof mine)[number]))),
      panes: mine.map((list) => list.map(({ pane, slot }) => ({ pane, slot }))),
    };
  }

  /**
   * A model's meshes stood at (x, y, z) turned by `yaw`, each by its
   * mesh's own place and turn: a see-through one at the glass's place among
   * the see-through draws, ordered from the world's origin as they all are.
   * Given a car's `turns`, each vertex of a mesh that holds a turned run
   * names its turn, and the cover map draws that mesh under the same turns.
   */
  function standModel(name: string, model: SceneryModel, x: number, y: number, z: number, yaw: number, cover: boolean, turns: CarTurns | null = null): Stood {
    const turn = quatFromEuler(0, yaw, 0, { x: 0, y: 0, z: 0, w: 1 });
    const glass: Glass[] = [];
    const meshes = model.parts.map((part: SceneryPart, n) => {
      const mesh = partMesh(engine, `${name}_${n}`, part);
      const numbers = turns?.numbers[n] ?? null;
      if (numbers !== null) {
        // After the material: Lite reads a mesh's plugin vertex data by the material it wears. Sent once, with the mesh.
        mesh.pluginVertexData = numbers;
        uploads?.count("pluginVertices", numbers.byteLength);
      }
      if (part.blended) {
        // Lite orders a blended mesh by its origin's depth unless it is given another point: the world's origin, where
        // every other see-through mesh of the hike stands, so the glass keeps its place among them wherever the car is.
        mesh.sortOrigin = WORLD_ORIGIN;
        const paneAt = new Float32Array(part.panes.length * 3);
        for (const [i, pane] of part.panes.entries()) {
          paneAt[i * 3] = pane.x;
          paneAt[i * 3 + 1] = pane.y;
          paneAt[i * 3 + 2] = pane.z;
        }
        glass.push({ mesh, part, drawn: part.indices.slice(), order: part.panes.map((_, i) => i), runs: turns?.panes[n] ?? [], paneAt });
      }
      mesh.position.x = x;
      mesh.position.y = y;
      mesh.position.z = z;
      mesh.rotationQuaternion.x = turn.x;
      mesh.rotationQuaternion.y = turn.y;
      mesh.rotationQuaternion.z = turn.z;
      mesh.rotationQuaternion.w = turn.w;
      stand(mesh, partBytes(part), part.blended ? SEE_THROUGH_ORDER.glass : undefined);
      // The map's own material reads no map of normals, so no tangent.
      if (cover) options.cover?.add(mesh, numbers === null || turns === null ? undefined : carTurnsPlugin(turns.block, false));
      return mesh;
    });
    // The box of the model's own geometry, where it stands.
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const part of model.parts) {
      for (let i = 0; i + 2 < part.positions.length; i += 3) {
        min.x = Math.min(min.x, part.positions[i] as number);
        min.y = Math.min(min.y, part.positions[i + 1] as number);
        min.z = Math.min(min.z, part.positions[i + 2] as number);
        max.x = Math.max(max.x, part.positions[i] as number);
        max.y = Math.max(max.y, part.positions[i + 1] as number);
        max.z = Math.max(max.z, part.positions[i + 2] as number);
      }
    }
    return {
      model, meshes, glass, min, max, box: sightBox(x, y, z, yaw, min, max), at: { x, y, z, yaw }, toModel: modelFrame(x, y, z, yaw, new Float64Array(16)), turns,
      turn: { wheelSpin: 0, wheelTurn: 0, steer: 0, doorOpen: 0 },
      handset: null, cord: null,
    };
  }

  const turnScratch: Quat = { x: 0, y: 0, z: 0, w: 1 };
  const turnsMoved = { from: 0, to: 0 };

  /**
   * Turns `stood`'s parts to `pose`: the rows of each turn the pose has
   * moved written to the car's block and sent as one run of it, and the
   * middle of each see-through pane a turn carries (the door's window) moved
   * with it, for the panes' order. No vertex is sent. Nothing where the pose
   * turns the parts as they were last written.
   */
  function turnParts(stood: Stood, pose: CarPose): void {
    const turns = stood.turns;
    if (turns === null) return;
    if (!writeTurns(turns.slots, stood.turn, pose, turns.rows, turnsMoved)) return;
    const first = turns.rows.byteOffset - turns.block.data.byteOffset;
    writePluginUniformBlock(engine, turns.block, first + turnsMoved.from * 4, first + turnsMoved.to * 4);
    uploads?.count("uniforms", (turnsMoved.to - turnsMoved.from) * 4);
    for (const glass of stood.glass) {
      for (const run of glass.runs) {
        const pane = glass.part.panes[run.pane] as (typeof glass.part.panes)[number];
        turnPoint(turns.rows, run.slot, pane.x, pane.y, pane.z, glass.paneAt, run.pane * 3);
      }
    }
  }

  /**
   * The handset of `stood`, a staged scene's car: the runs of the opaque mesh
   * that holds its node's primitives, with the cradle's frame from a
   * primitive of the cradle's own. Null for a model with no such parts.
   */
  function handsetOf(stood: Stood): Handset | null {
    let cradle: Float32Array | null = null;
    let found: { n: number; part: SceneryPart; runs: { first: number; count: number }[]; local: Float32Array } | null = null;
    for (const [n, part] of stood.model.parts.entries()) {
      for (const pane of part.panes) {
        // A primitive hangs under its node, and the handset's node under the cradle's.
        const held = pane.nodes.includes(HANDSET_NODE);
        if (!held && pane.nodes.includes(CRADLE_NODE)) cradle ??= pane.local;
        if (!held || part.blended) continue;
        // One mesh holds the handset: the file gives its primitives one material.
        if (found === null) found = { n, part, runs: [], local: pane.local };
        if (found.n === n) found.runs.push({ first: pane.vertexFirst, count: pane.vertexCount });
      }
    }
    if (cradle === null || found === null) return null;
    const mesh = stood.meshes[found.n] as Mesh;
    const holder = { mesh, rest: found.part, posed: null };
    const first = Math.min(...found.runs.map((run) => run.first));
    const end = Math.max(...found.runs.map((run) => run.first + run.count));
    // The handset at rest in its cradle's own frame: the cradle's frame undone, then the handset's.
    const inverse = new Float64Array(16);
    invertAffine(cradle, 0, inverse, 0);
    const restPlaced = decomposeInto(multiplyInto(inverse, found.local, new Float64Array(16)), { position: [0, 0, 0], rotation: [0, 0, 0, 1], scaling: [1, 1, 1] });
    return {
      holder, runs: found.runs, first, count: end - first, cradle: Float64Array.from(cradle), rest: Float64Array.from(found.local), restPlaced,
      held: { position: [...restPlaced.position], rotation: [...restPlaced.rotation], scaling: [...restPlaced.scaling] },
      carry: new Float64Array(16).fill(Number.NaN), carried: false,
    };
  }

  const carPlaceInverse = new Float64Array(16);
  const handInCar = new Float64Array(16);
  const carryScratch = new Float64Array(16);

  /**
   * Carries `stood`'s handset where `pose` has it: into the grip of `hand`
   * (its matrix in the world) while the pose says the hand holds it, eased
   * from the cradle by the pose's grip; back to its rest otherwise. Its runs
   * are sent on a frame that moves them, and nothing while it rests or is
   * held still in the car.
   */
  function carryHandset(stood: Stood, pose: CarPose, hand: ArrayLike<number> | null): void {
    const handset = stood.handset;
    if (handset === null) return;
    const { holder } = handset;
    const send = (posed: VertexRun): void => {
      updateMeshPositions(engine, holder.mesh, posed.positions, handset.first, handset.count, handset.first);
      updateMeshNormals(engine, holder.mesh, posed.normals, handset.first, handset.count, handset.first);
      if (posed.tangents !== null) updateMeshTangents(engine, holder.mesh, posed.tangents, handset.first, handset.count, handset.first);
      uploads?.count("geometry", handset.count * (posed.tangents !== null ? 40 : 24), posed.tangents !== null ? 3 : 2);
    };
    if (hand === null || pose.handset !== "hand") {
      handsetInCradle(null, handset.cradle, handset.restPlaced, 0, handset.held);
      if (!handset.carried) return;
      // Back in its cradle: its vertices as the file has them.
      handset.carried = false;
      handset.carry.fill(Number.NaN);
      const posed = holder.posed;
      if (posed === null) return;
      for (const run of handset.runs) {
        posed.positions.set(holder.rest.positions.subarray(run.first * 3, (run.first + run.count) * 3), run.first * 3);
        posed.normals.set(holder.rest.normals.subarray(run.first * 3, (run.first + run.count) * 3), run.first * 3);
        if (posed.tangents !== null && holder.rest.tangents !== null) posed.tangents.set(holder.rest.tangents.subarray(run.first * 4, (run.first + run.count) * 4), run.first * 4);
      }
      send(posed);
      return;
    }
    // The hand in the car's own frame: the car's place undone.
    const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    carPlaceInverse[0] = c; carPlaceInverse[1] = 0; carPlaceInverse[2] = s; carPlaceInverse[3] = 0;
    carPlaceInverse[4] = 0; carPlaceInverse[5] = 1; carPlaceInverse[6] = 0; carPlaceInverse[7] = 0;
    carPlaceInverse[8] = -s; carPlaceInverse[9] = 0; carPlaceInverse[10] = c; carPlaceInverse[11] = 0;
    carPlaceInverse[12] = -(c * pose.x - s * pose.z); carPlaceInverse[13] = -pose.y; carPlaceInverse[14] = -(s * pose.x + c * pose.z); carPlaceInverse[15] = 1;
    multiplyInto(carPlaceInverse, hand, handInCar);
    handsetInCradle(handInCar, handset.cradle, handset.restPlaced, pose.grip ?? 1, handset.held);
    handsetCarry(handset.cradle, handset.held, handset.rest, carryScratch);
    if (handset.carried && carryScratch.every((value, i) => value === handset.carry[i])) return;
    handset.carry.set(carryScratch);
    handset.carried = true;
    const posed = (holder.posed ??= { positions: holder.rest.positions.slice(), normals: holder.rest.normals.slice(), tangents: holder.rest.tangents?.slice() ?? null });
    for (const run of handset.runs) poseVertices(carryScratch, holder.rest, posed, run.first, run.count);
    send(posed);
  }

  /** A staged scene's cord for `stood`: one mesh under a matt dark material that takes the cab's share of the sky, the car's to carry. */
  function cordOf(stood: Stood, name: string): Cord {
    const tube = createTubeGeometry(CORD.points);
    const material = createPbrMaterial({
      baseColorFactor: [CORD_COLOUR[0], CORD_COLOUR[1], CORD_COLOUR[2], 1], metallicFactor: 0, roughnessFactor: CORD_ROUGHNESS, environmentIntensity: CAB_SKY,
      usePhysicalLightFalloff: true,
    });
    material.plugins = [options.air()];
    orders.put(material, PLACES.cord);
    const mesh = createMeshFromData(engine, name, tube.positions, tube.normals, tube.indices);
    mesh.material = material;
    mesh.position.x = stood.at.x;
    mesh.position.y = stood.at.y;
    mesh.position.z = stood.at.z;
    const turn = quatFromEuler(0, stood.at.yaw, 0, turnScratch);
    mesh.rotationQuaternion.x = turn.x;
    mesh.rotationQuaternion.y = turn.y;
    mesh.rotationQuaternion.z = turn.z;
    mesh.rotationQuaternion.w = turn.w;
    stand(mesh, tube.positions.byteLength * 2 + tube.indices.byteLength);
    return { mesh, tube, ends: new Float64Array(6).fill(Number.NaN) };
  }

  const heldMatrix = new Float64Array(16);
  const handsetInCar = new Float64Array(16);
  const cordFrom = { x: 0, y: 0, z: 0 };
  const cordTo = { x: 0, y: 0, z: 0 };

  /**
   * Lays `stood`'s cord from the radio's socket to the handset's foot, in
   * the car's own frame: its tube written whole where an end has moved in
   * the car, and nothing where both stand as they were last laid.
   */
  function layCord(stood: Stood): void {
    const { cord, handset } = stood;
    if (cord === null || handset === null) return;
    multiplyInto(handset.cradle, composePlaced(handset.held, heldMatrix), handsetInCar);
    cordEnds(handset.cradle, handsetInCar, cordFrom, cordTo);
    const ends = cord.ends;
    if (ends[0] === cordFrom.x && ends[1] === cordFrom.y && ends[2] === cordFrom.z && ends[3] === cordTo.x && ends[4] === cordTo.y && ends[5] === cordTo.z) return;
    ends[0] = cordFrom.x; ends[1] = cordFrom.y; ends[2] = cordFrom.z;
    ends[3] = cordTo.x; ends[4] = cordTo.y; ends[5] = cordTo.z;
    layTube(coiledCord(cordFrom, cordTo, CORD), CORD_TUBE_RADIUS, cord.tube);
    updateMeshPositions(engine, cord.mesh, cord.tube.positions);
    updateMeshNormals(engine, cord.mesh, cord.tube.normals);
    uploads?.count("geometry", cord.tube.positions.byteLength * 2, 2);
  }

  /**
   * Stands `stood` at (x, y, z) turned by `yaw`, each mesh by its own place
   * and turn, the glass as the rest: no vertex is written; true where it
   * moved.
   */
  function moveModel(stood: Stood, x: number, y: number, z: number, yaw: number): boolean {
    const was = stood.at;
    if (was.x === x && was.y === y && was.z === z && was.yaw === yaw) return false;
    was.x = x;
    was.y = y;
    was.z = z;
    was.yaw = yaw;
    const turn = quatFromEuler(0, yaw, 0, turnScratch);
    if (stood.cord !== null) {
      // The cord rides the car: its tube is laid in the car's own frame.
      const mesh = stood.cord.mesh;
      mesh.position.x = x;
      mesh.position.y = y;
      mesh.position.z = z;
      mesh.rotationQuaternion.x = turn.x;
      mesh.rotationQuaternion.y = turn.y;
      mesh.rotationQuaternion.z = turn.z;
      mesh.rotationQuaternion.w = turn.w;
    }
    for (const mesh of stood.meshes) {
      mesh.position.x = x;
      mesh.position.y = y;
      mesh.position.z = z;
      mesh.rotationQuaternion.x = turn.x;
      mesh.rotationQuaternion.y = turn.y;
      mesh.rotationQuaternion.z = turn.z;
      mesh.rotationQuaternion.w = turn.w;
    }
    modelFrame(x, y, z, yaw, stood.toModel);
    stood.box = sightBox(x, y, z, yaw, stood.min, stood.max);
    return true;
  }

  /**
   * Lists each glass's panes farthest first from `eye`, where that is not
   * the order its mesh draws them in. The eye is carried into the model's own
   * frame, where the panes' middles are kept: a distance is the same in
   * either.
   */
  const nextOrder: number[] = [];
  const modelEye = { x: 0, y: 0, z: 0 };
  function orderGlass(stood: Stood, eye: SceneryView["eye"]): void {
    if (stood.glass.length === 0) return;
    const m = stood.toModel;
    modelEye.x = (m[0] as number) * eye.x + (m[4] as number) * eye.y + (m[8] as number) * eye.z + (m[12] as number);
    modelEye.y = (m[1] as number) * eye.x + (m[5] as number) * eye.y + (m[9] as number) * eye.z + (m[13] as number);
    modelEye.z = (m[2] as number) * eye.x + (m[6] as number) * eye.y + (m[10] as number) * eye.z + (m[14] as number);
    for (const glass of stood.glass) {
      if (glass.part.panes.length < 2) continue;
      farthestFirst(glass.paneAt, modelEye, nextOrder);
      if (nextOrder.every((pane, i) => pane === glass.order[i])) continue;
      for (const [i, pane] of nextOrder.entries()) glass.order[i] = pane;
      const held = glass.part;
      listPanes(glass.part.indices, glass.part.panes, glass.order, glass.drawn);
      updateMeshGeometryCapacity(
        engine, glass.mesh, held.positions, held.normals, glass.drawn, glass.part.uvs, undefined, held.tangents ?? undefined, undefined, 1,
        { vertices: [], indices: [{ offset: 0, count: glass.drawn.length }] },
      );
      uploads?.count("geometry", glass.drawn.byteLength);
    }
  }

  /** The wet look on a body: the weather's gloss at no porosity, as the hike's bodies take it. The cap is all a material keeps of it beside the frame's block. */
  const bodyWet = emptyWetUniforms();
  bodyWet.wetCap[0] = 0;

  /** Shows or hides `meshes`; how many are shown. */
  function show(meshes: readonly Mesh[], on: boolean): number {
    for (const mesh of meshes) setMeshVisible(mesh, on);
    return on ? meshes.length : 0;
  }

  /** Takes `piece` into the frames' updates, judged at once by the last view. */
  function join<T extends Piece>(piece: T): T {
    pieces.add(piece);
    return piece;
  }
  /** A piece's meshes changed between two frames: judged again by the last view. */
  function again(piece: Piece): void {
    if (last !== null && pieces.has(piece)) piece.seen(last);
  }

  return {
    get shown() {
      return shown;
    },
    streaming: () => uploads !== undefined && (uploads.last.streamed > 0 || uploads.last.held > 0),
    update(view) {
      if (disposed) return;
      last = view;
      frames++;
      let n = 0;
      for (const piece of pieces) n += piece.seen(view);
      shown = n;
    },

    signs(posts, groundH) {
      const loads = new AbortController();
      let gone = false;
      /** The posts' feet and heights: known before any model (`signPlaces` with no plank's end yet). */
      let places: SignPlaces = signPlaces(posts, groundH, 0);
      let boxes: Mesh | null = posts.length === 0 || disposed
        ? null
        : boxMesh("sign_boxes", "signpost", posts.map((post, p) => ({
          name: `sign_${p}_box`, material: "signpost", x: post.x, y: groundH(post.x, post.z) + SIGN_POST_HALF.y, z: post.z,
          width: 2 * SIGN_POST_HALF.x, height: 2 * SIGN_POST_HALF.y, depth: 2 * SIGN_POST_HALF.z,
        })));
      let postModel: SceneryModel | null = null;
      let armModel: SceneryModel | null = null;
      let postMeshes: Mesh[] = [];
      let plankMeshes: Mesh[] = [];
      /** The matrices the posts' and the planks' meshes draw from: the posts in sight first. */
      const postList = new Float32Array(Math.max(1, posts.length) * 16);
      let plankList = new Float32Array(16);
      let labels: Mesh | null = null;
      let lettering: Texture2D | null = null;
      /** Which posts the lists were last written for, a mark a post. */
      let listed = "";

      const piece = join<Piece>({
        seen(view) {
          let marks = "";
          let any = false;
          for (const post of places.posts) {
            const on = inSight(view, post.x, post.y + post.height / 2, post.z, POST_SPHERE_M, SIGN_REACH_M, true);
            marks += on ? "1" : "0";
            any ||= on;
          }
          if (boxes !== null) setMeshVisible(boxes, any);
          if (marks !== listed) {
            listed = marks;
            let p = 0;
            let k = 0;
            for (const [i, post] of places.posts.entries()) {
              if (marks[i] !== "1") continue;
              postList.set(places.postMatrices.subarray(i * 16, i * 16 + 16), p * 16);
              p++;
              if (plankMeshes.length > 0) {
                plankList.set(places.plankMatrices.subarray(post.plank * 16, (post.plank + post.planks) * 16), k * 16);
                k += post.planks;
              }
            }
            for (const mesh of postMeshes) {
              setThinInstanceCount(mesh, p);
              if (p > 0) flushThinInstances(mesh);
              setMeshVisible(mesh, p > 0);
            }
            for (const mesh of plankMeshes) {
              setThinInstanceCount(mesh, k);
              if (k > 0) flushThinInstances(mesh);
              setMeshVisible(mesh, k > 0);
            }
            if (p + k > 0) uploads?.count("instances", (p * postMeshes.length + k * plankMeshes.length) * 64, postMeshes.length + plankMeshes.length);
            uploads?.composed(p * postMeshes.length + k * plankMeshes.length);
          }
          // The lettering is the planks': drawn while any post is in sight of the view itself.
          if (labels !== null) setMeshVisible(labels, any && plankMeshes.length > 0);
          return (boxes !== null && any ? 1 : 0) + (any ? postMeshes.length + plankMeshes.length + (labels !== null && plankMeshes.length > 0 ? 1 : 0) : 0);
        },
        dispose() {
          if (gone) return;
          gone = true;
          loads.abort();
          pieces.delete(piece);
          if (boxes !== null) drop(boxes, true);
          for (const mesh of [...postMeshes, ...plankMeshes]) drop(mesh, true);
          if (labels !== null) drop(labels);
          if (lettering !== null) releaseTexture(lettering);
          postModel?.release();
          armModel?.release();
        },
      });

      /** A model's parts as instanced meshes drawing from `list`, none shown until a view holds a post. */
      function instanced(name: string, model: SceneryModel, list: Float32Array, capacity: number): Mesh[] {
        return model.parts.map((part, n) => {
          const mesh = partMesh(engine, `${name}_${n}`, part);
          setThinInstances(mesh, list, capacity);
          setThinInstanceCount(mesh, 0);
          stand(mesh, partBytes(part));
          options.cover?.add(mesh);
          return mesh;
        });
      }

      if (posts.length > 0 && !disposed) {
        void loadSceneryModel(engine, SIGN_POST_OUTPUT, loads.signal).then((model) => {
          if (gone) {
            model.release();
            return;
          }
          postModel = model;
          dressed(model, PLACES.posts, true);
          postMeshes = instanced("sign_posts", model, postList, posts.length);
          // The boxes gave way to the posts.
          if (boxes !== null) drop(boxes, true);
          boxes = null;
          listed = "";
          again(piece);
        }).catch((error: unknown) => {
          // A missing model costs the look, never the collider: the boxes stay.
          if (!loads.signal.aborted) console.warn("the fingerposts' model could not be made; their boxes stand", error);
        });
        void loadSceneryModel(engine, SIGN_ARM_OUTPUT, loads.signal, { also: ["LOD1", "LOD2"] }).then(async (model) => {
          if (gone) {
            model.release();
            return;
          }
          armModel = model;
          // The plank's inner end cut square, on the part that is drawn; the end's place is the farthest of every
          // level's of the file, as the game takes it.
          let end = 0;
          for (const part of model.parts) end = Math.max(end, squareEnd(part)?.end ?? 0);
          for (const level of model.also.values()) {
            for (const part of level) end = Math.max(end, squareEnd(part)?.end ?? 0);
          }
          places = signPlaces(posts, groundH, end);
          dressed(model, PLACES.planks, true);
          plankList = new Float32Array(Math.max(1, places.plankMatrices.length));
          const planks = instanced("sign_planks", model, plankList, places.plankMatrices.length / 16);
          // The lettering: every name's in one picture, every face of every plank one mesh under it.
          const atlas = labelAtlas(places.names);
          const { canvas, ctx } = paintCanvas(atlas.width, atlas.height);
          paintLabelAtlas(ctx, atlas);
          const picture = await paintTexture(engine, canvas);
          if (gone) {
            for (const mesh of planks) drop(mesh, true);
            releaseTexture(picture);
            model.release();
            return;
          }
          uploads?.count("textures", atlas.width * atlas.height * 4);
          lettering = picture;
          // A millimetre off the face is plenty up close; the slope's share of the bias keeps it on top at range.
          const material = paintMaterial(picture, LABEL_ROUGHNESS, options.air, options.ahead(0, 1));
          const geometry = labelGeometry(places.labels, atlas);
          labels = stand(faceMesh(engine, "sign_labels", geometry, material), geometry.positions.byteLength * 2 + geometry.uvs.byteLength + geometry.indices.byteLength, SEE_THROUGH_ORDER.lettering);
          plankMeshes = planks;
          listed = "";
          again(piece);
        }).catch((error: unknown) => {
          // A plank that never arrives is simply not drawn.
          if (!loads.signal.aborted) console.warn("the fingerposts' planks could not be made; the posts stand bare", error);
        });
      }
      return piece;
    },

    trailhead(sites, groundH, board) {
      const loads = new AbortController();
      let gone = false;
      const car = sites.car ?? null;
      /** Where the car stands: the parked car's site, or the world's origin for a staged scene's own car until its first pose. */
      let carAt = car === null ? null : { x: car.site.x, y: groundH(car.site.x, car.site.z), z: car.site.z, yaw: carYaw(car.site, car.trailhead) };
      const boardAt = { x: sites.board.x, y: groundH(sites.board.x, sites.board.z), z: sites.board.z, yaw: boardYaw(sites.board) };
      let carBox: Mesh | null = carAt === null || disposed
        ? null
        : boxMesh("trailhead_car_box", CAR_MATERIAL, [{
          name: "trailhead_car_box", material: CAR_MATERIAL, x: carAt.x, y: carAt.y + CAR_HALF.y, z: carAt.z, width: 2 * CAR_HALF.x, height: 2 * CAR_HALF.y, depth: 2 * CAR_HALF.z,
        }]);
      let kioskBoxes: Mesh | null = disposed
        ? null
        : boxMesh("trailhead_kiosk_boxes", KIOSK_MATERIAL, boardBoxes(sites.board).map((b, k) => ({
          name: `trailhead_kiosk_box_${k}`, material: KIOSK_MATERIAL, x: b.x, y: groundH(b.x, b.z) + BOARD_BOX_HALF.y, z: b.z,
          width: 2 * BOARD_BOX_HALF.x, height: 2 * BOARD_BOX_HALF.y, depth: 2 * BOARD_BOX_HALF.z,
        })));
      // The patch under the car, box or model: laid on the ground under it until the film's car brings its own.
      let patchStage: ShaderMaterial | null = null;
      function patchMesh(geometry: ReturnType<typeof patchGeometry>): Mesh {
        patchStage ??= patchMaterial(engine, options.shared, options.linear);
        const mesh = createMeshFromData(engine, "trailhead_car_shadow", geometry.positions, geometry.normals, geometry.indices, geometry.uvs);
        mesh.material = patchStage;
        return stand(mesh, geometry.positions.byteLength * 2 + geometry.uvs.byteLength + geometry.indices.byteLength, SEE_THROUGH_ORDER.carShadow);
      }
      let patch: Mesh | null = car === null || disposed ? null : patchMesh(patchGeometry(carShadowGrid(car.site, groundH)));
      /** The picture of a staged scene's own patch, which the air fogs: let go with the trailhead. */
      let fogged: Texture2D | null = null;
      let parked: Stood | null = null;
      let film: Stood | null = null;
      let kiosk: Stood | null = null;
      /** The handles the end scene drives each car by, made with it. */
      let parkedCar: LiteCar | null = null;
      let filmCar: LiteCar | null = null;
      /** The film's car's tail lamps, one mesh: lit from the catch, dark in the car's middle through its first frames, hidden otherwise. */
      let tails: { mesh: Mesh; corners: Float32Array; lit: boolean; colour(r: number, g: number, b: number): void } | null = null;
      /** The film's car's flat patch as it is laid under the car where it goes. */
      const flatPatch = carShadowGrid({ x: 0, z: 0 }, () => 0);
      /** The frame the film's car's first frames end at. */
      let warmUntil = 0;
      // What the view is tested against until a model lands: the boxes the sim collides with; and the patch's own.
      const boxAt = (at: { x: number; y: number; z: number; yaw: number }): SightBox =>
        sightBox(at.x, at.y, at.z, at.yaw, { x: -CAR_HALF.x, y: 0, z: -CAR_HALF.z }, { x: CAR_HALF.x, y: 2 * CAR_HALF.y, z: CAR_HALF.z });
      let carBounds = carAt === null ? null : boxAt(carAt);
      const patchBox = (x: number, y: number, z: number, yaw: number): SightBox =>
        sightBox(x, y, z, yaw, { x: -CAR_SHADOW_HALF.x, y: -PATCH_RISE_M, z: -CAR_SHADOW_HALF.z }, { x: CAR_SHADOW_HALF.x, y: PATCH_RISE_M, z: CAR_SHADOW_HALF.z });
      let patchBounds = carAt === null ? null : patchBox(carAt.x, carAt.y, carAt.z, carAt.yaw);

      /** The handle the end scene drives `stood` by: the whole car moved, its parts turned; with the film's car, its patch and its tail lamps carried along. */
      function carHandle(stood: Stood, riding: boolean): LiteCar {
        return {
          stage(pose, hand = null) {
            if (gone || (stood !== film && stood !== parked)) return;
            turnParts(stood, pose);
            // A staged scene's handset and its cord: in the car's own frame, so neither is written for the car's moving.
            if (stood.handset !== null) {
              carryHandset(stood, pose, hand);
              layCord(stood);
            }
            if (!moveModel(stood, pose.x, pose.y, pose.z, pose.yaw) || !riding) return;
            if (patch !== null) {
              const laid = patchGeometry({ ...flatPatch, origin: { x: pose.x, y: pose.y + flatPatch.origin.y, z: pose.z } }, pose.yaw);
              updateMeshPositions(engine, patch, laid.positions);
              uploads?.count("geometry", laid.positions.byteLength);
              patchBounds = patchBox(pose.x, pose.y, pose.z, pose.yaw);
            }
            if (tails !== null) {
              updateMeshPositions(engine, tails.mesh, tailLampCorners(pose.x, pose.y, pose.z, pose.yaw, tails.corners, tails.lit ? undefined : 0));
              uploads?.count("geometry", tails.corners.byteLength);
            }
          },
          leave() {
            for (const mesh of stood.meshes) options.cover?.remove(mesh);
          },
          tailLamps(on) {
            if (!riding || tails === null || tails.lit === on) return;
            tails.lit = on;
            if (on) tails.colour(TAIL_LAMP_COLOUR[0], TAIL_LAMP_COLOUR[1], TAIL_LAMP_COLOUR[2]);
            else tails.colour(0, 0, 0);
            updateMeshPositions(engine, tails.mesh, tailLampCorners(stood.at.x, stood.at.y, stood.at.z, stood.at.yaw, tails.corners, on ? undefined : 0));
            uploads?.count("geometry", tails.corners.byteLength);
            again(piece);
          },
        };
      }
      const boardSpan = ((BOARD_BOXES - 1) / 2) * BOARD_BOX_STEP + BOARD_BOX_HALF.x;
      const boardBounds = sightBox(boardAt.x, boardAt.y, boardAt.z, boardAt.yaw, { x: -boardSpan, y: 0, z: -BOARD_BOX_HALF.z }, { x: boardSpan, y: 2 * BOARD_BOX_HALF.y, z: BOARD_BOX_HALF.z });
      let face: Mesh | null = null;
      let facePicture: Texture2D | null = null;
      let filmAsked = false;

      function dropModel(stood: Stood | null): void {
        if (stood === null) return;
        for (const mesh of stood.meshes) drop(mesh, true);
        stood.model.release();
      }

      const piece = join<Piece>({
        seen(view) {
          let n = 0;
          if (carBounds !== null && patchBounds !== null) {
            const bounds = film?.box ?? parked?.box ?? carBounds;
            // The film's car is drawn through its first frames wherever it stands, its patch and its dark lamps with it.
            const warming = film !== null && frames < warmUntil;
            const on = warming || boxInSight(view, bounds, SCENERY_REACH_M, true);
            if (carBox !== null) n += show([carBox], on);
            if (parked !== null) n += show(parked.meshes, on);
            if (film !== null) n += show(film.meshes, on);
            if (tails !== null) n += show([tails.mesh], warming || (tails.lit && on));
            // The glass's panes farthest first from this frame's eye, while the view itself holds the car.
            if (on && boxInSight(view, bounds, SCENERY_REACH_M, false)) {
              if (parked !== null) orderGlass(parked, view.eye);
              if (film !== null) orderGlass(film, view.eye);
            }
            // The patch is no cover: it is drawn only where the view itself holds it.
            if (patch !== null) n += show([patch], warming || boxInSight(view, patchBounds, SCENERY_REACH_M, false));
          }
          const bounds = kiosk?.box ?? boardBounds;
          const on = boxInSight(view, bounds, SCENERY_REACH_M, true);
          if (kioskBoxes !== null) n += show([kioskBoxes], on);
          if (kiosk !== null) n += show(kiosk.meshes, on);
          // The face lies on the board: drawn only where the view itself holds the board.
          if (face !== null) n += show([face], on && boxInSight(view, bounds, SCENERY_REACH_M, false));
          return n;
        },
        dispose() {
          if (gone) return;
          gone = true;
          loads.abort();
          pieces.delete(piece);
          if (carBox !== null) drop(carBox, true);
          if (kioskBoxes !== null) drop(kioskBoxes, true);
          if (patch !== null) drop(patch);
          if (fogged !== null) releaseTexture(fogged);
          if (tails !== null) drop(tails.mesh);
          tails = null;
          if (face !== null) drop(face);
          if (facePicture !== null) releaseTexture(facePicture);
          dropModel(parked);
          dropModel(film);
          dropModel(kiosk);
        },
      });

      if (carAt !== null && !disposed) {
        const parkedAt = carAt;
        void loadSceneryModel(engine, TRAILHEAD_CAR_OUTPUT, loads.signal).then((model) => {
          // The film's car came first, or the trailhead has gone: nothing will show this one.
          if (gone || film !== null) {
            model.release();
            return;
          }
          dressed(model, PLACES.parked, true);
          parked = standModel("trailhead_car", model, parkedAt.x, parkedAt.y, parkedAt.z, parkedAt.yaw, true);
          parkedCar = carHandle(parked, false);
          if (carBox !== null) drop(carBox, true);
          carBox = null;
          again(piece);
        }).catch((error: unknown) => {
          // A missing model costs the look, never the collider: the box stays.
          if (!loads.signal.aborted) console.warn("the trailhead's car could not be made; its box stands", error);
        });
      }
      if (!disposed) {
        // The board, and with it its face: painted once its two pictures have each arrived or failed.
        const pictures = Promise.all([
          board.urls.paper === null ? null : loadBoardImage(board.urls.paper),
          board.urls.portrait === null ? null : loadBoardImage(board.urls.portrait),
        ]);
        void loadSceneryModel(engine, TRAILHEAD_KIOSK_OUTPUT, loads.signal).then(async (model) => {
          if (gone) {
            model.release();
            return;
          }
          dressed(model, PLACES.board, true);
          kiosk = standModel("trailhead_kiosk", model, boardAt.x, boardAt.y, boardAt.z, boardAt.yaw, true);
          if (kioskBoxes !== null) drop(kioskBoxes, true);
          kioskBoxes = null;
          again(piece);
          try {
            const [paper, portrait] = await pictures;
            if (gone) return;
            const { canvas, ctx } = paintCanvas(BOARD_TEXTURE.width, BOARD_TEXTURE.height);
            drawBoard(ctx, board, { paper, portrait });
            const picture = await paintTexture(engine, canvas);
            if (gone) {
              releaseTexture(picture);
              return;
            }
            uploads?.count("textures", BOARD_TEXTURE.width * BOARD_TEXTURE.height * 4);
            facePicture = picture;
            // The slope's share of the bias, which is nothing where the face is looked at square on, and the constant
            // share, which holds there.
            const material = paintMaterial(picture, BOARD_FACE_ROUGHNESS, options.air, options.ahead(-BOARD_FACE_BIAS, 1));
            const corners = boardFaceCorners(sites.board, boardAt.y);
            const geometry = faceGeometry([{ ...corners, rect: { u: 0, v: 0, width: 1, height: 1 } }]);
            face = stand(faceMesh(engine, "trailhead_board_face", geometry, material), geometry.positions.byteLength * 2 + geometry.uvs.byteLength + geometry.indices.byteLength, SEE_THROUGH_ORDER.boardFace);
            again(piece);
          } catch (error) {
            // A face that cannot be painted costs the look, never the board.
            console.warn("the trailhead board's face could not be painted; the board stands bare", error);
          }
        }).catch((error: unknown) => {
          if (!loads.signal.aborted) console.warn("the trailhead's board could not be made; its boxes stand", error);
        });
      }

      return {
        filmCar(signal, alone) {
          if (gone || disposed || filmAsked) return Promise.resolve();
          if (carAt === null) {
            // No parked car to take the place of: only a staged scene's own car stands here.
            if (alone === undefined) return Promise.resolve();
            carAt = { x: 0, y: 0, z: 0, yaw: 0 };
            carBounds = boxAt(carAt);
            patchBounds = patchBox(0, 0, 0, 0);
          }
          const at = carAt;
          filmAsked = true;
          // Ended by the hike's own signal or by the trailhead's going, whichever comes first.
          const ended = new AbortController();
          const end = (): void => ended.abort();
          signal.addEventListener("abort", end, { once: true });
          loads.signal.addEventListener("abort", end, { once: true });
          if (signal.aborted || loads.signal.aborted) end();
          return loadSceneryModel(engine, FILM_CAR_OUTPUT, ended.signal, { under: CAB_PARTS }).then((model) => {
            if (gone || ended.signal.aborted) {
              model.release();
              return;
            }
            // The hike's car is wetted by the weather; a staged scene's own is not: its materials are given no wet look.
            const turns = carTurnsOf(model);
            dressed(model, PLACES.film, alone === undefined, turns);
            // The radio and its handset take a share of the sky's reflected light: the rest of it is roof.
            for (const part of model.parts) {
              if (CAB_PARTS.some((node) => model.under.get(node)?.has(part.name) === true)) part.material.environmentIntensity = CAB_SKY;
            }
            // Nor is it cover for the rain: its scene has none falling.
            film = standModel("trailhead_film_car", model, at.x, at.y, at.z, at.yaw, alone === undefined, turns);
            if (alone !== undefined) {
              film.handset = handsetOf(film);
              if (film.handset !== null) {
                film.cord = cordOf(film, "film_cord");
                film.meshes.push(film.cord.mesh);
                layCord(film);
              }
            }
            filmCar = carHandle(film, true);
            // The parked car and its box give way, and its patch on the ground to one that lies flat under the new car.
            dropModel(parked);
            parked = null;
            parkedCar = null;
            if (carBox !== null) drop(carBox, true);
            carBox = null;
            if (patch !== null) drop(patch);
            const laid = patchGeometry({ ...flatPatch, origin: { x: at.x, y: at.y + flatPatch.origin.y, z: at.z } }, at.yaw);
            if (alone === undefined) {
              patch = patchMesh(laid);
            } else {
              // The film's own patch: lighter than the parked car's, and fogged by the air as the road under it is.
              const made = airPatchMaterial(engine, alone.darkness, options.air, options.ahead(-CAR_SHADOW_BIAS));
              fogged = made.picture;
              const mesh = createMeshFromData(engine, "film_car_shadow", laid.positions, laid.normals, laid.indices, laid.uvs);
              mesh.material = made.material;
              patch = stand(mesh, laid.positions.byteLength * 2 + laid.uvs.byteLength + laid.indices.byteLength, SEE_THROUGH_ORDER.carShadow);
            }
            patchBounds = patchBox(at.x, at.y, at.z, at.yaw);
            if (alone === undefined) {
              // Its tail lamps: dark, in its middle, until the end scene lights them at its rear.
              const lamps = tailLampMaterial(options.shared, options.linear);
              orders.put(lamps.material, PLACES.tailLamps);
              const corners = tailLampCorners(at.x, at.y, at.z, at.yaw, new Float32Array(24), 0);
              const lampMesh = createMeshFromData(engine, "trailhead_film_car_tail_lamps", corners, new Float32Array(24), TAIL_LAMP_INDICES);
              lampMesh.material = lamps.material;
              tails = { mesh: stand(lampMesh, corners.byteLength * 2 + TAIL_LAMP_INDICES.byteLength), corners, lit: false, colour: lamps.colour };
            }
            // Drawn for its first frames wherever it stands, so it is ready when the scene opens.
            warmUntil = frames + FILM_CAR_WARM_FRAMES;
            again(piece);
          }).catch((error: unknown) => {
            if (!ended.signal.aborted) console.warn(`end: the film's car did not load (${error instanceof Error ? error.message : String(error)}); the parked car stays`);
          });
        },
        filmCarIn: () => film !== null,
        car: () => filmCar ?? parkedCar,
        warm: () => film !== null && frames < warmUntil,
        dispose: () => piece.dispose(),
      };
    },

    body(body) {
      const loads = new AbortController();
      let gone = false;
      const turn = quatFromEuler(0, body.yaw, 0, { x: 0, y: 0, z: 0, w: 1 });
      const at = (mesh: Mesh): Mesh => {
        mesh.position.x = body.pos.x;
        mesh.position.y = body.pos.y;
        mesh.position.z = body.pos.z;
        mesh.rotationQuaternion.x = turn.x;
        mesh.rotationQuaternion.y = turn.y;
        mesh.rotationQuaternion.z = turn.z;
        mesh.rotationQuaternion.w = turn.w;
        return mesh;
      };
      // The stand-in, in the body's own frame: the cross's two timbers one mesh, the figure another.
      let standIn: Mesh[] = [];
      if (!disposed) {
        const { wood, figure, upright, crossbar, capsule } = BODY_STAND_IN;
        const plain = (colour: { r: number; g: number; b: number }, n: number): PbrMaterialProps => {
          const made = createPbrMaterial({ baseColorFactor: [colour.r, colour.g, colour.b, 1], metallicFactor: 0, roughnessFactor: 1, usePhysicalLightFalloff: true });
          made.plugins = [options.air()];
          orders.put(made, PLACES.standIn + n);
          return made;
        };
        const timber = merged([upright, crossbar].map((box) => propBoxGeometry({ name: "", material: "", x: 0, y: box.up, z: 0, width: box.width, height: box.height, depth: box.depth })));
        const cross = createMeshFromData(engine, "body_cross", timber.positions, timber.normals, timber.indices);
        cross.material = plain(wood, 0);
        const hung = createCapsuleData({ height: capsule.height, radius: capsule.radius });
        for (let i = 0; i + 2 < hung.positions.length; i += 3) {
          hung.positions[i + 1] = (hung.positions[i + 1] as number) + capsule.up;
          hung.positions[i + 2] = (hung.positions[i + 2] as number) + capsule.forward;
        }
        const hangs = createMeshFromData(engine, "body_figure", hung.positions, hung.normals, hung.indices);
        hangs.material = plain(figure, 1);
        standIn = [
          stand(at(cross), timber.positions.byteLength * 2 + timber.indices.byteLength),
          stand(at(hangs), hung.positions.byteLength * 2 + hung.indices.byteLength),
        ];
      }
      let stood: Stood | null = null;
      // The stand-in's box: the cross's timbers and the figure hung in front of it.
      const standInBounds = sightBox(
        body.pos.x, body.pos.y, body.pos.z, body.yaw,
        { x: -BODY_STAND_IN.crossbar.width / 2, y: 0, z: -BODY_STAND_IN.upright.depth / 2 },
        { x: BODY_STAND_IN.crossbar.width / 2, y: BODY_STAND_IN.upright.height, z: BODY_STAND_IN.capsule.forward + BODY_STAND_IN.capsule.radius },
      );
      const piece = join<Piece>({
        seen(view) {
          const on = boxInSight(view, stood?.box ?? standInBounds, SCENERY_REACH_M, false);
          return show(standIn, on) + (stood === null ? 0 : show(stood.meshes, on));
        },
        dispose() {
          if (gone) return;
          gone = true;
          loads.abort();
          pieces.delete(piece);
          for (const mesh of standIn) drop(mesh);
          if (stood !== null) {
            for (const mesh of stood.meshes) drop(mesh);
            stood.model.release();
          }
        },
      });
      if (!disposed) {
        void loadSceneryModel(engine, BODY_OUTPUT, loads.signal).then((model) => {
          if (gone) {
            model.release();
            return;
          }
          // The body takes the air and not the weather, as the game's does.
          dressed(model, PLACES.body, false);
          stood = standModel("body", model, body.pos.x, body.pos.y, body.pos.z, body.yaw, false);
          for (const mesh of standIn) drop(mesh);
          standIn = [];
          again(piece);
        }).catch((error: unknown) => {
          // A missing model costs the look: the stand-in stays.
          if (!loads.signal.aborted) console.warn("the body's model could not be made; its stand-in stays", error);
        });
      }
      return piece;
    },

    actor(url) {
      const loads = new AbortController();
      let gone = false;
      let made: SceneActor | null = null;
      /** The pose asked for before the model landed: the one it lands in. */
      let pending: ActorPose | null = null;
      /** Clips asked for that the model lacks, each said once. */
      const lacked = new Set<string>();
      const stage = (actor: SceneActor, pose: ActorPose): void => {
        if (actor.stage(pose) || lacked.has(pose.clip)) return;
        lacked.add(pose.clip);
        console.warn(`scene: no clip "${pose.clip}" on the actor; holding the pose`);
      };
      const piece = join<Piece>({
        seen(view) {
          if (made === null) return 0;
          const { at } = made;
          return made.inView(inSight(view, at.x, at.y + ACTOR_SPHERE_UP_M, at.z, ACTOR_SPHERE_M, SCENERY_REACH_M, false));
        },
        dispose() {
          if (gone) return;
          gone = true;
          loads.abort();
          pieces.delete(piece);
          made?.dispose();
          made = null;
        },
      });
      const settled = disposed
        ? Promise.resolve()
        : loadSceneActor(engine, scene, url, {
          signal: loads.signal,
          ...(uploads === undefined ? {} : { uploads }),
          // The game's stack on a body: the base colour's block, the wet look at no porosity and the air.
          dress(material, mesh, index) {
            material.usePhysicalLightFalloff = true;
            material.plugins = [baseColourPlugin(), surfaceWetPlugin(bodyWet, options.shared), options.air()];
            orders.put(material, PLACES.actor + index);
            mesh.renderOrder = orders.of(material) ?? DRAW_ORDER.scenery;
          },
        }).then(async (actor) => {
          if (gone) {
            actor.dispose();
            return;
          }
          // Lite builds a skinned mesh that joins a scene built with none against a layout made before its skin's
          // bindings were known: its first frames are refused by the GPU, every draw of them with it. So the scene's
          // renderables are built again once it has joined, as they are for a lamp that joins (`wornLamps.ts`); its
          // owner draws no frame until `settled`.
          await rebuildSceneRenderables(scene);
          if (gone) {
            actor.dispose();
            return;
          }
          made = actor;
          if (pending !== null) stage(actor, pending);
          again(piece);
        }).catch((error: unknown) => {
          if (!loads.signal.aborted) console.warn(`scene: the actor did not load (${error instanceof Error ? error.message : String(error)}); not drawn`);
        });
      return {
        settled,
        stage(pose) {
          pending = pose;
          if (made !== null) stage(made, pose);
        },
        joint: (name, out) => made?.joint(name, out) ?? null,
        dispose: () => piece.dispose(),
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const piece of [...pieces]) piece.dispose();
      pieces.clear();
      boxMaterials.clear();
    },
  };
}
