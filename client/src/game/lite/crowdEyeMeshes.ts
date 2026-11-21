/**
 * The crowd's eyes on Babylon Lite: a pair of small lights for every figure
 * of the crowd, one mesh and one draw for all of them, from what the game
 * draws them with (`crowdEyes.ts`: the eyes' numbers and a frame's
 * vertices).
 *
 * - **One mesh, made once for as many pairs as there may be, and written in
 *   place**: a frame with a pair sends its three vertex buffers (a few
 *   hundred numbers), and one with none hides the mesh and sends nothing.
 *   An eye's corner, half width and offset ride in the mesh's tangent, its
 *   colour and level in the mesh's colour.
 * - **Placed in the vertex stage along the camera's own right and up**, read
 *   from the scene's view, so a pair always faces the camera and nothing is
 *   written for a camera that moves. The material has no uniform of its own.
 * - **Added to what lies behind it, tested against the depth and never
 *   written to it**, after the way's mist among the see-through draws
 *   (`SEE_THROUGH_ORDER.crowdEyes`): the eyes carry through the mist. The
 *   frame's alpha is left as it is.
 */
import {
  addToScene, createMeshFromData, createShaderMaterial, disposeMeshGpu, removeFromScene, setMeshVisible, updateMeshColors, updateMeshPositions, updateMeshTangents,
  type EngineContext, type Mesh, type SceneContext, type ShaderMaterial,
} from "@babylonjs/lite";
import { crowdEyeIndices, crowdEyeVertices, writeCrowdEyes } from "../crowdEyes.js";
import type { CrowdFigure } from "../crowdField.js";
import { SEE_THROUGH_ORDER } from "@csarkosh/engine/game/lite/drawOrder";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import varyingsSource from "../shaders/crowdEyes/varyings.wgsl?raw";
import crowdEyesVertexSource from "../shaders/crowdEyes/crowdEyes.vertex.wgsl?raw";
import crowdEyesFragmentSource from "../shaders/crowdEyes/crowdEyes.fragment.wgsl?raw";
import { fill, wgsl } from "@csarkosh/engine/game/shaders/shaderText";

/** What the two stages hand each other: the eye's corner of its quad, and its colour and level. */
const VARYINGS = wgsl(varyingsSource);

/** The stages' text, for the tests that hold it to the eyes' design. */
export const CROWD_EYES_WGSL = {
  vertex: fill(wgsl(crowdEyesVertexSource), { varyings: VARYINGS }),
  fragment: fill(wgsl(crowdEyesFragmentSource), { varyings: VARYINGS }),
} as const;

/** The eyes' colour times their roundness, added to what is behind them; the frame's alpha is left as it is. */
export const CROWD_EYES_BLEND: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
  alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
};

/** The crowd's eyes as they stand in a scene. */
export type LiteCrowdEyes = {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /**
   * A frame: the figures and the ground's height under each (`heights`, in
   * step with them), the eye, the screen's seconds, and the figures another
   * drawer holds (`skip`: a model has eyes of its own). Returns the pairs drawn.
   */
  sync(figures: readonly CrowdFigure[], heights: readonly number[], eye: { readonly x: number; readonly y: number; readonly z: number }, seconds: number, skip: ReadonlySet<number>): number;
  dispose(): void;
};

/** The crowd's eyes in `scene`, for `most` figures at the most; made before the scene is registered. */
export function createLiteCrowdEyes(engine: EngineContext, scene: SceneContext, most: number, uploads?: FrameUploads): LiteCrowdEyes {
  const material = createShaderMaterial({
    name: "crowdEyes",
    vertexSource: CROWD_EYES_WGSL.vertex,
    fragmentSource: CROWD_EYES_WGSL.fragment,
    attributes: ["position", "tangent", "color"],
    needAlphaBlending: true,
    blend: CROWD_EYES_BLEND,
    depthWrite: false,
    backFaceCulling: false,
  });
  const vertices = crowdEyeVertices(most);
  const mesh = createMeshFromData(
    engine, "crowdEyes", vertices.positions, new Float32Array(vertices.positions.length), crowdEyeIndices(most), undefined, undefined, vertices.eyes, vertices.colours,
  );
  mesh.material = material;
  // At the world's origin, as every see-through mesh stands: Lite orders them by their places (`drawOrder.ts`).
  mesh.renderOrder = SEE_THROUGH_ORDER.crowdEyes;
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);

  let shown = false;
  let disposed = false;

  return {
    mesh,
    material,
    sync(figures, heights, eye, seconds, skip) {
      if (disposed) return 0;
      const drawn = writeCrowdEyes(vertices, most, figures, heights, eye, seconds, skip);
      const now = drawn > 0;
      if (now !== shown) {
        shown = now;
        setMeshVisible(mesh, now);
      }
      if (now) {
        updateMeshPositions(engine, mesh, vertices.positions);
        updateMeshTangents(engine, mesh, vertices.eyes);
        updateMeshColors(engine, mesh, vertices.colours);
        uploads?.count("geometry", vertices.positions.byteLength + vertices.eyes.byteLength + vertices.colours.byteLength, 3);
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
