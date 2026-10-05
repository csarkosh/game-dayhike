/**
 * The midges: every swarm in one draw. One unit card, thin-instanced once a
 * midge, and one ShaderMaterial (`shaders/midge.*.fx`) that places each midge
 * from its swarm's row in a small uniform table and the shared clock, so
 * nothing but the table goes up each frame.
 *
 * The instances are laid out once, at creation: row r gets `blocks[r]`
 * instances, slots 0 to `blocks[r] - 1`, its per-instance `midge` attribute
 * (row, slot) written once. A slot at or above its row's count collapses in
 * the vertex stage, so the tier's cap and the distance's thinning
 * (`shareBudget`, `midgeMotion.ts`) change counts in the table, never the
 * buffers.
 *
 * GLSL on every engine, as a ShaderMaterial is unless told otherwise: on
 * WebGPU the stages are translated, or found in the WGSL map once the corpus
 * holds them. Blended premultiplied: the glints add (the sun's, and the
 * bright sky's toward the sun, which outlasts it after sunset), the speck's
 * coverage darkens. Out of the scene's fog, under which Babylon would give the
 * material a fog define and uniforms the stages never read; never culled
 * (the stages place the midges, the mesh's own bounds say nothing of where);
 * never a shadow caster.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";

import { MIDGE_SWARMS_MAX, SWARM_ROW_FLOATS } from "./midgeMotion.js";
import midgeVertex from "./shaders/midge.vertex.fx?raw";
import midgeFragment from "./shaders/midge.fragment.fx?raw";

/** The material's and the mesh's name, and the stages' name in Babylon's shader store. */
export const MIDGE_NAME = "midge";

/** The stages' uniforms: the camera's matrix, then the midges'. */
export const MIDGE_UNIFORMS: readonly string[] = [
  "viewProjection",
  "midgeEye", "midgeTime", "midgeSun", "midgeSunLight", "midgeSkyGlow", "midgeNight", "midgeSkyLuma", "midgePixel",
  "midgeSwarms",
];

/** The forward scatter's lobe: the cosine between the view and the sun raised to this. */
export const MIDGE_LOBE_POWER = 8;
/** The wing's flash: the positive half of its sinusoid raised to this, a narrow pulse. */
export const MIDGE_FLASH_POWER = 24;
/** The flash's weight beside the lobe's. */
export const MIDGE_FLASH_GAIN = 0.5;
/** The sky's glint at its fullest, looking level toward the sun's azimuth:
 * its share of the horizon's colour toward the sun. */
export const MIDGE_SKY_GLINT = 0.6;
/** The sky glint's lobe: the cosine between the view and the sun's azimuth,
 * level, raised to this, a broad lobe as the glow along the horizon is. */
export const MIDGE_SKY_LOBE_POWER = 2;
/** The least coverage a midge enlarged to its fewest pixels keeps, so a far
 * midge reads as a dot, not a ghost. */
export const MIDGE_ALPHA_FLOOR = 0.6;
/** How much of the background a speck hides against the brightest sky. */
export const MIDGE_DARK = 0.9;

/** One frame of the midges: the eye, the shared clock, the sun, the sky and the table. */
export type MidgeFrame = {
  eyeX: number; eyeY: number; eyeZ: number;
  /** Shared seconds. */
  time: number;
  /** A unit vector toward the sun. */
  sunX: number; sunY: number; sunZ: number;
  /** The sun's colour times its intensity. */
  sunR: number; sunG: number; sunB: number;
  /** The dome's horizon toward the sun, in the scene's units
   * (`SkyState.horizonToward`): the light of the sky's glint. */
  glowR: number; glowG: number; glowB: number;
  night: number; skyLuma: number;
  /** The world size of one pixel at 1 m from the eye. */
  pixelAt1m: number;
  /** SWARM_ROW_FLOATS · MIDGE_SWARMS_MAX, packed by `packSwarm`. */
  table: Float32Array;
};

export type MidgeSwarms = {
  readonly mesh: Mesh;
  /** Sets every uniform from `f`, the table copied into the material's own. */
  update(f: MidgeFrame): void;
  dispose(): void;
};

