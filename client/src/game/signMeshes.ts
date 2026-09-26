import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { SignPost } from "../sim/signs.js";
import { SIGN_POST_HALF } from "../sim/signs.js";
import type { PropShadows } from "./propMeshes.js";
import { budgetMaterial } from "./headlamp.js";
import { defaultModelLoader, instantiateStaticModel, type ModelLoader, type PlacedModel } from "./staticModel.js";

export const SIGN_POST_OUTPUT = "models/sign.post.glb";
export const SIGN_ARM_OUTPUT = "models/sign.arm.glb";
/** One plank's label texture: one name on one line across a 1 m board, so wide and short. */
export const LABEL_TEXTURE = { width: 1024, height: 192 } as const;

/** Makes the painted material for the trailhead poster: `paintedMaterial`, or a stand-in where there is no canvas. */
export type Painter = (scene: Scene, name: string, lines: readonly string[], width: number, height: number) => Material;
/** Makes the see-through lettering for one plank face: `paintedLabel`, or a stand-in where there is no canvas. */
export type LabelPainter = (scene: Scene, name: string, text: string, width: number, height: number) => Material;

/** The yaw that turns +z onto a unit direction, in the sim's convention (yaw 0 faces +z, PI/2 faces +x). */
export function armYaw(dir: { dx: number; dz: number }): number {
  return Math.atan2(dir.dx, dir.dz);
}

/** The arm model's length along +Z, post end to arrow tip. */
export const ARM_LENGTH = 1.095;
/** The arm model's height, centred on its origin. */
export const ARM_HEIGHT = 0.204;
/** The arm model's thickness across X: its two faces sit this far apart. */
const ARM_THICKNESS = 0.038;
/** Where the arrow's point begins: the full-height board runs from the post end to here. */
const ARM_BOARD_END = 0.95;
/**
 * How far out along the plank its lettering is moved from the board's middle.
 * A plank's post end sits on the post's centre line, so its first few
 * centimetres are inside the post, which is at most 0.067 m from its axis
 * (0.095 m at a corner, measured at its foot and narrower above): moved out
 * this far, with the texture's margin, the letters start 0.095 m out and none
 * is buried in the post.
 */
const LABEL_OUT = 0.07;
/**
 * Height of the bottom plank's centre above the post's foot. The planks have
 * no collider, so the bottom one's lower edge (1.648 m) sits above a hiker's
 * eye (1.6 m) and the camera never passes through a board.
 */
export const PLANK_BASE = 1.75;
/**
 * The rise from one plank to the next: the 0.204 m board and 11 mm of air, so
 * every plank of a post has a height of its own and no two boards cross,
 * whichever ways their arms point.
 */
export const PLANK_STEP = 0.215;
/** The post model's natural height, foot to top. */
export const POST_HEIGHT = 2.221;
/** How far the post's top stands above its highest plank's top edge. */
export const POST_CLEARANCE = 0.1;
/**
 * One label plane: a little wider than the arm's full-height board (0.95 m)
 * and a little shorter than its height; the texture's margin keeps the
 * letters on the wood.
 */
const LABEL_SIZE = { width: 1.0, height: 0.19 } as const;
/** The gap between a label and the arm face it sits on: enough to never fight it for depth. */
const LABEL_LIFT = 0.001;
const WOOD = "#6b4f2a";
const PAINT = "#f2ead8";
/** The lettering: dark, like letters routed into weathered wood. */
const CARVED = "#24180c";
/** The lit lower lip of a routed letter, drawn a little below it. */
const CARVED_LIP = "rgba(236, 214, 170, 0.35)";

/**
 * Painted wood: the words are drawn into a texture on the trailhead poster's
 * board rather than floated in the air, so they are read the way a notice is —
 * by walking up to it with a lamp. One texture per world, never rebuilt. The
 * canvas is uploaded top row at v = 1, Babylon's own texture convention.
 */
export function paintedMaterial(scene: Scene, name: string, lines: readonly string[], width: number, height: number): PBRMaterial {
  const texture = new DynamicTexture(name, { width, height }, scene, false);
  const ctx = texture.getContext();
  ctx.fillStyle = WOOD;
  ctx.fillRect(0, 0, width, height);
  // The largest size at which every line fits the width (monospace runs about
  // 0.62 em per glyph) and all the lines fit the height.
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const size = Math.round(Math.min(height * 0.45, (height / (lines.length + 1)) * 0.8, (width * 0.92) / (longest * 0.62)));
  ctx.font = `bold ${size}px ui-monospace, monospace`;
  ctx.fillStyle = PAINT;
  for (const [i, line] of lines.entries()) {
    ctx.fillText(line, size * 0.5, size * 1.2 + i * size * 1.3);
  }
  texture.update(true);
  const material = new PBRMaterial(`${name}_mat`, scene);
  material.albedoTexture = texture;
  material.metallic = 0;
  material.roughness = 0.9;
  return material;
}

