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
/** One arm's label texture: two names on one line across a 1 m board, so wide and short. */
export const LABEL_TEXTURE = { width: 1024, height: 192 } as const;

/** Makes the painted material for the trailhead poster: `paintedMaterial`, or a stand-in where there is no canvas. */
export type Painter = (scene: Scene, name: string, lines: readonly string[], width: number, height: number) => Material;
/** Makes the see-through lettering for one arm face: `paintedLabel`, or a stand-in where there is no canvas. */
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
/** Half the post model's square section. */
const POST_HALF_WIDTH = 0.065;
/** Clearance between an arm's post end and the post's face. */
const ARM_SEAT_GAP = 0.005;
/**
 * Height of an arm's centre above the post's foot. The arms have no collider,
 * so the lowest one's bottom edge (1.698 m) sits above a hiker's eye (1.6 m)
 * and the camera never passes through a board; one step up (`ARM_STACK`), a
 * raised arm's top edge (2.112 m) stays under the 2.221 m post's top.
 */
export const ARM_ABOVE_GROUND = 1.8;
/** How far an arm is raised when it points nearly the same way as one below it. */
export const ARM_STACK = 0.21;
/** The highest step: the post has room for two arms one above the other, no more. */
const ARM_TOP_LEVEL = 1;
/** Arms closer than this in direction (cos 30 degrees) would cross; the later one is raised. */
const ARM_CROSSING_COS = Math.cos(Math.PI / 6);
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
 * inside a margin — two place names joined by a dot fit at a size that reads
 * from a few paces with a lamp.
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

/**
 * How far above `ARM_ABOVE_GROUND` each arm of one post sits, in steps. The
 * sim gives an arm per branch, so two branches leaving a junction a few
 * degrees apart would put two boards through each other; an arm pointing
 * within 30 degrees of a lower one goes up a step. There is room for one
 * step: a third arm in the same direction, rare at a real junction, shares
 * the raised one's height.
 */
export function armLevels(arms: readonly { dx: number; dz: number }[]): number[] {
  const levels: number[] = [];
  for (const [i, arm] of arms.entries()) {
    let level = 0;
    for (let j = 0; j < i; j++) {
      const other = arms[j] as { dx: number; dz: number };
      if (arm.dx * other.dx + arm.dz * other.dz >= ARM_CROSSING_COS) level = Math.max(level, (levels[j] as number) + 1);
    }
    levels.push(Math.min(level, ARM_TOP_LEVEL));
  }
  return levels;
}

/**
 * The fingerposts at every junction: a wooden post with one arrow board per
 * branch, each board lettered on both faces with the places that branch leads
 * to. The two models load once and every post and arm is a copy sharing their
 * geometry. Until the post arrives (or for good, if it never does) the
 * collider box the sim emits is drawn in its place, so no post is ever an
 * invisible wall; an arm that never arrives is simply not drawn.
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
  const painted: Material[] = [];

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
      keep(instantiateStaticModel(container, `sign_${p}_post`, 0, 0, 0, 0), footing);
      dropBox(boxes[p] as Mesh);
    }
  }

  /** One face's lettering: `side` is +1 for the arm's +X face, -1 for its -X face. */
  function label(name: string, arm: TransformNode, side: 1 | -1, material: Material): void {
    const plane = MeshBuilder.CreatePlane(name, { width: LABEL_SIZE.width, height: LABEL_SIZE.height }, scene);
    plane.parent = arm;
    // Centred on the full-height board, clear of the arrow's point.
    plane.position.set(side * (ARM_THICKNESS / 2 + LABEL_LIFT), 0, ARM_BOARD_END / 2);
    // A plane faces -Z; a quarter turn one way or the other points it out of its face.
    plane.rotation.y = -side * (Math.PI / 2);
    plane.material = material;
    plane.isPickable = false;
    // It takes the shadows the arm does, but casts none of its own: the
    // board under it already does.
    plane.receiveShadows = true;
    labels.push(plane);
  }

  function placeArms(container: AssetContainer): void {
    for (const [p, post] of posts.entries()) {
      const footing = footings[p] as TransformNode;
      const levels = armLevels(post.arms);
      for (const [a, arm] of post.arms.entries()) {
        const name = `sign_${p}_arm_${a}`;
        // The arm's post end seated against the post: the square post reaches
        // 0.065 (|dx| + |dz|) from its axis along the arm's direction — its face
        // square on, a corner on the diagonal — so the arm meets it in every
        // direction without cutting into it.
        const seat = POST_HALF_WIDTH * (Math.abs(arm.dx) + Math.abs(arm.dz)) + ARM_SEAT_GAP;
        const model = instantiateStaticModel(
          container, name,
          arm.dx * seat, ARM_ABOVE_GROUND + ARM_STACK * (levels[a] as number), arm.dz * seat,
          armYaw(arm),
        );
        keep(model, footing);
        const text = arm.names.join(" · ");
        if (text === "") continue;
        const material = paint(scene, `${name}_label`, text, LABEL_TEXTURE.width, LABEL_TEXTURE.height);
        painted.push(material);
        label(`${name}_label_px`, model.node, 1, material);
        label(`${name}_label_nx`, model.node, -1, material);
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

  const ready = Promise.all([settle(SIGN_POST_OUTPUT, placePosts), settle(SIGN_ARM_OUTPUT, placeArms)]).then(() => undefined);

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
      for (const m of painted) m.dispose(true, true);
      painted.length = 0;
      for (const c of containers) c.dispose();
      containers.length = 0;
      for (const node of footings) node.dispose();
    },
  };
}