/** A unit card in the XY plane, its corners at ±0.5, two triangles. */
function cardData(): VertexData {
  const data = new VertexData();
  data.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
  data.indices = [0, 1, 2, 0, 2, 3];
  return data;
}

/**
 * The midges' mesh and material, `blocks[r]` instances in row r (0 for a row
 * not used), at most MIDGE_SWARMS_MAX rows. Until the first update every row
 * is empty and nothing draws.
 */
export function createMidgeSwarms(scene: Scene, blocks: readonly number[]): MidgeSwarms {
  if (blocks.length > MIDGE_SWARMS_MAX) {
    throw new Error(`createMidgeSwarms: ${blocks.length} rows, the table holds ${MIDGE_SWARMS_MAX}`);
  }
  Effect.ShadersStore[`${MIDGE_NAME}VertexShader`] = midgeVertex;
  Effect.ShadersStore[`${MIDGE_NAME}FragmentShader`] = midgeFragment;

  const material = new ShaderMaterial(MIDGE_NAME, scene, MIDGE_NAME, {
    attributes: ["position", "midge"],
    uniforms: [...MIDGE_UNIFORMS],
    needAlphaBlending: true,
  });
  material.alphaMode = Constants.ALPHA_PREMULTIPLIED;
  material.disableDepthWrite = true;
  // The card turns to the eye in the vertex stage, whichever way it winds.
  material.backFaceCulling = false;

  const eye = new Vector3();
  const sun = new Vector3(0, 1, 0);
  const sunLight = new Vector3();
  const skyGlow = new Vector3();
  const table = new Float32Array(SWARM_ROW_FLOATS * MIDGE_SWARMS_MAX);
  material.setVector3("midgeEye", eye);
  material.setFloat("midgeTime", 0);
  material.setVector3("midgeSun", sun);
  material.setVector3("midgeSunLight", sunLight);
  material.setVector3("midgeSkyGlow", skyGlow);
  material.setFloat("midgeNight", 0);
  material.setFloat("midgeSkyLuma", 0);
  material.setFloat("midgePixel", 0);
  // setArray4 is typed for a number[] and reads its argument by index alone,
  // on WebGL (uniform4fv) and on WebGPU (the uniform buffer's update): the
  // typed array goes up as it is.
  material.setArray4("midgeSwarms", table as unknown as number[]);

  const mesh = new Mesh(MIDGE_NAME, scene);
  cardData().applyToMesh(mesh, false);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.applyFog = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;

  let total = 0;
  for (const block of blocks) total += block;
  const midges = new Float32Array(total * 2);
  let at = 0;
  blocks.forEach((block, row) => {
    for (let slot = 0; slot < block; slot++) {
      midges[at++] = row;
      midges[at++] = slot;
    }
  });
  if (total > 0) {
    // Babylon counts thin instances by their matrices: identities, never
    // read by the stages, which place each midge from the table.
    const matrices = new Float32Array(total * 16);
    for (let i = 0; i < total; i++) {
      matrices[i * 16] = 1;
      matrices[i * 16 + 5] = 1;
      matrices[i * 16 + 10] = 1;
      matrices[i * 16 + 15] = 1;
    }
    mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
    mesh.thinInstanceSetBuffer("midge", midges, 2, true);
  }
  // With no instance Babylon would draw the bare card.
  mesh.setEnabled(total > 0);

  return {
    mesh,
    update(f) {
      material.setVector3("midgeEye", eye.set(f.eyeX, f.eyeY, f.eyeZ));
      material.setFloat("midgeTime", f.time);
      material.setVector3("midgeSun", sun.set(f.sunX, f.sunY, f.sunZ));
      material.setVector3("midgeSunLight", sunLight.set(f.sunR, f.sunG, f.sunB));
      material.setVector3("midgeSkyGlow", skyGlow.set(f.glowR, f.glowG, f.glowB));
      material.setFloat("midgeNight", f.night);
      material.setFloat("midgeSkyLuma", f.skyLuma);
      material.setFloat("midgePixel", f.pixelAt1m);
      table.set(f.table);
      material.setArray4("midgeSwarms", table as unknown as number[]);
    },
    dispose() {
      mesh.dispose();
      material.dispose();
    },
  };
}
