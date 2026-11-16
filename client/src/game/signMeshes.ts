import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { SignPost } from "../sim/signs.js";
import { SIGN_POST_HALF } from "../sim/signs.js";
import type { MeshRegistry, PropShadows } from "./propMeshes.js";
import { budgetMaterial } from "./headlamp.js";
import {
  ARM_THICKNESS, LABEL_LIFT, LABEL_ROUGHNESS, LABEL_SIZE, LABEL_TEXTURE, POST_HEIGHT, SIGN_ARM_OUTPUT, SIGN_POST_OUTPUT, armYaw, labelAlong, paintLabel,
  plankCount, plankHeight, postHeight, squareEnd,
} from "./signParts.js";
import { defaultModelLoader, loaderUntilAborted, instantiateStaticModel, type ModelLoader, type PlacedModel } from "./staticModel.js";
import { attachWet, WET_CAP } from "./wetPlugin.js";

// The posts' numbers, their lettering's paint and the plank's cut are the signs' own (`signParts.ts`); named from here too.
export {
  ARM_HEIGHT, ARM_LENGTH, LABEL_TEXTURE, PLANK_BASE, PLANK_STEP, POST_CLEARANCE, POST_HEIGHT, SIGN_ARM_OUTPUT, SIGN_POST_OUTPUT, armYaw, plankCount, plankHeight,
  postHeight, scrape,
} from "./signParts.js";

/** Makes the see-through lettering for one plank face: `paintedLabel`, or a stand-in where there is no canvas. */
export type LabelPainter = (scene: Scene, name: string, text: string, width: number, height: number) => Material;

/**
 * The lettering for one plank face (`paintLabel`), as a material: the paint
 * on a fully transparent ground, blended over the arm's own wood.
 */
export function paintedLabel(scene: Scene, name: string, text: string, width: number, height: number): PBRMaterial {
  // Mipmapped: the board is read from a few metres, where a 1024-wide texture
  // on a 1 m plane is heavily minified and would shimmer without them.
  const texture = new DynamicTexture(name, { width, height }, scene, true);
  texture.hasAlpha = true;
  paintLabel(texture.getContext() as unknown as CanvasRenderingContext2D, text, width, height);
  texture.update(true);
  const material = new PBRMaterial(`${name}_mat`, scene);
  material.albedoTexture = texture;
  material.useAlphaFromAlbedoTexture = true;
  material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  // The clear ground must stay clear: no reflection or highlight kept where
  // the alpha is zero, which would lay a sheen over the wood.
  material.useRadianceOverAlpha = false;
  material.useSpecularOverAlpha = false;
  // Seen only from the front: from behind, the arm hides it anyway, and a
  // back face would read mirrored.
  material.backFaceCulling = true;
  // A millimetre off the face is plenty up close; the bias keeps it on top at range.
  material.zOffset = -1;
  material.metallic = 0;
  material.roughness = LABEL_ROUGHNESS;
  return material;
}

export type SignMeshes = {
  /** Resolves once both models have settled, loaded or failed. */
  readonly ready: Promise<void>;
  dispose(): void;
};

export type SignDeps = {
  /** The box material by prop name — `terrainMaterialFor`, as the prop boxes use. */
  materialFor(name: string): Material;
  paint?: LabelPainter;
  shadows?: PropShadows;
  /** The rain's cover map: a post and its planks are hard cover, box or model. */
  cover?: MeshRegistry;
  loader?: ModelLoader;
};

/**
 * Cuts the plank's inner end square so it meets the post cleanly: the end
 * the model comes with is a V notch, whose two points would stand out beside
 * a post as thin as this one. Every vertex behind the notch's apex (the
 * nearest point on the board's centre line) moves forward to it, so the end
 * becomes flat; the faces that turn to face the post get their normals
 * worked out again, and the texture coordinates stay as they were. Done once
 * on the loaded model, before any copy shares its geometry. Returns the
 * apex's distance along the plank, where the flat end now is.
 */
