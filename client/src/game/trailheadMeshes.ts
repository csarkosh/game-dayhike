import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
// Non-.pure path, load-bearing (Babylon 9 split — see lighting.ts).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Observer } from "@babylonjs/core/Misc/observable.js";
import type { Scene } from "@babylonjs/core/scene.js";

import { BOARD_BOX_HALF, CAR_HALF, CAR_MATERIAL, KIOSK_MATERIAL, boardBoxes, carDirection, type Board } from "../sim/trailhead.js";
import type { Vec3 } from "../sim/types.js";
import { BOARD_FACE } from "./boardFace.js";
import { paintedBoard, type BoardDrawing, type BoardPainter } from "./boardPaint.js";
import { CAR_SHADOW_BIAS, CAR_SHADOW_TEX, carShadowAlphaMap, carShadowGrid } from "./carShadow.js";
import type { MeshRegistry, PropShadows } from "./propMeshes.js";
import { carModelOf, dimCabParts, type CarModel } from "./scene/sceneStage.js";
import { TAIL_LAMP_APART, TAIL_LAMP_BACK, TAIL_LAMP_COLOUR, TAIL_LAMP_H, TAIL_LAMP_UP, TAIL_LAMP_W } from "./endScene.js";
import { armYaw } from "./signMeshes.js";
import { defaultModelLoader, loaderUntilAborted, placeStaticModel, type ModelLoader, type PlacedModel } from "./staticModel.js";
import { attachWet, WET_CAP } from "./wetPlugin.js";

export const TRAILHEAD_CAR_OUTPUT = "models/trailhead.car.glb";
export const TRAILHEAD_KIOSK_OUTPUT = "models/trailhead.kiosk.glb";
/** The film's car (the intro's, with wheels and a door), which the end scene swaps in for the parked one (`swapCar`). */
export const FILM_CAR_NAME = "intro.car";
export const FILM_CAR_OUTPUT = "models/intro.car.glb";
/**
 * How far in front of the model's own face the painted plane stands. With
 * the view's near plane at 5 cm, a vertex lands in depth to within about
 * 0.7 mm for every metre between it and the eye, so a plane 1 mm in front
 * of another loses to it, in wedges across the face, from some places a
 * player stands. Measured from standpoints 1 to 18 m in front of the board:
 * at 1 mm and no bias the paint was lost from 16 of 75 under WebGPU and 1
 * of 78 under WebGL2; at 2 mm with the material's bias (`boardPaint.ts`),
 * from none under either. 2 mm holds the first metres and the bias the
 * rest.
 */
export const BOARD_FACE_LIFT = 0.002;

type Site = { x: number; z: number };

export type TrailheadSites = {
  /** The car's footprint centre, and the trailhead it is parked beside;
   * absent, no car is placed: a staged scene brings its own and moves it. */
  car?: { site: Site; trailhead: Site };
  /** The board: its centre, the way its face looks, and its own line. */
  board: Board;
};

export type TrailheadDeps = {
  /** The box material by prop name — `terrainMaterialFor`, as the prop boxes use. */
  materialFor(name: string): Material;
  /** What the board's face carries. */
  board: BoardDrawing;
  paint?: BoardPainter;
  shadows?: PropShadows;
  /** The rain's cover map: the car and the kiosk are hard cover, box or model. */
  cover?: MeshRegistry;
  loader?: ModelLoader;
};

/**
 * The car the end scene drives: the node it moves by, its parts where it
 * has them, `leave()`, which takes it out of the rain's cover as it drives
 * off (the cover map is drawn once for a place, and a car that has gone
 * would keep the rain off the pad it left; once is enough, again is
 * nothing), and `tailLamps(on)`, which lights and shows the film's car's
 * tail lamps at its rear, or hides them (the parked car has none).
 */
export type TrailheadCar = { root: TransformNode; model: CarModel | null; leave(): void; tailLamps(on: boolean): void };

