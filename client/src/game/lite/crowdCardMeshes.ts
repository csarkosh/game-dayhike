/**
 * The crowd's cards on Babylon Lite: the bodies of the crowd's figures, each
 * a flat shape of a Hollow, one mesh drawn twice, from what the game draws
 * them with (`crowdCards.ts`: the cards' numbers and a frame's vertices).
 *
 * - **One mesh, made once for as many cards as there may be, and written in
 *   place**: a frame with a card sends its three vertex buffers, and one
 *   with none hides the mesh and sends nothing. A card's corner, height and
 *   level ride in the mesh's colour, its stir's phase and rate in its
 *   texture coordinates.
 * - **Two materials of one pair of stages, told apart by a uniform**
 *   (`crowdPass`). In the frame the mesh wears the one that draws a dark
 *   body with a rim the mist lights, blended premultiplied, first of the
 *   way's see-through draws (`SEE_THROUGH_ORDER.crowdCards`), so the mist is
 *   drawn over it: a figure stands in the mist, never on it. In the shade
 *   mask's pass (`shadeMask.ts`) it is drawn with the other in its place,
 *   which writes a shade into the mask's red, blended as a shade of the
 *   sim's is.
 * - **Turned to the camera in the vertex stage**, about the vertical, by the
 *   scene's view: in the mask's pass that is the mask's camera, which is the
 *   frame's own.
 * - **A frame writes the clock and, in the frame's material, the rim's
 *   colour**, only where they moved, and only while a card is drawn.
 */
import {
  addToScene, createMeshFromData, createShaderMaterial, disposeMeshGpu, removeFromScene, setMeshVisible, updateMeshColors, updateMeshPositions, updateMeshUvs,
  type EngineContext, type Mesh, type SceneContext, type ShaderMaterial,
} from "@babylonjs/lite";
import { crowdCardIndices, crowdCardTime, crowdCardVertices, writeCrowdCards } from "../crowdCards.js";
import type { CrowdFigure } from "../crowdField.js";
import { SEE_THROUGH_ORDER } from "@csarkosh/engine/game/lite/drawOrder";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import { shaderUniformDecls, shaderUniformWriter } from "@csarkosh/engine/game/lite/shaderUniforms";
import { PREMULTIPLIED_BLEND } from "./wayLightMeshes.js";
import varyingsSource from "../shaders/crowdCard/varyings.wgsl?raw";
import crowdCardVertexSource from "../shaders/crowdCard/crowdCard.vertex.wgsl?raw";
import crowdCardFragmentSource from "../shaders/crowdCard/crowdCard.fragment.wgsl?raw";
import { fill, wgsl } from "@csarkosh/engine/game/shaders/shaderText";

/** What the two stages hand each other: the card's corner, height and level, and its stir. */
const VARYINGS = wgsl(varyingsSource);

/** The stages' text, for the tests that hold it to the cards' design. */
export const CROWD_CARD_WGSL = {
  vertex: fill(wgsl(crowdCardVertexSource), { varyings: VARYINGS }),
  fragment: fill(wgsl(crowdCardFragmentSource), { varyings: VARYINGS }),
} as const;

/** `crowdPass` in the shade mask and in the frame. */
export const CROWD_PASS = { mask: 0, frame: 1 } as const;

/** A card material's uniforms: the stir's clock, which pass it draws in, and the colour the mist lights a figure's rim with. */
export type CrowdCardUniforms = { crowdTime: [number]; crowdPass: [number]; crowdTint: [number, number, number] };

/** The crowd's cards as they stand in a scene. */
export type LiteCrowdCards = {
  /** The mesh and the material it wears in the shade mask, for the mask to draw (`LiteShadeMask.addCards`). */
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly maskMaterial: ShaderMaterial;
  /**
   * A frame: the figures and the ground's height under each, the eye, the
   * screen's seconds, the figures another drawer holds (`skip`), the band of
   * metres from the eye a card is drawn in, `from` to under `to`, and the
   * colour the mist lights a figure's rim with (`tint`). Returns the cards drawn.
   */
  sync(
    figures: readonly CrowdFigure[], heights: readonly number[], eye: { readonly x: number; readonly y: number; readonly z: number }, seconds: number,
    skip: ReadonlySet<number>, from: number, to: number, tint: readonly [number, number, number],
  ): number;
  dispose(): void;
};

/** The crowd's cards in `scene`, for `most` figures at the most; made before the scene is registered. */
export function createLiteCrowdCards(engine: EngineContext, scene: SceneContext, most: number, uploads?: FrameUploads): LiteCrowdCards {
  const make = (name: string, values: CrowdCardUniforms, blended: Pick<Parameters<typeof createShaderMaterial>[0], "blend" | "blendMode">): ShaderMaterial =>
    createShaderMaterial({
      name,
      vertexSource: CROWD_CARD_WGSL.vertex,
      fragmentSource: CROWD_CARD_WGSL.fragment,
      attributes: ["position", "uv", "color"],
      // The view is the scene's own: no system uniform, so nothing is written for a camera that moves.
      uniforms: shaderUniformDecls(values),
      needAlphaBlending: true,
      ...blended,
      depthWrite: false,
      backFaceCulling: false,
    });
  const frameValues: CrowdCardUniforms = { crowdTime: [0], crowdPass: [CROWD_PASS.frame], crowdTint: [0, 0, 0] };
  const maskValues: CrowdCardUniforms = { crowdTime: [0], crowdPass: [CROWD_PASS.mask], crowdTint: [0, 0, 0] };
  const material = make("crowdCards", frameValues, { blend: PREMULTIPLIED_BLEND });
  // In the mask a shade is blended over what is there, as the sim's figures are.
  const maskMaterial = make("crowdCardsMask", maskValues, { blendMode: "alpha" });
  const writeFrame = shaderUniformWriter(material, frameValues);
  const writeMask = shaderUniformWriter(maskMaterial, maskValues);

  const vertices = crowdCardVertices(most);
  const mesh = createMeshFromData(engine, "crowdCards", vertices.positions, new Float32Array(vertices.positions.length), crowdCardIndices(most), vertices.stirs, undefined, undefined, vertices.cards);
  mesh.material = material;
  // At the world's origin, as every see-through mesh stands: Lite orders them by their places (`drawOrder.ts`).
  mesh.renderOrder = SEE_THROUGH_ORDER.crowdCards;
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);

  let shown = false;
  let disposed = false;

  return {
    mesh,
    material,
    maskMaterial,
    sync(figures, heights, eye, seconds, skip, from, to, tint) {
      if (disposed) return 0;
      const drawn = writeCrowdCards(vertices, most, figures, heights, eye, seconds, skip, from, to);
      const now = drawn > 0;
      if (now !== shown) {
        shown = now;
        setMeshVisible(mesh, now);
      }
      if (now) {
        updateMeshPositions(engine, mesh, vertices.positions);
        updateMeshColors(engine, mesh, vertices.cards);
        updateMeshUvs(engine, mesh, vertices.stirs);
        uploads?.count("geometry", vertices.positions.byteLength + vertices.cards.byteLength + vertices.stirs.byteLength, 3);
        const time = crowdCardTime(seconds);
        frameValues.crowdTime[0] = time;
        maskValues.crowdTime[0] = time;
        frameValues.crowdTint[0] = tint[0];
        frameValues.crowdTint[1] = tint[1];
        frameValues.crowdTint[2] = tint[2];
        const wrote = (writeFrame() ? 1 : 0) + (writeMask() ? 1 : 0);
        if (wrote > 0) uploads?.marked(wrote);
      }
      return drawn;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
    },
  };
}
