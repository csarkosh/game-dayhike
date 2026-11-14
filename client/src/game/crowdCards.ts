/**
 * The crowd's cards (docs/gameplay/2026-11-13-the-way-down.md): the bodies
 * of the crowd's figures, each a flat shape of a Hollow. One mesh, drawn
 * twice. In the frame it is a dark body with a rim the mist lights, so a
 * figure shows against the pale mist and against the black woods alike (on
 * the tiers whose woods are near black a darkness alone showed nothing). In
 * the shade mask (shadeSilhouette.ts) it is a shade, which the grade or the
 * veil blurs into a darkness as it does the sim's own. Past the mist's reach
 * only a figure's eyes are left (crowdEyes.ts).
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { presenceOf, type CrowdFigure } from "./crowdField.js";
import { SHADE_FAR_M, SHADE_FAR_SHARE, SHADE_NEAR_M } from "./entityViews.js";
import { HOLLOW_FIGURE_M } from "./hollowLook.js";
import { MAIN_LAYER, SHADE_LAYER } from "./shadeSilhouette.js";
import { hash2 } from "../sim/field.js";
import crowdCardVertex from "./shaders/crowdCard.vertex.fx?raw";
import crowdCardFragment from "./shaders/crowdCard.fragment.fx?raw";

export const CROWD_CARDS_NAME = "crowdCards";
/** A card's width, as a share of its height (the vertex and fragment stages lay the figure out in a half of this either side of its middle). */
export const CROWD_CARD_WIDE = 0.5;
/** The seconds the shader's clock folds at, so its sines keep their precision. */
const TIME_FOLD_S = 1000;

const CORNERS: readonly [number, number][] = [[-1, 0], [1, 0], [-1, 1], [1, 1]];

export type CrowdCards = {
  /** The mesh and the material it wears in the shade mask, for the mask to draw (`ShadeSilhouette.setCards`). */
  readonly mesh: Mesh;
  readonly maskMaterial: Material;
  /**
   * A frame: the figures and the ground's height under each, the eye, the
   * screen's seconds, the figures another drawer holds (`skip`), and the band
   * of metres from the eye a card is drawn in, `from` to under `to`, and the
   * colour the mist lights a figure's rim with (`tint`). Returns the cards drawn.
   */
  sync(figures: readonly CrowdFigure[], heights: readonly number[], eye: Vector3, seconds: number, skip: ReadonlySet<number>, from: number, to: number, tint: readonly [number, number, number]): number;
  dispose(): void;
};

/** The crowd's cards in `scene`, for `most` figures at the most. */
export function createCrowdCards(scene: Scene, most: number): CrowdCards {
  Effect.ShadersStore[`${CROWD_CARDS_NAME}VertexShader`] = crowdCardVertex;
  Effect.ShadersStore[`${CROWD_CARDS_NAME}FragmentShader`] = crowdCardFragment;
  const make = (name: string, pass: number, alphaMode: number): ShaderMaterial => {
    const m = new ShaderMaterial(name, scene, CROWD_CARDS_NAME, {
      attributes: ["position", "crowdCard", "crowdStir"],
      uniforms: ["view", "viewProjection", "crowdTime", "crowdPass", "crowdTint"],
      needAlphaBlending: true,
    });
    m.alphaMode = alphaMode;
    m.disableDepthWrite = true;
    m.backFaceCulling = false;
    m.setFloat("crowdTime", 0);
    m.setFloat("crowdPass", pass);
    m.setVector3("crowdTint", new Vector3(0, 0, 0));
    return m;
  };
  const material = make(CROWD_CARDS_NAME, 1, Constants.ALPHA_PREMULTIPLIED);
  const maskMaterial = make(`${CROWD_CARDS_NAME}Mask`, 0, Constants.ALPHA_COMBINE);
  const tintAt = new Vector3(0, 0, 0);

  const vertices = most * 4;
  const positions = new Float32Array(vertices * 3), cards = new Float32Array(vertices * 4), stirs = new Float32Array(vertices * 2);
  const indices = new Uint32Array(most * 6);
  for (let q = 0; q < most; q++) indices.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
  const mesh = new Mesh(CROWD_CARDS_NAME, scene);
  mesh.setVerticesData(VertexBuffer.PositionKind, positions, true);
  mesh.setVerticesData("crowdCard", cards, true, 4);
  mesh.setVerticesData("crowdStir", stirs, true, 2);
  mesh.setIndices(indices);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.layerMask = SHADE_LAYER | MAIN_LAYER;
  mesh.alwaysSelectAsActiveMesh = true;
  // First among the frame's blended draws, so the mist is drawn over it: a figure stands in the mist, never on it.
  mesh.alphaIndex = 0;
  mesh.setEnabled(false);

  return {
    mesh,
    maskMaterial,
    sync(figures, heights, eye, seconds, skip, from, to, tint) {
      let drawn = 0;
      for (let i = 0; i < figures.length && drawn < most; i++) {
        const f = figures[i] as CrowdFigure;
        if (skip.has(f.id)) continue;
        const ground = heights[i] as number;
        const dx = f.x - eye.x, dy = ground - eye.y, dz = f.z - eye.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < from || d >= to) continue;
        // Fainter with distance, as a shade of the sim's is (entityViews.ts).
        const t = Math.max(0, Math.min(1, (d - SHADE_NEAR_M) / (SHADE_FAR_M - SHADE_NEAR_M)));
        const level = presenceOf(f, seconds) * (1 - (1 - SHADE_FAR_SHARE) * t);
        const phase = hash2(f.id, 6, 0) * 2 * Math.PI, rate = 0.5 + f.pace * 0.5;
        for (let c = 0; c < 4; c++) {
          const v = drawn * 4 + c, corner = CORNERS[c] as [number, number];
          positions[v * 3] = f.x;
          positions[v * 3 + 1] = ground;
          positions[v * 3 + 2] = f.z;
          cards[v * 4] = corner[0];
          cards[v * 4 + 1] = corner[1];
          cards[v * 4 + 2] = HOLLOW_FIGURE_M * f.size;
          cards[v * 4 + 3] = level;
          stirs[v * 2] = phase;
          stirs[v * 2 + 1] = rate;
        }
        drawn++;
      }
      cards.fill(0, drawn * 16);
      material.setFloat("crowdTime", seconds % TIME_FOLD_S);
      maskMaterial.setFloat("crowdTime", seconds % TIME_FOLD_S);
      tintAt.set(tint[0], tint[1], tint[2]);
      material.setVector3("crowdTint", tintAt);
      mesh.setEnabled(drawn > 0);
      if (drawn > 0) {
        mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
        mesh.updateVerticesData("crowdCard", cards);
        mesh.updateVerticesData("crowdStir", stirs);
      }
      return drawn;
    },
    dispose() {
      mesh.dispose();
      material.dispose();
      maskMaterial.dispose();
    },
  };
}