/**
 * The film's car is drawn wherever it stands once swapped in, each mesh
 * until its material has been ready for it on two passes running, and none past
 * this many frames: the effects prepared, the shader modules made and the
 * pipelines requested at the swap, while the car stands unseen a kilometre
 * off in the dark of the chase, so the scene's first frames draw the car
 * whole instead of leaving it out or holding the page.
 */
export const PIPELINE_WARM_FRAMES_MAX = 30;

/** The film's car's tail lamps: two quads at its rear corners, children of its root, unlit and not fogged; drawn only while lit, after their first frames. */
type TailLamps = { meshes: Mesh[]; material: StandardMaterial; on: boolean };

/** Whether a mesh's material is ready for every part of it. */
function readyToDraw(mesh: Mesh): boolean {
  const material = mesh.material;
  if (material === null) return true;
  for (const sub of mesh.subMeshes ?? []) if (!material.isReadyForSubMesh(mesh, sub)) return false;
  return true;
}

function createTailLamps(scene: Scene, root: TransformNode): TailLamps {
  const material = new StandardMaterial("mat_car_tail_lamp", scene);
  material.disableLighting = true;
  material.emissiveColor = new Color3(0, 0, 0);
  // Two red points down the highway into the mist: the fog would take them first.
  material.fogEnabled = false;
  const meshes = [-1, 1].map((side) => {
    // A plane faces -z as it is made: out of the car's tail.
    const mesh = MeshBuilder.CreatePlane(`car_tail_lamp_${side < 0 ? "l" : "r"}`, { width: TAIL_LAMP_W, height: TAIL_LAMP_H }, scene);
    mesh.parent = root;
    // Inside the body while their first frames are drawn; at the rear once lit (`tailLamps`).
    mesh.position.set(side * TAIL_LAMP_APART / 2, TAIL_LAMP_UP, 0);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    return mesh;
  });
  return { meshes, material, on: false };
}

export type TrailheadMeshes = {
  /** Resolves once both models have settled, loaded or failed. */
  readonly ready: Promise<void>;
  /**
   * The car as it stands: the film's car once `swapCar` has placed it, with
   * its parts; else the parked model, whole (`model` null); null while only
   * the box stands, or with no car at all. The same object each call.
   */
  car(): TrailheadCar | null;
  /** Whether the film's car is still in its first frames, drawn wherever it stands (`PIPELINE_WARM_FRAMES_MAX`). */
  warm(): boolean;
  /**
   * The film's car (`intro.car`, which has wheels and a door) in the parked
   * car's place: on the same site, ground and yaw, soaked, shadowed and
   * cover as the parked model is, the parked model and its box hidden and
   * its fixed patch replaced by one that rides the new car's root. Once;
   * a second car, or one after `dispose`, is disposed at once.
   */
  swapCar(placed: PlacedModel): void;
  dispose(): void;
};

/**
 * The car's yaw: 0 or PI only, so the model stays square to the box the sim
 * collides with. It stands at the pad's own place along the road on most
 * worlds, and there its nose points toward +z (yaw 0); where it has slid
 * along the road to clear the trail, its nose points back toward the pad.
 * The rule is the sim's (`carDirection`), so the door spot agrees with it.
 */
export function carYaw(site: Site, trailhead: Site): number {
  return carDirection(site, trailhead) === 1 ? 0 : Math.PI;
}

/**
 * The trailhead's two models, placed once from the seed's places: the
 * ranger's SUV on the shoulder and the roofed board at the trail's
 * entrance, turned to face where a player arrives. Each stands on the
 * boxes the sim collides with and, until its model arrives (or for good, if
 * it never does), those boxes are drawn instead, exactly as the prop boxes
 * elsewhere are — so the trailhead never holds an invisible wall. The
 * board's face is a plane of the game's own, painted when the match starts
 * (`boardPaint.ts`) and placed by the face's size and place, which are the
 * model's to keep. Under the car, box or model, lies its soft dark patch
 * (`carShadow.ts`).
 */
/** The soft patch and its parts: what the caller disposes. */
export type CarShadowPatch = { mesh: Mesh; material: StandardMaterial | PBRMaterial; texture: RawTexture; dispose(): void };

