/**
 * The scenery a hike places once, on Babylon Lite: the fingerposts at the
 * trail's junctions, the trailhead's car and board, and the body at the
 * crest, from what the game places them with (`signParts.ts`,
 * `sceneryParts.ts`, `boardDraw.ts`, `carShadow.ts`). The hike asks for
 * each through `hikeScenery.ts`, as it asks the renderer on Babylon.js, and
 * holds what it is handed back.
 *
 * - **Every post of a world is one draw, and every plank another.** A
 *   post and a plank are instances of their models' one mesh each, where
 *   the game makes a copy of the model a post and a plank; the planks'
 *   lettering, two faces a plank, is one mesh of every face under one
 *   picture (`sceneryPaint.ts`). Three draws while a post is in sight,
 *   whatever the junctions.
 * - **A model placed once is a mesh a material** (`sceneryModels.ts`): the
 *   board two, the car seven with its glass, the body two.
 * - **What is out of sight is not drawn.** Each post, the car, the board
 *   and the body is a sphere tested against the view's planes and against
 *   a reach past which it is under a pixel of the frame (`SIGN_REACH_M`,
 *   `SCENERY_REACH_M`); the posts' two lists hold the posts in sight and are
 *   written again only when that set changes. A frame with nothing of the
 *   scenery in sight has no draw and no write for it.
 * - **The posts, the car and the board are hard cover for the rain**
 *   (`rainMap.ts`). Lite leaves a hidden mesh out of every pass, so what
 *   stands in the map's square is shown for the frame that draws the map.
 * - **Until a model arrives, and for good if it never does, the box the sim
 *   collides with is drawn in its place**, as the chunk props' boxes are
 *   (`propBoxes.ts`); the body's stand-in is its cross of dark timber and
 *   pale figure. The parked car gives way to the film's car when that
 *   arrives (`filmCar`), as on Babylon.js, and is then let go: nothing
 *   shows it again.
 * - **The see-through parts stand at the world's origin** with their
 *   vertices in the world's own coordinates, at their places among the
 *   see-through draws (`SEE_THROUGH_ORDER`): the patch under the car, the
 *   planks' lettering, the board's face and the car's glass.
 * - **A car's glass is one draw, its panes listed farthest first.**
 *   Babylon.js draws a mesh a pane and orders them by how far each is, so a
 *   pane seen through another is laid under it. Here the one mesh's
 *   triangles are listed pane by pane in that order, and written again on
 *   the frame the order changes: when the eye crosses between two panes.
 *
 * The board's face is painted once, when its model and its two pictures
 * have each arrived or failed: the game paints it at once with stand-ins and
 * again with the pictures, over a board no frame has yet shown.
 */
import {
  addToScene, createCapsuleData, createMeshFromData, createPbrMaterial, disposeMeshGpu, flushThinInstances, releaseTexture, removeFromScene, setMeshVisible,
  setThinInstanceCount, setThinInstances, updateMeshGeometryCapacity,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type PluginUniformBlock, type SceneContext, type ShaderMaterial, type Texture2D,
} from "@babylonjs/lite";
import type { SignPost } from "../../sim/signs.js";
import { SIGN_POST_HALF } from "../../sim/signs.js";
import { BOARD_BOX_HALF, CAR_HALF, CAR_MATERIAL, KIOSK_MATERIAL, boardBoxes } from "../../sim/trailhead.js";
import { BOARD_TEXTURE } from "../boardFace.js";
import { BOARD_FACE_BIAS, BOARD_FACE_ROUGHNESS, drawBoard, loadBoardImage, type BoardDrawing } from "../boardDraw.js";
import { carShadowGrid } from "../carShadow.js";
import { quatFromEuler } from "../instancePose.js";
import { PROP_ROUGHNESS, propBoxGeometry, propColour, type PropBox } from "../propBoxes.js";
import type { Renderer } from "../renderer.js";
import {
  BODY_OUTPUT, BODY_STAND_IN, CAB_PARTS, CAB_SKY, FILM_CAR_OUTPUT, TRAILHEAD_CAR_OUTPUT, TRAILHEAD_KIOSK_OUTPUT, boardFaceCorners, boardYaw, carYaw,
  type TrailheadSites,
} from "../sceneryParts.js";
import {
  ARM_LENGTH, LABEL_ROUGHNESS, SIGN_ARM_OUTPUT, SIGN_POST_OUTPUT, signPlaces, squareEnd, type SignPlaces,
} from "../signParts.js";
import type { WetUniforms } from "../wetSurface.js";
import { sphereInView } from "./capMesh.js";
import type { ViewFrustumPlane } from "./cameraPose.js";
import { DRAW_ORDER, SEE_THROUGH_ORDER, createDrawOrders } from "./drawOrder.js";
import { baseColourPlugin, surfaceWetPlugin } from "./forestPlugins.js";
import type { FrameUploads } from "./frameUploads.js";
import type { CoverRegistry } from "./rainMap.js";
import {
  dress, farthestFirst, listPanes, loadSceneryModel, partBytes, partMesh, placeMatrix, placed, type SceneryModel, type SceneryPart,
} from "./sceneryModels.js";
import {
  faceGeometry, faceMesh, labelAtlas, labelGeometry, paintCanvas, paintLabelAtlas, paintMaterial, paintTexture, patchGeometry, patchMaterial,
} from "./sceneryPaint.js";

