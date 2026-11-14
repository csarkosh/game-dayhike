/**
 * The crowd's eyes (docs/gameplay/2026-11-13-the-way-down.md): a pair of
 * small lights for each figure of the crowd. Past the mist's reach they are
 * all there is of a figure, and they carry through the mist and get smaller
 * with distance, which is what makes the crowd read as deep. One mesh and
 * one draw for every pair: a quad an eye, its vertices rewritten each frame
 * (a few hundred numbers), placed in the vertex stage so the pair always
 * faces the camera.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Rgb } from "./colour.js";
import { presenceOf, type CrowdFigure } from "./crowdField.js";
import { HOLLOW_FIGURE_M } from "./hollowLook.js";
import crowdEyesVertex from "./shaders/crowdEyes.vertex.fx?raw";
import crowdEyesFragment from "./shaders/crowdEyes.fragment.fx?raw";

export const CROWD_EYES_NAME = "crowdEyes";
/** The crowd's eyes run from pale to a dull ember by a figure's `warm`: never the Hollow's red, which is what tells a figure that kills from the crowd. */
export const CROWD_EYE_PALE: Rgb = { r: 0.78, g: 0.82, b: 0.74 };
export const CROWD_EYE_EMBER: Rgb = { r: 0.9, g: 0.42, b: 0.16 };
/** An eye's half width and the pair's spread, in metres at a Hollow's size; the share of a figure's height its eyes sit at; and how bright a wholly lit eye is. */
export const CROWD_EYE_M = 0.09;
export const CROWD_EYE_APART_M = 0.34;
export const CROWD_EYE_HEIGHT = 0.72;
export const CROWD_EYE_GAIN = 1.6;
/** Metres from the eye over which a pair dims to half and no further: it carries through the mist. */
export const CROWD_EYE_DIM_M: readonly [number, number] = [40, 120];

/** A figure's eye colour for its `warm`, 0 pale to 1 ember. */
export function crowdEyeColour(warm: number): Rgb {
  return {
    r: CROWD_EYE_PALE.r + (CROWD_EYE_EMBER.r - CROWD_EYE_PALE.r) * warm,
    g: CROWD_EYE_PALE.g + (CROWD_EYE_EMBER.g - CROWD_EYE_PALE.g) * warm,
    b: CROWD_EYE_PALE.b + (CROWD_EYE_EMBER.b - CROWD_EYE_PALE.b) * warm,
  };
}

const CORNERS: readonly [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

export type CrowdEyes = {
  /**
   * A frame: the figures and the ground's height under each (`heights`, in
   * step with them), the eye, the screen's seconds, and the figures another
   * drawer holds (`skip`: a model has eyes of its own). Returns the pairs drawn.
   */
  sync(figures: readonly CrowdFigure[], heights: readonly number[], eye: Vector3, seconds: number, skip: ReadonlySet<number>): number;
  dispose(): void;
};

/** The crowd's eyes in `scene`, for `most` figures at the most. */
export function createCrowdEyes(scene: Scene, most: number): CrowdEyes {
  Effect.ShadersStore[`${CROWD_EYES_NAME}VertexShader`] = crowdEyesVertex;
  Effect.ShadersStore[`${CROWD_EYES_NAME}FragmentShader`] = crowdEyesFragment;
  const material = new ShaderMaterial(CROWD_EYES_NAME, scene, CROWD_EYES_NAME, {
    attributes: ["position", "crowdEye", "crowdColour"],
    uniforms: ["view", "projection"],
    needAlphaBlending: true,
  });
  material.alphaMode = Constants.ALPHA_ADD;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;

  const vertices = most * 8;
  const positions = new Float32Array(vertices * 3), eyes = new Float32Array(vertices * 4), colours = new Float32Array(vertices * 4);
  const indices = new Uint32Array(most * 12);
  for (let q = 0; q < most * 2; q++) indices.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
  const mesh = new Mesh(CROWD_EYES_NAME, scene);
  mesh.setVerticesData(VertexBuffer.PositionKind, positions, true);
  mesh.setVerticesData("crowdEye", eyes, true, 4);
  mesh.setVerticesData("crowdColour", colours, true, 4);
  mesh.setIndices(indices);
  mesh.material = material;
  mesh.isPickable = false;
  // Its vertices are wherever the crowd is, and its bounds are not kept up.
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.setEnabled(false);

  return {
    sync(figures, heights, eye, seconds, skip) {
      let drawn = 0;
      for (let i = 0; i < figures.length && drawn < most; i++) {
        const f = figures[i] as CrowdFigure;
        if (skip.has(f.id)) continue;
        const y = (heights[i] as number) + HOLLOW_FIGURE_M * f.size * CROWD_EYE_HEIGHT;
        const dx = f.x - eye.x, dy = y - eye.y, dz = f.z - eye.z;
        const far = (Math.sqrt(dx * dx + dy * dy + dz * dz) - CROWD_EYE_DIM_M[0]) / (CROWD_EYE_DIM_M[1] - CROWD_EYE_DIM_M[0]);
        const t = far <= 0 ? 0 : far >= 1 ? 1 : far * far * (3 - 2 * far);
        const level = f.eyes * presenceOf(f, seconds) * CROWD_EYE_GAIN * (1 - 0.5 * t);
        const colour = crowdEyeColour(f.warm);
        for (let e = 0; e < 2; e++) {
          for (let c = 0; c < 4; c++) {
            const v = (drawn * 2 + e) * 4 + c, corner = CORNERS[c] as [number, number];
            positions[v * 3] = f.x;
            positions[v * 3 + 1] = y;
            positions[v * 3 + 2] = f.z;
            eyes[v * 4] = corner[0];
            eyes[v * 4 + 1] = corner[1];
            eyes[v * 4 + 2] = CROWD_EYE_M * f.size;
            eyes[v * 4 + 3] = (e === 0 ? -0.5 : 0.5) * CROWD_EYE_APART_M * f.size;
            colours[v * 4] = colour.r;
            colours[v * 4 + 1] = colour.g;
            colours[v * 4 + 2] = colour.b;
            colours[v * 4 + 3] = level;
          }
        }
        drawn++;
      }
      // The pairs not used are nothing: no size and no light.
      eyes.fill(0, drawn * 32);
      colours.fill(0, drawn * 32);
      mesh.setEnabled(drawn > 0);
      if (drawn > 0) {
        mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
        mesh.updateVerticesData("crowdEye", eyes);
        mesh.updateVerticesData("crowdColour", colours);
      }
      return drawn;
    },
    dispose() {
      mesh.dispose();
      material.dispose();
    },
  };
}