export function squareInnerEnd(container: AssetContainer): number {
  let apex = 0;
  for (const mesh of container.meshes) {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    const indices = mesh.getIndices();
    if (positions === null || indices === null || positions.length === 0) continue;
    const oldNormals = mesh.getVerticesData(VertexBuffer.NormalKind);
    const geometry = { positions: Float32Array.from(positions), normals: oldNormals === null ? null : Float32Array.from(oldNormals), indices };
    const cut = squareEnd(geometry);
    if (cut === null) continue;
    apex = Math.max(apex, cut.end);
    if (cut.moved === 0) continue;
    mesh.setVerticesData(VertexBuffer.PositionKind, geometry.positions, false);
    if (geometry.normals !== null) mesh.setVerticesData(VertexBuffer.NormalKind, geometry.normals, false);
    mesh.refreshBoundingInfo({});
  }
  return apex;
}

/**
 * The fingerposts at every junction: a wooden post with one arrow board per
 * place, each pointing down the branch the sim chose for it and lettered on
 * both faces with that one name. Every plank of a post has a height of its
 * own, in the post's order from the top, and the post is stretched to stand
 * above the highest. The two models load once and every post and plank is a
 * copy sharing their geometry. Until the post arrives (or for good, if it
 * never does) the collider box the sim emits is drawn in its place, so no post
 * is ever an invisible wall; a plank that never arrives is simply not drawn.
 */