/**
 * How far (m) a fingerpost is drawn from. A post is 0.11 m across and its
 * planks 0.2 m tall: past this they are a tenth and a fifth of a pixel of a
 * frame 956 rows tall, and no more than half a pixel of one 2,160 rows tall.
 */
export const SIGN_REACH_M = 600;
/** How far (m) the car, the board and the body are drawn from: the car, the longest of them, is under two pixels of a frame 956 rows tall past it. */
export const SCENERY_REACH_M = 1500;

/** The spheres (m) the scenery is tested against the view by: a post with its planks about its middle, the car, the board and the body about theirs. */
const POST_SPHERE_M = 0.5 + ARM_LENGTH;
const CAR_SPHERE_M = 3.4;
const BOARD_SPHERE_M = 2.4;
const BODY_SPHERE_M = 2.6;

/** The scenery's places among the opaque draws, from `DRAW_ORDER.scenery`: a run a kind, a place a material in its file's order. */
const PLACES = { boxes: 0, posts: 8, planks: 16, board: 24, parked: 32, film: 48, body: 64, standIn: 72 } as const;

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
  /** The rain's cover map: the posts, the car and the board are hard cover. */
  cover?: CoverRegistry;
};

/** The view a frame is drawn from, as the scenery is judged by it. */
export type SceneryView = {
  planes: readonly ViewFrustumPlane[];
  eye: { readonly x: number; readonly y: number; readonly z: number };
  /** The square the rain's cover map is drawn over this frame, or null on a frame that does not draw it. */
  cover: { readonly x: number; readonly z: number; readonly half: number } | null;
};