/**
 * The patch under the car: black, unlit, laid over the ground by its
 * texture's alpha. It writes no depth, so it is in the way of nothing
 * drawn after it. Built as the mist's material is (`mistMeshes.ts`), so
 * the two are drawn by one shader; that material reads Babylon's own fog,
 * which is lighter than the atmosphere's in a mist, so far off the patch
 * stays dark on a fogged road. With `atmosphere` it is a PBR material
 * instead, which the atmosphere's fog reaches as it reaches the ground.
 * `darkness` scales its alpha.
 */
export function createCarShadowPatch(
  scene: Scene,
  site: { x: number; z: number },
  groundH: (x: number, z: number) => number,
  { moving = false, atmosphere = false, darkness = 1 }: { moving?: boolean; atmosphere?: boolean; darkness?: number } = {},
): CarShadowPatch {
  const texture = RawTexture.CreateRGBATexture(
    carShadowAlphaMap(), CAR_SHADOW_TEX.width, CAR_SHADOW_TEX.height, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE,
    Engine.TEXTURETYPE_UNSIGNED_BYTE,
  );
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  let material: StandardMaterial | PBRMaterial;
  if (atmosphere) {
    const pbr = new PBRMaterial("mat_car_shadow_fogged", scene);
    pbr.unlit = true;
    pbr.albedoColor = new Color3(0, 0, 0);
    pbr.opacityTexture = texture;
    pbr.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    material = pbr;
  } else {
    const plain = new StandardMaterial("mat_trailhead_car_shadow", scene);
    plain.disableLighting = true;
    plain.opacityTexture = texture;
    material = plain;
  }
  material.alpha = darkness;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  material.zOffsetUnits = CAR_SHADOW_BIAS;
  const grid = carShadowGrid(site, groundH);
  const mesh = new Mesh("trailhead_car_shadow", scene);
  const data = new VertexData();
  data.positions = grid.positions;
  data.normals = grid.normals;
  data.uvs = grid.uvs;
  data.indices = grid.indices;
  data.applyToMesh(mesh);
  mesh.position.set(grid.origin.x, grid.origin.y, grid.origin.z);
  mesh.scaling.set(grid.scale.x, grid.scale.y, grid.scale.z);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  // A parked car's patch never moves; a moving car's rides it, a child of its root.
  if (!moving) mesh.freezeWorldMatrix();
  return {
    mesh,
    material,
    texture,
    dispose() {
      mesh.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

export function createTrailheadMeshes(
  scene: Scene,
  sites: TrailheadSites,
  groundH: (x: number, z: number) => number,
  deps: TrailheadDeps,
): TrailheadMeshes {
  // Aborted first thing in `dispose`: a model in flight then ends at once and
  // quietly (`modelLoad.ts`).
  const loads = new AbortController();
  const load = loaderUntilAborted(deps.loader ?? defaultModelLoader(scene), loads.signal);
  const paint = deps.paint ?? paintedBoard;
  let disposed = false;
  const placed: PlacedModel[] = [];
  const painted: Material[] = [];

  function fallbackBox(name: string, material: string, site: Site, half: Vec3): Mesh {
    const ground = groundH(site.x, site.z);
    const mesh = MeshBuilder.CreateBox(name, { width: 2 * half.x, height: 2 * half.y, depth: 2 * half.z }, scene);
    mesh.position.set(site.x, ground + half.y, site.z);
    mesh.material = deps.materialFor(material);
    attachWet(mesh.material, WET_CAP.prop);
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    deps.shadows?.add(mesh);
    deps.cover?.add(mesh);
    return mesh;
  }
  function dropBox(box: Mesh): void {
    if (box.isDisposed()) return;
    deps.shadows?.remove(box);
    deps.cover?.remove(box);
    box.dispose();
  }


  const car = sites.car ?? null;
  const carBox = car === null ? null : fallbackBox("trailhead_car_box", CAR_MATERIAL, car.site, CAR_HALF);
  let patch: CarShadowPatch | null = car === null ? null : createCarShadowPatch(scene, car.site, groundH);
  /** The parked model once it has arrived, and the film's car once swapped in; each with the handle `car()` gives. */
  let parked: { placed: PlacedModel; handle: TrailheadCar } | null = null;
  let film: { placed: PlacedModel; handle: TrailheadCar; patch: CarShadowPatch; tails: TailLamps } | null = null;
  /** The film's car's first frames: the meshes still drawn wherever they stand, and the frames so far; null once none is left. */
  let warming: { left: Set<Mesh>; ready: Set<Mesh>; frames: number; observer: Observer<Scene> } | null = null;
  /** A mesh's first frames over: culled as ever again, and a tail lamp not lit hidden. */
  function warmedOne(mesh: Mesh): void {
    mesh.alwaysSelectAsActiveMesh = false;
    if (film !== null && film.tails.meshes.includes(mesh) && !film.tails.on) mesh.setEnabled(false);
  }
  function warmed(): void {
    if (warming === null) return;
    for (const m of warming.left) warmedOne(m);
    scene.onAfterRenderObservable.remove(warming.observer);
    warming = null;
  }
  /** After each frame: each mesh still warming that is now ready leaves; at the cap, all do. */
  function warmStep(): void {
    if (warming === null) return;
    warming.frames += 1;
    if (warming.frames >= PIPELINE_WARM_FRAMES_MAX) {
      warmed();
      return;
    }
    // Ready on one pass, then drawn ready once more before it leaves.
    for (const m of warming.left) {
      if (!readyToDraw(m)) {
        warming.ready.delete(m);
        continue;
      }
      if (!warming.ready.has(m)) {
        warming.ready.add(m);
        continue;
      }
      warming.left.delete(m);
      warmedOne(m);
    }
    if (warming.left.size === 0) warmed();
  }
  /** The handle for a placed car: its root, its parts, its leaving the cover, and its tail lamps if it has them. */
  function handleFor(placed: PlacedModel, model: CarModel | null, tails: TailLamps | null): TrailheadCar {
    return {
      root: placed.node,
      model,
      leave() {
        for (const m of placed.meshes) deps.cover?.remove(m);
      },
      tailLamps(on) {
        if (tails === null) return;
        tails.on = on;
        if (on) tails.material.emissiveColor.set(...TAIL_LAMP_COLOUR);
        else tails.material.emissiveColor.set(0, 0, 0);
        for (const m of tails.meshes) {
          if (on) m.position.z = -TAIL_LAMP_BACK;
          m.setEnabled(on);
        }
      },
    };
  }
  const kioskBoxes = boardBoxes(sites.board).map((b, k) => fallbackBox(`trailhead_kiosk_box_${k}`, KIOSK_MATERIAL, b, BOARD_BOX_HALF));

  async function place(
    output: string, name: string, site: Site, yaw: number, boxes: readonly Mesh[],
    after?: (model: PlacedModel) => void,
  ): Promise<void> {
    let container: AssetContainer;
    try {
      container = await load(output);
    } catch {
      // A missing model costs the look, never the collider: the box stays.
      return;
    }
    // Disposed while the file was in flight: nothing will ever draw it.
    if (disposed) {
      container.dispose();
      return;
    }
    let model: PlacedModel;
    try {
      model = placeStaticModel(container, name, site.x, groundH(site.x, site.z), site.z, yaw);
    } catch {
      container.dispose();
      return;
    }
    for (const m of model.meshes) {
      deps.shadows?.add(m);
      deps.cover?.add(m);
      // The weather soaks the car and the kiosk as it does every prop.
      if (m.material) attachWet(m.material, WET_CAP.prop);
    }
    placed.push(model);
    for (const box of boxes) dropBox(box);
    try {
      after?.(model);
    } catch {
      // A face that cannot be painted costs the look, never the board.
    }
  }

  let face: Mesh | null = null;
  /**
   * The face's own plane: 2 m by 1 m, 2 mm in front of the model's
   * planks, in the board's own space so it turns with the board. A plane
   * looks toward -Z as it is made; half a turn points it out of the face,
   * and leaves the texture's left at the player's left.
   */
  function faceOn(model: PlacedModel): void {
    const material = paint(scene, "trailhead_board_face", deps.board);
    painted.push(material);
    const plane = MeshBuilder.CreatePlane("trailhead_board_face", { width: BOARD_FACE.width, height: BOARD_FACE.height }, scene);
    plane.parent = model.node;
    plane.position.set(0, BOARD_FACE.centreY, BOARD_FACE.front + BOARD_FACE_LIFT);
    plane.rotation.y = Math.PI;
    plane.material = material;
    plane.isPickable = false;
    // It takes the shadows the board does, but casts none of its own.
    plane.receiveShadows = true;
    face = plane;
  }

  const ready = Promise.all([
    car === null || carBox === null ? Promise.resolve() : place(TRAILHEAD_CAR_OUTPUT, "trailhead_car", car.site, carYaw(car.site, car.trailhead), [carBox], (model) => {
      parked = { placed: model, handle: handleFor(model, null, null) };
      // The film's car came first: the parked one arrives hidden under it.
      if (film !== null) model.node.setEnabled(false);
    }),
    place(
      TRAILHEAD_KIOSK_OUTPUT, "trailhead_kiosk", sites.board,
      // The model's face looks toward +Z; turn +Z onto the board's facing.
      armYaw({ dx: sites.board.fx, dz: sites.board.fz }), kioskBoxes, faceOn,
    ),
  ]).then(() => undefined);

  return {
    ready,
    warm() {
      return warming !== null;
    },
    car() {
      return film?.handle ?? parked?.handle ?? null;
    },
    swapCar(placed) {
      if (disposed || car === null || film !== null) {
        placed.dispose();
        return;
      }
      placed.node.position.set(car.site.x, groundH(car.site.x, car.site.z), car.site.z);
      placed.node.rotation.y = carYaw(car.site, car.trailhead);
      for (const m of placed.meshes) {
        deps.shadows?.add(m);
        deps.cover?.add(m);
        if (m.material) attachWet(m.material, WET_CAP.prop);
      }
      const model = carModelOf(placed, (line) => console.warn(line));
      dimCabParts(model);
      parked?.placed.node.setEnabled(false);
      if (carBox !== null) dropBox(carBox);
      // The parked car's patch is fixed to the ground; this one rides the car.
      // Drawn as the parked car's is, by the same shader and as dark, so the
      // swap is not seen in it and asks for no shader the hike has not made.
      patch?.dispose();
      patch = null;
      const moving = createCarShadowPatch(scene, { x: 0, z: 0 }, () => 0, { moving: true });
      moving.mesh.name = "trailhead_film_car_shadow";
      moving.mesh.parent = placed.node;
      const tails = createTailLamps(scene, placed.node);
      film = { placed, handle: handleFor(placed, model, tails), patch: moving, tails };
      // Drawn for its first frames wherever it stands, so it is ready when the scene opens.
      const warm = [...placed.meshes, moving.mesh, ...tails.meshes];
      for (const m of warm) m.alwaysSelectAsActiveMesh = true;
      warming = { left: new Set(warm), ready: new Set(), frames: 0, observer: scene.onAfterRenderObservable.add(warmStep) };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loads.abort();
      if (carBox !== null) dropBox(carBox);
      patch?.dispose();
      patch = null;
      warmed();
      if (film !== null) {
        film.patch.dispose();
        for (const m of film.tails.meshes) m.dispose();
        film.tails.material.dispose();
        for (const m of film.placed.meshes) {
          deps.shadows?.remove(m);
          deps.cover?.remove(m);
        }
        film.placed.dispose();
        film = null;
      }
      parked = null;
      for (const box of kioskBoxes) dropBox(box);
      face?.dispose();
      face = null;
      for (const model of placed) {
        for (const m of model.meshes) {
          deps.shadows?.remove(m);
          deps.cover?.remove(m);
        }
        model.dispose();
      }
      placed.length = 0;
      for (const m of painted) m.dispose(true, true);
      painted.length = 0;
    },
  };
}
