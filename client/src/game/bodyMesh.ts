import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Scene } from "@babylonjs/core/scene.js";

import type { Vec3 } from "../sim/types.js";
import type { PropShadows } from "./propMeshes.js";
import { defaultModelLoader, loaderUntilAborted, placeStaticModel, type ModelLoader, type PlacedModel } from "./staticModel.js";

import { BODY_OUTPUT, BODY_STAND_IN } from "./sceneryParts.js";

// The model's file and the stand-in's numbers are the scenery's own (`sceneryParts.ts`); the file named from here too.
export { BODY_OUTPUT } from "./sceneryParts.js";

const WOOD = new Color3(BODY_STAND_IN.wood.r, BODY_STAND_IN.wood.g, BODY_STAND_IN.wood.b);
const FIGURE = new Color3(BODY_STAND_IN.figure.r, BODY_STAND_IN.figure.g, BODY_STAND_IN.figure.b);

const UPRIGHT_SIZE = { width: BODY_STAND_IN.upright.width, height: BODY_STAND_IN.upright.height, depth: BODY_STAND_IN.upright.depth };
const UPRIGHT_UP = BODY_STAND_IN.upright.up;
const CROSSBAR_SIZE = { width: BODY_STAND_IN.crossbar.width, height: BODY_STAND_IN.crossbar.height, depth: BODY_STAND_IN.crossbar.depth };
const CROSSBAR_UP = BODY_STAND_IN.crossbar.up;
const CAPSULE_HEIGHT = BODY_STAND_IN.capsule.height;
const CAPSULE_RADIUS = BODY_STAND_IN.capsule.radius;
const CAPSULE_UP = BODY_STAND_IN.capsule.up;
/** Hung this far in front of the upright, along the node's local +z. */
const CAPSULE_FORWARD = BODY_STAND_IN.capsule.forward;

let instanceCount = 0;

export type BodyDeps = { shadows?: PropShadows; loader?: ModelLoader };

export type BodyMesh = {
  /** The placeholder's node: the timber cross and the figure hang from it until the model arrives. */
  node: TransformNode;
  /** Resolves once the model has settled, loaded or failed. */
  readonly ready: Promise<void>;
  dispose(): void;
};

/**
 * The body found at the crest: the missing hiker, draped over a dead trunk
 * standing where `body.pos` says, the hiker's front toward `body.yaw` — the
 * same facing convention as a player's, and the model's own +Z. Placed once.
 *
 * Until the model arrives, and for good if it never does, a placeholder cross
 * of dark timber holding a pale figure stands in its place, so the crest is
 * never empty. `StandardMaterial`, with fog left ON: unlike the Hollow, the
 * body is not a silhouette and should fade into the mist like everything else
 * (a PBR material with `fogEnabled = false` never compiles under the
 * atmosphere plugin — see `entityViews.ts`).
 */
export function createBodyMesh(scene: Scene, body: { pos: Vec3; yaw: number }, deps: BodyDeps = {}): BodyMesh {
  const id = instanceCount++;
  const node = new TransformNode(`body_${id}`, scene);
  node.position.set(body.pos.x, body.pos.y, body.pos.z);
  node.rotation.y = body.yaw;

  const woodMaterial = new StandardMaterial(`body_${id}_wood`, scene);
  woodMaterial.diffuseColor = WOOD;
  woodMaterial.fogEnabled = true;

  const figureMaterial = new StandardMaterial(`body_${id}_figure`, scene);
  figureMaterial.diffuseColor = FIGURE;
  figureMaterial.fogEnabled = true;

  const upright = MeshBuilder.CreateBox(`body_${id}_upright`, UPRIGHT_SIZE, scene);
  upright.position.set(0, UPRIGHT_UP, 0);
  upright.material = woodMaterial;
  upright.parent = node;

  const crossbar = MeshBuilder.CreateBox(`body_${id}_crossbar`, CROSSBAR_SIZE, scene);
  crossbar.position.set(0, CROSSBAR_UP, 0);
  crossbar.material = woodMaterial;
  crossbar.parent = node;

  const figure = MeshBuilder.CreateCapsule(
    `body_${id}_figure`,
    { height: CAPSULE_HEIGHT, radius: CAPSULE_RADIUS },
    scene,
  );
  figure.position.set(0, CAPSULE_UP, CAPSULE_FORWARD);
  figure.material = figureMaterial;
  figure.parent = node;

  const placeholder = [upright, crossbar, figure];
  for (const m of placeholder) deps.shadows?.add(m);
  let placeholderGone = false;
  function dropPlaceholder(): void {
    if (placeholderGone) return;
    placeholderGone = true;
    for (const m of placeholder) {
      deps.shadows?.remove(m);
      m.dispose();
    }
    woodMaterial.dispose();
    figureMaterial.dispose();
  }

  let disposed = false;
  let model: PlacedModel | null = null;
  // Aborted first thing in `dispose`: a model in flight then ends at once and
  // quietly (`modelLoad.ts`).
  const loads = new AbortController();
  const load = loaderUntilAborted(deps.loader ?? defaultModelLoader(scene), loads.signal);
  const ready = (async () => {
    let container;
    try {
      container = await load(BODY_OUTPUT);
    } catch {
      // A missing model costs the look: the placeholder stays.
      return;
    }
    // Disposed while the file was in flight: nothing will ever draw it.
    if (disposed) {
      container.dispose();
      return;
    }
    try {
      model = placeStaticModel(container, `body_${id}_model`, body.pos.x, body.pos.y, body.pos.z, body.yaw);
    } catch {
      container.dispose();
      return;
    }
    for (const m of model.meshes) deps.shadows?.add(m);
    dropPlaceholder();
  })();

  return {
    node,
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      loads.abort();
      dropPlaceholder();
      node.dispose();
      if (model !== null) {
        for (const m of model.meshes) deps.shadows?.remove(m);
        model.dispose();
        model = null;
      }
    },
  };
}