/** The trailhead as the hike holds it on Lite. */
export type LiteTrailhead = {
  /** Fetches the film's car and stands it in the parked car's place; quietly nothing once `signal` aborts. */
  filmCar(signal: AbortSignal): void;
  /** Whether the film's car stands in the parked car's place. */
  filmCarIn(): boolean;
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
    signs: (posts, groundH) => later((host) => host.signs(posts, groundH)),
    body: (body) => later((host) => host.body(body)),
    trailhead(sites, groundH, board) {
      /** The film's car asked for before the trailhead stood. */
      let asked: AbortSignal | null = null;
      const piece = later((host) => {
        const made = host.trailhead(sites, groundH, board);
        if (asked !== null) made.filmCar(asked);
        return made;
      });
      return {
        filmCar(signal) {
          const made = piece.made();
          if (made !== null) made.filmCar(signal);
          else asked = signal;
        },
        filmCarIn: () => piece.made()?.filmCarIn() ?? false,
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

/** A see-through part of several panes as it stands in the world: its mesh, its geometry there, and the order its panes are listed in. */
type Glass = {
  mesh: Mesh;
  part: SceneryPart;
  positions: Float32Array;
  normals: Float32Array;
  tangents: Float32Array | null;
  /** The triangles as the file lists them, and as the mesh now draws them. */
  indices: Uint32Array;
  drawn: Uint32Array;
  /** The middle of each pane's box in the world, xyz a pane. */
  centres: Float32Array;
  order: number[];
};

/** A model as it stands: its meshes, and of them the glass whose panes are ordered by the eye. */
type Stood = { model: SceneryModel; meshes: Mesh[]; glass: Glass[] };

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

  /** A model's parts dressed and given their places from `first`; the weather soaks it where `wet`. */
  function dressed(model: SceneryModel, first: number, wet: boolean): void {
    for (const [n, part] of model.parts.entries()) {
      dress(part, { wet: wet ? options.wet : null, air: options.air, shared: options.shared });
      orders.put(part.material, first + n);
    }
  }

  /**
   * A model's meshes stood at (x, y, z) turned by `yaw`: an opaque part by
   * its mesh's own place, a see-through one with its vertices carried there,
   * at the glass's place among the see-through draws.
   */
  function standModel(name: string, model: SceneryModel, x: number, y: number, z: number, yaw: number, cover: boolean): Stood {
    const turn = quatFromEuler(0, yaw, 0, { x: 0, y: 0, z: 0, w: 1 });
    const glass: Glass[] = [];
    const meshes = model.parts.map((part: SceneryPart, n) => {
      const at = placeMatrix(x, y, z, yaw);
      const mesh = part.blended ? partMesh(engine, `${name}_${n}`, part, at) : partMesh(engine, `${name}_${n}`, part);
      if (part.blended && part.panes.length > 1) {
        // Its panes are ordered by the eye: the geometry is kept as it stands in the world, to list them again by.
        const world = placed(part, at);
        const centres = new Float32Array(part.panes.length * 3);
        for (const [i, pane] of part.panes.entries()) {
          for (let row = 0; row < 3; row++) centres[i * 3 + row] = (at[row] as number) * pane.x + (at[4 + row] as number) * pane.y + (at[8 + row] as number) * pane.z + (at[12 + row] as number);
        }
        glass.push({
          mesh, part, positions: world.positions, normals: world.normals, tangents: world.tangents, indices: world.indices, drawn: world.indices.slice(), centres,
          order: part.panes.map((_, i) => i),
        });
      }
      if (!part.blended) {
        mesh.position.x = x;
        mesh.position.y = y;
        mesh.position.z = z;
        mesh.rotationQuaternion.x = turn.x;
        mesh.rotationQuaternion.y = turn.y;
        mesh.rotationQuaternion.z = turn.z;
        mesh.rotationQuaternion.w = turn.w;
      }
      stand(mesh, partBytes(part), part.blended ? SEE_THROUGH_ORDER.glass : undefined);
      if (cover) options.cover?.add(mesh);
      return mesh;
    });
    return { model, meshes, glass };
  }

  /** Lists each glass's panes farthest first from `eye`, where that is not the order its mesh draws them in. */
  const nextOrder: number[] = [];
  function orderGlass(stood: Stood, eye: SceneryView["eye"]): void {
    for (const glass of stood.glass) {
      farthestFirst(glass.centres, eye, nextOrder);
      if (nextOrder.every((pane, i) => pane === glass.order[i])) continue;
      for (const [i, pane] of nextOrder.entries()) glass.order[i] = pane;
      listPanes(glass.indices, glass.part.panes, glass.order, glass.drawn);
      updateMeshGeometryCapacity(
        engine, glass.mesh, glass.positions, glass.normals, glass.drawn, glass.part.uvs, undefined, glass.tangents ?? undefined, undefined, 1,
        { vertices: [], indices: [{ offset: 0, count: glass.drawn.length }] },
      );
      uploads?.count("geometry", glass.drawn.byteLength);
    }
  }

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
    update(view) {
      if (disposed) return;
      last = view;
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
      const carAt = car === null ? null : { x: car.site.x, y: groundH(car.site.x, car.site.z), z: car.site.z, yaw: carYaw(car.site, car.trailhead) };
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
      let parked: Stood | null = null;
      let film: Stood | null = null;
      let kiosk: Stood | null = null;
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
          if (carAt !== null) {
            const on = inSight(view, carAt.x, carAt.y + CAR_HALF.y, carAt.z, CAR_SPHERE_M, SCENERY_REACH_M, true);
            // The patch is no cover: it is drawn only where the view itself holds the car.
            const inView = on && inSight(view, carAt.x, carAt.y + CAR_HALF.y, carAt.z, CAR_SPHERE_M, SCENERY_REACH_M, false);
            if (carBox !== null) n += show([carBox], on);
            if (parked !== null) n += show(parked.meshes, on);
            if (film !== null) n += show(film.meshes, on);
            // The glass's panes farthest first from this frame's eye, while the view itself holds the car.
            if (inView) {
              if (parked !== null) orderGlass(parked, view.eye);
              if (film !== null) orderGlass(film, view.eye);
            }
            if (patch !== null) n += show([patch], inView);
          }
          const on = inSight(view, boardAt.x, boardAt.y + BOARD_BOX_HALF.y, boardAt.z, BOARD_SPHERE_M, SCENERY_REACH_M, true);
          if (kioskBoxes !== null) n += show([kioskBoxes], on);
          if (kiosk !== null) n += show(kiosk.meshes, on);
          if (face !== null) n += show([face], on && inSight(view, boardAt.x, boardAt.y + BOARD_BOX_HALF.y, boardAt.z, BOARD_SPHERE_M, SCENERY_REACH_M, false));
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
          if (face !== null) drop(face);
          if (facePicture !== null) releaseTexture(facePicture);
          dropModel(parked);
          dropModel(film);
          dropModel(kiosk);
        },
      });

      if (carAt !== null && !disposed) {
        void loadSceneryModel(engine, TRAILHEAD_CAR_OUTPUT, loads.signal).then((model) => {
          // The film's car came first, or the trailhead has gone: nothing will show this one.
          if (gone || film !== null) {
            model.release();
            return;
          }
          dressed(model, PLACES.parked, true);
          parked = standModel("trailhead_car", model, carAt.x, carAt.y, carAt.z, carAt.yaw, true);
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
        filmCar(signal) {
          if (gone || disposed || carAt === null || car === null || filmAsked) return;
          filmAsked = true;
          // Ended by the hike's own signal or by the trailhead's going, whichever comes first.
          const ended = new AbortController();
          const end = (): void => ended.abort();
          signal.addEventListener("abort", end, { once: true });
          loads.signal.addEventListener("abort", end, { once: true });
          if (signal.aborted || loads.signal.aborted) end();
          void loadSceneryModel(engine, FILM_CAR_OUTPUT, ended.signal, { under: CAB_PARTS }).then((model) => {
            if (gone || ended.signal.aborted) {
              model.release();
              return;
            }
            dressed(model, PLACES.film, true);
            // The radio and its handset take a share of the sky's reflected light: the rest of it is roof.
            for (const part of model.parts) {
              if (CAB_PARTS.some((node) => model.under.get(node)?.has(part.name) === true)) part.material.environmentIntensity = CAB_SKY;
            }
            film = standModel("trailhead_film_car", model, carAt.x, carAt.y, carAt.z, carAt.yaw, true);
            // The parked car and its box give way, and its patch on the ground to one that lies flat under the new car.
            dropModel(parked);
            parked = null;
            if (carBox !== null) drop(carBox, true);
            carBox = null;
            if (patch !== null) drop(patch);
            const flat = carShadowGrid({ x: 0, z: 0 }, () => 0);
            patch = patchMesh(patchGeometry({ ...flat, origin: { x: carAt.x, y: carAt.y + flat.origin.y, z: carAt.z } }, carAt.yaw));
            again(piece);
          }).catch((error: unknown) => {
            if (!ended.signal.aborted) console.warn(`end: the film's car did not load (${error instanceof Error ? error.message : String(error)}); the parked car stays`);
          });
        },
        filmCarIn: () => film !== null,
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
      const piece = join<Piece>({
        seen(view) {
          const on = inSight(view, body.pos.x, body.pos.y + BODY_STAND_IN.upright.up, body.pos.z, BODY_SPHERE_M, SCENERY_REACH_M, false);
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

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const piece of [...pieces]) piece.dispose();
      pieces.clear();
      boxMaterials.clear();
    },
  };
}