/**
 * The lettering for one arm face: dark bold letters on a fully transparent
 * ground, so the arm's own wood shows around and between them and the text
 * reads as cut into the board rather than stuck on it. One line, centred,
 * set as large as the height allows and then shrunk until it fits the width
 * inside a margin — one place name to a board reads from a few paces with a
 * lamp.
 */
export function paintedLabel(scene: Scene, name: string, text: string, width: number, height: number): PBRMaterial {
  // Mipmapped: the board is read from a few metres, where a 1024-wide texture
  // on a 1 m plane is heavily minified and would shimmer without them.
  const texture = new DynamicTexture(name, { width, height }, scene, true);
  texture.hasAlpha = true;
  const ctx = texture.getContext();
  ctx.clearRect(0, 0, width, height);
  const margin = width * 0.05;
  const family = `"Trebuchet MS", "Helvetica Neue", Arial, sans-serif`;
  let size = Math.round(height * 0.62);
  ctx.font = `bold ${size}px ${family}`;
  const measured = ctx.measureText(text).width;
  if (measured > width - 2 * margin) {
    size = Math.max(12, Math.floor((size * (width - 2 * margin)) / measured));
    ctx.font = `bold ${size}px ${family}`;
  }
  const x = (width - ctx.measureText(text).width) / 2;
  // A capital's middle sits about 0.35 em above the baseline.
  const baseline = height / 2 + size * 0.35;
  const lip = Math.max(1, Math.round(size * 0.04));
  ctx.fillStyle = CARVED_LIP;
  ctx.fillText(text, x, baseline + lip);
  ctx.fillStyle = CARVED;
  ctx.fillText(text, x, baseline);
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
  material.roughness = 0.9;
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
  loader?: ModelLoader;
};

/** How many planks a post carries: one per name, across all its arms. */
export function plankCount(post: SignPost): number {
  let n = 0;
  for (const arm of post.arms) n += arm.names.length;
  return n;
}

/**
 * The centre height of the plank `rank` places from the top of a post with
 * `count` planks: the top plank highest, the last at `PLANK_BASE`.
 */
export function plankHeight(rank: number, count: number): number {
  return PLANK_BASE + PLANK_STEP * (count - 1 - rank);
}

/**
 * How tall a post with `count` planks is drawn: its top `POST_CLEARANCE`
 * above the highest plank's top edge, and never shorter than the model.
 */
export function postHeight(count: number): number {
  if (count === 0) return POST_HEIGHT;
  return Math.max(POST_HEIGHT, plankHeight(0, count) + ARM_HEIGHT / 2 + POST_CLEARANCE);
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
  const load = deps.loader ?? defaultModelLoader(scene);
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
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    deps.shadows?.add(mesh);
    return mesh;
  });
  function dropBox(box: Mesh): void {
    if (box.isDisposed()) return;
    deps.shadows?.remove(box);
    box.dispose();
  }

  function keep(model: PlacedModel, footing: TransformNode): void {
    model.node.parent = footing;
    for (const m of model.meshes) deps.shadows?.add(m);
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

  /** One face's lettering: `side` is +1 for the plank's +X face, -1 for its -X face. */
  function label(name: string, arm: TransformNode, side: 1 | -1, material: Material): void {
    const plane = MeshBuilder.CreatePlane(name, { width: LABEL_SIZE.width, height: LABEL_SIZE.height }, scene);
    plane.parent = arm;
    // Along the board, clear of the post it runs into.
    plane.position.set(side * (ARM_THICKNESS / 2 + LABEL_LIFT), 0, ARM_BOARD_END / 2 + LABEL_OUT);
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
    for (const [p, post] of posts.entries()) {
      const footing = footings[p] as TransformNode;
      const count = plankCount(post);
      for (const arm of post.arms) {
        // The plank's post end on the post's centre line, the footing's
        // origin: whichever way it points, its end is buried in the post
        // (whose axis is within 6 mm of the origin), so it reads as fixed to
        // it with no gap, square on or on the diagonal.
        for (const [k, text] of arm.names.entries()) {
          const rank = arm.ranks[k] as number;
          const name = `sign_${p}_plank_${rank}`;
          const model = instantiateStaticModel(
            container, name, 0, plankHeight(rank, count), 0, armYaw(arm),
          );
          keep(model, footing);
          const material = lettering(text);
          label(`${name}_label_px`, model.node, 1, material);
          label(`${name}_label_nx`, model.node, -1, material);
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
      for (const box of boxes) dropBox(box);
      for (const plane of labels) plane.dispose();
      labels.length = 0;
      for (const model of placed) {
        for (const m of model.meshes) deps.shadows?.remove(m);
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