export function createSignMeshes(
  scene: Scene,
  posts: readonly SignPost[],
  groundH: (x: number, z: number) => number,
  deps: SignDeps,
): SignMeshes {
  // Aborted first thing in `dispose`: a model in flight then ends at once and
  // quietly (`modelLoad.ts`).
  const loads = new AbortController();
  const load = loaderUntilAborted(deps.loader ?? defaultModelLoader(scene), loads.signal);
  const paint = deps.paint ?? paintedLabel;
  let disposed = false;
  const containers: AssetContainer[] = [];
  const placed: PlacedModel[] = [];
  const labels: Mesh[] = [];
  /** One lettering per place name, shared by every plank that names it on every post. */
  const painted = new Map<string, Material>();
  function lettering(text: string): Material {
    let material = painted.get(text);
    if (material === undefined) {
      material = paint(scene, `sign_label_${painted.size}`, text, LABEL_TEXTURE.width, LABEL_TEXTURE.height);
      painted.set(text, material);
    }
    return material;
  }

  // Each post's footing: the post and its arms hang off it.
  const footings = posts.map((post, p) => {
    const node = new TransformNode(`sign_${p}`, scene);
    node.position.set(post.x, groundH(post.x, post.z), post.z);
    return node;
  });
  const boxes = posts.map((post, p) => {
    const mesh = MeshBuilder.CreateBox(
      `sign_${p}_box`,
      { width: 2 * SIGN_POST_HALF.x, height: 2 * SIGN_POST_HALF.y, depth: 2 * SIGN_POST_HALF.z },
      scene,
    );
    mesh.position.set(post.x, groundH(post.x, post.z) + SIGN_POST_HALF.y, post.z);
    mesh.material = deps.materialFor("signpost");
    attachWet(mesh.material, WET_CAP.prop);
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    deps.shadows?.add(mesh);
    deps.cover?.add(mesh);
    return mesh;
  });
  function dropBox(box: Mesh): void {
    if (box.isDisposed()) return;
    deps.shadows?.remove(box);
    deps.cover?.remove(box);
    box.dispose();
  }

  function keep(model: PlacedModel, footing: TransformNode): void {
    model.node.parent = footing;
    for (const m of model.meshes) {
      deps.shadows?.add(m);
      deps.cover?.add(m);
      // The weather soaks the post as it does every prop.
      if (m.material) attachWet(m.material, WET_CAP.prop);
    }
    placed.push(model);
  }

  function placePosts(container: AssetContainer): void {
    for (const [p, footing] of footings.entries()) {
      const model = instantiateStaticModel(container, `sign_${p}_post`, 0, 0, 0, 0);
      // Stretched up from its foot, which sits at the model's origin.
      model.node.scaling.y = postHeight(plankCount(posts[p] as SignPost)) / POST_HEIGHT;
      keep(model, footing);
      dropBox(boxes[p] as Mesh);
    }
  }

  /**
   * One face's lettering: `side` is +1 for the plank's +X face, -1 for its
   * -X face; `along` is how far along the plank from its origin the plane's
   * middle sits.
   */
  function label(name: string, arm: TransformNode, side: 1 | -1, material: Material, along: number): void {
    const plane = MeshBuilder.CreatePlane(name, { width: LABEL_SIZE.width, height: LABEL_SIZE.height }, scene);
    plane.parent = arm;
    // Along the board, clear of the post it runs into.
    plane.position.set(side * (ARM_THICKNESS / 2 + LABEL_LIFT), 0, along);
    // A plane faces -Z; a quarter turn one way or the other points it out of its face.
    plane.rotation.y = -side * (Math.PI / 2);
    plane.material = material;
    plane.isPickable = false;
    // It takes the shadows the arm does, but casts none of its own: the
    // board under it already does.
    plane.receiveShadows = true;
    labels.push(plane);
  }

  function placePlanks(container: AssetContainer): void {
    const end = squareInnerEnd(container);
    // The lettering centred on the board seen between the post and the
    // arrow's point, measured from the post's axis, where the squared end is.
    const along = labelAlong(end);
    for (const [p, post] of posts.entries()) {
      const footing = footings[p] as TransformNode;
      const count = plankCount(post);
      for (const arm of post.arms) {
        // The plank's squared end on the footing's origin, the post's axis to
        // within 7 mm: whichever way it points, it meets the post with no
        // gap and nothing comes out of the far side.
        for (const [k, text] of arm.names.entries()) {
          const rank = arm.ranks[k] as number;
          const name = `sign_${p}_plank_${rank}`;
          const model = instantiateStaticModel(
            container, name, -arm.dx * end, plankHeight(rank, count), -arm.dz * end, armYaw(arm),
          );
          keep(model, footing);
          const material = lettering(text);
          label(`${name}_label_px`, model.node, 1, material, along);
          label(`${name}_label_nx`, model.node, -1, material, along);
        }
      }
    }
  }

  async function settle(output: string, place: (container: AssetContainer) => void): Promise<void> {
    let container: AssetContainer;
    try {
      container = await load(output);
    } catch {
      // A missing model costs the look, never the collider: the boxes stay.
      return;
    }
    // Disposed while the file was in flight: nothing will ever draw it.
    if (disposed) {
      container.dispose();
      return;
    }
    containers.push(container);
    // A container's materials are built while the scene takes no new
    // entities, so the scene's new-material hook does not see them made. Every
    // copy shares them: raise their light cap once, before the first copy
    // draws, rather than leave Babylon's default of 4, which drops the third
    // hiker's lamp.
    for (const material of container.materials) budgetMaterial(material);
    try {
      place(container);
    } catch {
      // A model without the expected roots draws nothing; the boxes stay.
    }
  }

  const ready = Promise.all([settle(SIGN_POST_OUTPUT, placePosts), settle(SIGN_ARM_OUTPUT, placePlanks)]).then(() => undefined);

  return {
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      loads.abort();
      for (const box of boxes) dropBox(box);
      for (const plane of labels) plane.dispose();
      labels.length = 0;
      for (const model of placed) {
        for (const m of model.meshes) {
          deps.shadows?.remove(m);
          deps.cover?.remove(m);
        }
        model.dispose();
      }
      placed.length = 0;
      for (const m of painted.values()) m.dispose(true, true);
      painted.clear();
      for (const c of containers) c.dispose();
      containers.length = 0;
      for (const node of footings) node.dispose();
    },
  };
}
